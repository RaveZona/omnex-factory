/**
 * Guardrails — checks that run on what an agent produces, before it leaves.
 *
 * This is not hypothetical. An agent published a stale cold pitch to a named
 * company, including their funding amount, as a public post on the founder's
 * profile. Nothing inspected it first. The generation was fine; there was simply
 * no gate between "text exists" and "text is public".
 *
 * Two directions, because they protect against different things:
 *   inbound  — text arriving from outside (a scraped page, a customer field)
 *              that is about to be placed inside a prompt. Prompt injection.
 *   outbound — text an agent produced that is about to be published, emailed or
 *              shown. Leaked secrets, invented claims, addressing the wrong party.
 *
 * Every check returns findings rather than throwing. A caller decides whether a
 * finding blocks: publishing is stricter than drafting, and a single policy
 * would be wrong for both.
 */

export type Severity = 'block' | 'warn'

export interface Finding {
  rule: string
  severity: Severity
  message: string
  /** The offending excerpt, truncated — never the whole document. */
  evidence?: string
}

export interface GuardResult {
  ok: boolean
  findings: Finding[]
  /** Text with anything blocking redacted, safe to log. */
  redacted: string
}

const excerpt = (s: string, at: number, len = 60): string =>
  s.slice(Math.max(0, at - 10), Math.min(s.length, at + len)).replace(/\s+/g, ' ').trim()

// ── Secrets ────────────────────────────────────────────────────────────────
// Ordered most-specific first so a generic pattern cannot claim a known key type.
const SECRET_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'stripe_live_key', re: /\bsk_live_[A-Za-z0-9]{16,}/g },
  { rule: 'stripe_test_key', re: /\bsk_test_[A-Za-z0-9]{16,}/g },
  { rule: 'supabase_secret', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { rule: 'openai_key', re: /\bsk-[A-Za-z0-9]{32,}/g },
  { rule: 'hf_token', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { rule: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { rule: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{30,}/gi },
  { rule: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]

// ── Prompt injection ───────────────────────────────────────────────────────
// Aimed at text we FETCHED, where an instruction has no business appearing.
const INJECTION_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'override_instructions', re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi },
  { rule: 'role_reassignment', re: /\b(you\s+are\s+now|from\s+now\s+on\s+you|act\s+as)\s+(a|an|the)?\s*\w+/gi },
  { rule: 'system_prompt_probe', re: /\b(reveal|print|show|repeat|output)\s+(your\s+)?(system\s+prompt|instructions|initial\s+prompt)/gi },
  { rule: 'exfiltration_request', re: /\b(send|post|upload|email)\s+(the\s+)?(api\s+key|token|secret|credentials?|env)/gi },
  { rule: 'fake_system_turn', re: /(^|\n)\s*(system|assistant)\s*:\s*/gi },
]

/**
 * Check text that is ABOUT to be placed inside a prompt.
 * A scraped page has no legitimate reason to instruct the model.
 */
export function guardInbound(text: string): GuardResult {
  const findings: Finding[] = []
  let redacted = text

  for (const { rule, re } of INJECTION_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) {
      findings.push({
        rule,
        severity: 'block',
        message: 'Fetched content contains an instruction aimed at the model.',
        evidence: excerpt(text, m.index),
      })
      redacted = redacted.replace(re, '[removed: injected instruction]')
    }
  }

  for (const { rule, re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    if (re.test(text)) {
      findings.push({ rule, severity: 'warn', message: 'Fetched content looks like it contains a credential.' })
      redacted = redacted.replace(re, '[redacted]')
    }
  }

  return { ok: !findings.some((f) => f.severity === 'block'), findings, redacted }
}

export interface OutboundContext {
  /** Where this is going. Publishing is held to a stricter standard than drafting. */
  channel: 'publish' | 'email' | 'display'
  /** Company or person the text is meant to address, when there is one. */
  intendedRecipient?: string
  /** Maximum length the destination accepts. */
  maxLength?: number
}

/**
 * Check text an agent produced, before it is published, emailed or shown.
 */
export function guardOutbound(text: string, ctx: OutboundContext): GuardResult {
  const findings: Finding[] = []
  let redacted = text

  // A secret in outbound text is always blocking, whatever the channel.
  for (const { rule, re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) {
      findings.push({ rule, severity: 'block', message: 'Output contains something shaped like a credential.', evidence: excerpt(text, m.index, 20) })
      redacted = redacted.replace(re, '[redacted]')
    }
  }

  if (!text.trim()) {
    findings.push({ rule: 'empty', severity: 'block', message: 'Output is empty.' })
  }

  if (ctx.maxLength && text.length > ctx.maxLength) {
    findings.push({ rule: 'too_long', severity: 'block', message: `Output is ${text.length} characters; the destination accepts ${ctx.maxLength}.` })
  }

  // Unfilled template slots reaching a customer read as broken software.
  const placeholder = /\{\{[^}]+\}\}|\[(?:INSERT|YOUR|COMPANY|NAME|TODO)[^\]]*\]|\bLorem ipsum\b/i.exec(text)
  if (placeholder) {
    findings.push({ rule: 'unfilled_placeholder', severity: 'block', message: 'Output still contains a template placeholder.', evidence: excerpt(text, placeholder.index) })
  }

  if (ctx.channel === 'publish') {
    // The Echelon incident: a message written TO one company, published TO everyone.
    const direct = /\b(want|would you like|are you free|can we|shall we)\b[^.?!]*\?/i.exec(text)
    const namesRecipient = ctx.intendedRecipient
      ? new RegExp(`\\b${ctx.intendedRecipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
      : false
    if (direct && namesRecipient) {
      findings.push({
        rule: 'private_pitch_published',
        severity: 'block',
        message: 'This reads as a direct approach to one named company, not a public post.',
        evidence: excerpt(text, direct.index),
      })
    }

    // Funding figures about a third party are a strong signal of a scraped pitch.
    const funding = /\$\s?\d+(\.\d+)?\s?(M|B|million|billion)\b|\b(seed|series [a-d])\s+(round|funding)\b/i.exec(text)
    if (funding) {
      findings.push({
        rule: 'third_party_funding_claim',
        severity: 'warn',
        message: 'Output cites funding figures about another company.',
        evidence: excerpt(text, funding.index),
      })
    }
  }

  return { ok: !findings.some((f) => f.severity === 'block'), findings, redacted }
}

/** One-line summary for logs and for the run record. */
export function summarise(result: GuardResult): string {
  if (result.findings.length === 0) return 'clean'
  return result.findings.map((f) => `${f.severity}:${f.rule}`).join(', ')
}
