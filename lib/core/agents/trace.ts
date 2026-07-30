/**
 * Traces — making an agent run inspectable after it has finished.
 *
 * The gap this closes, in the words of Docker's 2026 State of Agentic AI report:
 * 30% of teams cannot test, debug or monitor complex orchestrations, and 37%
 * find orchestration frameworks too brittle for production. Both describe the
 * same thing — a run that produced a wrong answer and left no evidence of where
 * it went wrong.
 *
 * Logs do not solve this. A log line records that something happened; it does
 * not record what it happened INSIDE. When five agents, three fallback providers
 * and a retry loop share one request, the question is never "what happened" but
 * "which step, on which provider, after which fallback, with what input".
 *
 * A trace is a tree of spans. Each span knows its parent, so the shape of the
 * run is preserved rather than flattened into interleaved lines. Spans record
 * the provider that ACTUALLY served — not the one intended — because a silent
 * fallback is precisely the thing you are trying to see.
 */

export type SpanKind = 'run' | 'step' | 'llm' | 'tool' | 'retrieval' | 'guard' | 'io'

export interface SpanRecord {
  id: string
  parentId: string | null
  name: string
  kind: SpanKind
  startedAt: number
  endedAt?: number
  durationMs?: number
  status: 'running' | 'ok' | 'error'
  error?: string
  /** Provider that actually served, when one did. */
  provider?: string
  model?: string
  tokens?: { prompt?: number; completion?: number }
  costEur?: number
  /** Small, non-sensitive facts. Never raw prompts or customer data. */
  attrs?: Record<string, string | number | boolean>
}

let counter = 0
const nextId = () => `s${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`

export class Span {
  constructor(private readonly trace: Trace, readonly record: SpanRecord) {}

  /** Open a child span — this is what preserves the shape of the run. */
  child(name: string, kind: SpanKind, attrs?: SpanRecord['attrs']): Span {
    return this.trace.open(name, kind, this.record.id, attrs)
  }

  set(fields: Partial<Pick<SpanRecord, 'provider' | 'model' | 'tokens' | 'costEur'>>): this {
    Object.assign(this.record, fields)
    return this
  }

  attr(key: string, value: string | number | boolean): this {
    this.record.attrs = { ...this.record.attrs, [key]: value }
    return this
  }

  end(status: 'ok' | 'error' = 'ok', error?: string): void {
    if (this.record.endedAt) return          // ending twice must not rewrite history
    this.record.endedAt = Date.now()
    this.record.durationMs = this.record.endedAt - this.record.startedAt
    this.record.status = status
    if (error) this.record.error = error.slice(0, 400)
  }

  /** Run `fn` inside this span, closing it correctly on both paths. */
  async around<T>(fn: (span: Span) => Promise<T>): Promise<T> {
    try {
      const out = await fn(this)
      this.end('ok')
      return out
    } catch (e) {
      this.end('error', e instanceof Error ? e.message : String(e))
      throw e
    }
  }
}

export class Trace {
  readonly spans: SpanRecord[] = []
  readonly root: Span

  constructor(readonly name: string, attrs?: SpanRecord['attrs']) {
    this.root = this.open(name, 'run', null, attrs)
  }

  open(name: string, kind: SpanKind, parentId: string | null, attrs?: SpanRecord['attrs']): Span {
    const record: SpanRecord = {
      id: nextId(),
      parentId,
      name,
      kind,
      startedAt: Date.now(),
      status: 'running',
      ...(attrs ? { attrs } : {}),
    }
    this.spans.push(record)
    return new Span(this, record)
  }

  /** Totals for the run summary — computed, never accumulated by hand. */
  totals(): { spans: number; errors: number; tokens: number; costEur: number; durationMs: number } {
    const tokens = this.spans.reduce((n, s) => n + (s.tokens?.prompt ?? 0) + (s.tokens?.completion ?? 0), 0)
    const costEur = this.spans.reduce((n, s) => n + (s.costEur ?? 0), 0)
    return {
      spans: this.spans.length,
      errors: this.spans.filter((s) => s.status === 'error').length,
      tokens,
      costEur: Math.round(costEur * 10_000) / 10_000,
      durationMs: this.root.record.durationMs ?? (Date.now() - this.root.record.startedAt),
    }
  }

  /**
   * The failing path, root-first. This is the answer to "where did it go wrong"
   * without reading the whole tree — the question a log cannot answer.
   */
  failurePath(): SpanRecord[] {
    const failed = this.spans.filter((s) => s.status === 'error')
    if (failed.length === 0) return []
    const deepest = failed[failed.length - 1]!
    const byId = new Map(this.spans.map((s) => [s.id, s]))
    const path: SpanRecord[] = []
    let cur: SpanRecord | undefined = deepest
    while (cur) {
      path.unshift(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return path
  }

  /** Indented tree, readable in a terminal or a log without a viewer. */
  render(): string {
    const children = new Map<string | null, SpanRecord[]>()
    for (const s of this.spans) {
      const list = children.get(s.parentId) ?? []
      list.push(s)
      children.set(s.parentId, list)
    }
    const lines: string[] = []
    const walk = (parentId: string | null, depth: number): void => {
      for (const s of children.get(parentId) ?? []) {
        const mark = s.status === 'error' ? 'x' : s.status === 'running' ? '~' : 'ok'
        const ms = s.durationMs !== undefined ? `${s.durationMs}ms` : '…'
        const who = s.provider ? ` via ${s.provider}` : ''
        const tok = s.tokens ? ` ${(s.tokens.prompt ?? 0) + (s.tokens.completion ?? 0)}tok` : ''
        const err = s.error ? `  ! ${s.error.slice(0, 90)}` : ''
        lines.push(`${'  '.repeat(depth)}[${mark}] ${s.name} (${s.kind}) ${ms}${who}${tok}${err}`)
        walk(s.id, depth + 1)
      }
    }
    walk(null, 0)
    return lines.join('\n')
  }

  /** Flat rows for persistence — one insert, no nested writes. */
  toRows(runId: string): Array<SpanRecord & { run_id: string }> {
    return this.spans.map((s) => ({ ...s, run_id: runId }))
  }
}
