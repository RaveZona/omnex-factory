import { describe, it, expect } from 'vitest'
import { RunBudget, estimateCostEur, DEFAULT_LIMITS } from '@/lib/core/agents/budget'

describe('RunBudget', () => {
  it('allows work while every ceiling has room', () => {
    const b = new RunBudget()
    expect(b.check().ok).toBe(true)
  })

  it('stops on passes — catches a loop that thrashes without spending', () => {
    const b = new RunBudget({ maxPasses: 3 })
    for (let i = 0; i < 3; i++) {
      expect(b.check().ok).toBe(true)
      b.record({ tokens: 10 })
    }
    const c = b.check()
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('passes')
    // The message has to name the number, or a log line cannot be acted on.
    expect(c.message).toContain('3')
  })

  it('stops on tokens — catches one runaway generation a pass cap would miss', () => {
    const b = new RunBudget({ maxPasses: 100, maxTokens: 1000 })
    b.record({ tokens: 1200 })
    const c = b.check()
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('tokens')
  })

  it('stops on cost before passes or tokens are exhausted', () => {
    const b = new RunBudget({ maxPasses: 100, maxTokens: 1_000_000, maxCostEur: 0.10 })
    b.record({ tokens: 100, costEur: 0.15 })
    const c = b.check()
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('cost')
  })

  it('stops on wall clock even with nothing recorded', () => {
    const b = new RunBudget({ maxWallMs: -1 })
    const c = b.check()
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('wall_clock')
  })

  it('default wall limit sits under the 60s platform ceiling', () => {
    // If this ever exceeds the platform timeout, the run dies without a reason —
    // which is the exact failure the budget exists to prevent.
    expect(DEFAULT_LIMITS.maxWallMs).toBeLessThan(60_000)
  })

  it('proves a free run spent nothing rather than assuming it', () => {
    const b = new RunBudget()
    b.record({ tokens: 5000, costEur: estimateCostEur('groq', 4000, 1000) })
    b.record({ tokens: 3000, costEur: estimateCostEur('ollama', 2000, 1000) })
    expect(b.wasFree()).toBe(true)
  })

  it('treats an unknown provider as paid, so real spend cannot hide', () => {
    const known = estimateCostEur('groq', 1_000_000, 1_000_000)
    const unknown = estimateCostEur('some-new-vendor', 1_000_000, 1_000_000)
    expect(known).toBe(0)
    expect(unknown).toBeGreaterThan(0)
  })

  it('reports remaining budget so a caller can shrink the next step', () => {
    const b = new RunBudget({ maxPasses: 5, maxTokens: 1000 })
    b.record({ tokens: 400 })
    const c = b.check()
    expect(c.remaining.passes).toBe(4)
    expect(c.remaining.tokens).toBe(600)
  })
})
