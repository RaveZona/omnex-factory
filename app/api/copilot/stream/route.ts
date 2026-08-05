/**
 * POST /api/copilot/stream — P8, the streaming copilot.
 *
 * Streams a run as Server-Sent Events: the shape of the run, the text it
 * produces, and — the part nothing else in the ecosystem scan does — the
 * running cost, updated while it is still running.
 *
 * Order is deliberate and matches the studio route:
 *   auth → rate limit → guard the input → run, streaming → guard the output
 *
 * ## Why this route does not charge credits before streaming
 *
 * `/api/studio/generate` charges first and refunds on failure, which is correct
 * for a fixed-price unit of work: one generation, one price, known in advance.
 * A streamed run has no such price. It ends when it ends, and the cost is known
 * only once it has. Charging a guess up front and reconciling afterwards is how
 * a customer gets billed for a run they cancelled after two seconds.
 *
 * So the accrued cost is streamed as it happens and the terminal `done` event
 * carries the final figure. Metering to the ledger belongs at that point —
 * where the number is a fact rather than an estimate. Wiring
 * `lib/core/agents/budget.ts` in as a per-run ceiling is the next step and is
 * deliberately not claimed here, because it is not done yet.
 *
 * ## Why the abort signal is passed through
 *
 * `req.signal` fires when the client disconnects. Without it, a closed tab
 * leaves the run generating against the user's balance with nobody to show it
 * to — the failure `lib/core/agents/stream.ts` exists to prevent, asserted in
 * `lib/__tests__/stream.test.ts`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/core/supabase/server'
import { checkRateLimit } from '@/lib/core/security/ratelimit'
import { guardInbound, guardOutbound, summarise } from '@/lib/core/agents/guardrails'
import { complete, hasProvider } from '@/lib/core/llm/provider'
import { Trace } from '@/lib/core/agents/trace'
import { SSE_HEADERS, toSSE, type RunStep } from '@/lib/core/agents/stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_QUESTION = 2_000

interface CopilotBody {
  question?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = checkRateLimit(req, 'copilot_stream')
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many runs started. Try again shortly.' }, { status: 429 })
  }

  let body: CopilotBody
  try {
    body = (await req.json()) as CopilotBody
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const question = (body.question ?? '').trim()
  if (question.length < 3) {
    return NextResponse.json({ error: 'Ask a question (min 3 characters).' }, { status: 400 })
  }
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ error: `Question is too long (max ${MAX_QUESTION}).` }, { status: 400 })
  }

  // Guarded BEFORE the stream opens. A blocked prompt should be an ordinary
  // 400 the client can render, not a stream that opens and immediately closes
  // with an error the UI has to special-case.
  const inbound = guardInbound(question)
  if (!inbound.ok) {
    return NextResponse.json({ error: summarise(inbound) }, { status: 400 })
  }

  const trace = new Trace('copilot', { userId: user.id.slice(0, 8) })
  const steps: RunStep[] = [
    {
      name: 'guard input',
      kind: 'guard',
      run: async () => ({ text: '' }),
    },
    {
      name: 'answer',
      kind: 'llm',
      run: async (signal) => {
        if (signal.aborted) return {}
        if (!hasProvider()) {
          // Local-first, same rule as P7: no credential configured is a working
          // degraded path, not a 500. The operator is told which one is missing.
          return {
            text:
              'No language-model provider is configured, so this run has no model to answer with. ' +
              'Set one of the provider keys, or point the stack at a local Ollama instance.',
            costEur: 0,
            tokens: 0,
            provider: 'none',
          }
        }
        const result = await complete(
          [
            {
              role: 'system',
              content:
                'You are the OMNEX copilot. Answer concisely. If you do not know, say so rather ' +
                'than guessing.',
            },
            { role: 'user', content: question },
          ],
          { maxTokens: 800, temperature: 0.2, taskProfile: 'fast' },
        )

        // `display` rather than `publish`: this text goes to the person who
        // asked for it, which is the standard the channel is graded against.
        const outbound = guardOutbound(result.text, { channel: 'display' })
        return {
          text: outbound.ok ? result.text : outbound.redacted,
          provider: result.provider,
          model: result.model,
        }
      },
    },
  ]

  return new Response(toSSE(trace, steps, { signal: req.signal }), { headers: SSE_HEADERS })
}
