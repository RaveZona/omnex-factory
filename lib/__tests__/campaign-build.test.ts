import { describe, it, expect } from 'vitest'
import { buildCampaignPrompt } from '@/lib/modules/studio/build'
import { CATEGORIES } from '@/lib/modules/studio/categories'

describe('campaign prompt builder', () => {
  it('leads every category with its shot grammar, never the subject', () => {
    for (const c of CATEGORIES) {
      const built = buildCampaignPrompt({ category: c.id, scene: c.scenes[0]!.id, subject: 'ZZZ_SUBJECT' })
      expect(built.prompt.startsWith(c.lead), `${c.id} must lead with shot grammar`).toBe(true)
      // The subject must appear AFTER the lead — the measured framing bug.
      expect(built.prompt.indexOf('ZZZ_SUBJECT')).toBeGreaterThan(0)
    }
  })

  it('injects a persona only for person-led categories', () => {
    const fashion = buildCampaignPrompt({ category: 'fashion', scene: 'studio_grey', subject: 'wool coat' })
    const product = buildCampaignPrompt({ category: 'product', scene: 'seamless_white', subject: 'water bottle' })
    expect(fashion.prompt).toContain('limbal ring')   // high_fashion school look
    expect(product.prompt).not.toContain('limbal ring')
  })

  it('flags disclosure exactly when a synthetic person is in frame', () => {
    expect(buildCampaignPrompt({ category: 'ambassador', scene: 'clean_studio', subject: 'a serum' }).needsDisclosure).toBe(true)
    expect(buildCampaignPrompt({ category: 'jewellery', scene: 'black_velvet', subject: 'a ring' }).needsDisclosure).toBe(false)
  })

  it('clamps strength so no fidelity setting destroys the subject', () => {
    for (const c of CATEGORIES) {
      for (const s of c.scenes) {
        for (const f of ['faithful', 'balanced', 'creative'] as const) {
          const { strength } = buildCampaignPrompt({ category: c.id, scene: s.id, subject: 'x', fidelity: f })
          expect(strength).toBeGreaterThanOrEqual(0.2)
          expect(strength).toBeLessThanOrEqual(0.85)
        }
      }
    }
  })

  it('falls back safely on unknown category or scene', () => {
    const built = buildCampaignPrompt({ category: 'nope' as never, scene: 'nope', subject: 'thing' })
    expect(built.prompt.length).toBeGreaterThan(40)
  })

  it('covers every category the founder asked for', () => {
    const ids = CATEGORIES.map((c) => c.id)
    for (const needed of ['fashion','cosmetics','jewellery','perfume','watches','automotive','hospitality','dining','product','lifestyle','ambassador']) {
      expect(ids, `missing ${needed}`).toContain(needed)
    }
  })
})
