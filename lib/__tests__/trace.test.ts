import { describe, it, expect } from 'vitest'
import { Trace } from '@/lib/core/agents/trace'

describe('Trace', () => {
  it('preserves the shape of the run, not a flat list', () => {
    const t = new Trace('workflow')
    const step = t.root.child('step 1', 'step')
    const llm = step.child('generate', 'llm')
    llm.end('ok')
    step.end('ok')
    t.root.end('ok')

    // Parent links are what make "which step, inside which run" answerable.
    expect(llm.record.parentId).toBe(step.record.id)
    expect(step.record.parentId).toBe(t.root.record.id)
    expect(t.root.record.parentId).toBeNull()
  })

  it('records the provider that actually served, so a silent fallback is visible', () => {
    const t = new Trace('workflow')
    const llm = t.root.child('generate', 'llm').attr('intended', 'fal')
    llm.set({ provider: 'pollinations', model: 'flux', tokens: { prompt: 100, completion: 40 } })
    llm.end('ok')

    // The whole point: intent and reality are separate fields.
    expect(llm.record.attrs?.intended).toBe('fal')
    expect(llm.record.provider).toBe('pollinations')
  })

  it('returns the failing path root-first instead of the whole tree', () => {
    const t = new Trace('workflow')
    const a = t.root.child('step A', 'step')
    a.child('ok call', 'llm').end('ok')
    a.end('ok')
    const b = t.root.child('step B', 'step')
    const bad = b.child('tool call', 'tool')
    bad.end('error', 'connection refused')
    b.end('error', 'child failed')
    t.root.end('error', 'run failed')

    const path = t.failurePath().map((s) => s.name)
    expect(path).toEqual(['workflow', 'step B', 'tool call'])
    expect(path).not.toContain('step A')
  })

  it('around() closes the span on both the success and the throw path', async () => {
    const t = new Trace('workflow')
    await t.root.child('good', 'io').around(async () => 'value')
    await expect(
      t.root.child('bad', 'io').around(async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')

    const good = t.spans.find((s) => s.name === 'good')!
    const bad = t.spans.find((s) => s.name === 'bad')!
    expect(good.status).toBe('ok')
    expect(bad.status).toBe('error')
    expect(bad.error).toBe('boom')
    // A span left open would silently corrupt every duration total.
    expect(good.durationMs).toBeGreaterThanOrEqual(0)
    expect(bad.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('ending twice does not rewrite the first outcome', () => {
    const t = new Trace('workflow')
    const s = t.root.child('once', 'step')
    s.end('ok')
    const firstEnd = s.record.endedAt
    s.end('error', 'late failure')
    expect(s.record.status).toBe('ok')
    expect(s.record.endedAt).toBe(firstEnd)
  })

  it('computes totals rather than trusting a running tally', () => {
    const t = new Trace('workflow')
    t.root.child('a', 'llm').set({ tokens: { prompt: 100, completion: 50 }, costEur: 0.01 }).end('ok')
    t.root.child('b', 'llm').set({ tokens: { prompt: 200, completion: 25 }, costEur: 0.02 }).end('ok')
    t.root.child('c', 'tool').end('error', 'nope')
    t.root.end('error')

    const totals = t.totals()
    expect(totals.tokens).toBe(375)
    expect(totals.costEur).toBe(0.03)
    expect(totals.errors).toBe(2)   // the failed tool and the failed root
  })

  it('renders a tree a human can read without a viewer', () => {
    const t = new Trace('run')
    const s = t.root.child('step', 'step')
    s.child('call', 'llm').set({ provider: 'groq' }).end('error', 'rate limited')
    s.end('error')
    t.root.end('error')

    const out = t.render()
    expect(out).toContain('[x] call (llm)')
    expect(out).toContain('via groq')
    expect(out).toContain('rate limited')
    // Depth is expressed as indentation, so nesting survives a plain log.
    expect(out.split('\n')[2]).toMatch(/^\s{4}/)
  })
})
