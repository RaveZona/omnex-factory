/**
 * AI Ad Studio — scene presets.
 *
 * THIS FILE IS THE PRODUCT. A generic prompt gives a generic image; these
 * presets encode what actually separates "an AI picture" from "an ad I can
 * publish": a named lighting setup, a real surface, a lens/DOF choice, and a
 * negative list that removes the tells (extra limbs, fake text, watermarks).
 *
 * Each preset also carries a `strength` — how far the render may travel from
 * the customer's own photo. Measured behaviour: high strength makes gorgeous
 * scenes but drifts product details (a live test turned yellow laces white).
 * Brand-critical scenes are therefore pinned low; mood scenes may go higher.
 */

export type SceneId =
  | 'marble_studio' | 'concrete_dramatic' | 'sunlit_linen' | 'glass_water'
  | 'dark_luxury' | 'nature_stone' | 'pastel_clean' | 'neon_night'

export interface ScenePreset {
  id: SceneId
  name: string
  /** One line the customer understands without knowing photography. */
  blurb: string
  /** Best-fit product categories, used to order the picker sensibly. */
  suits: string[]
  /** The scene half of the prompt (product description is prepended at runtime). */
  scene: string
  /** How far the render may travel from the uploaded photo (0-1). */
  strength: number
}

/** Craft language appended to every scene — the part that reads as "shot", not "rendered". */
const CRAFT =
  'shot on a full-frame camera with an 85mm lens, shallow depth of field, true-to-life colour, '
  + 'crisp product edges, natural material texture, commercial advertising photography, high detail'

/** Removes the usual generative tells. Providers that support it receive this separately. */
export const NEGATIVE =
  'text, watermark, logo overlay, caption, extra objects, duplicated product, distorted proportions, '
  + 'plastic-looking surface, oversaturated, blurry product, cluttered background, hands, people'

export const SCENES: ScenePreset[] = [
  {
    id: 'marble_studio',
    name: 'Marble Studio',
    blurb: 'Clean white marble, soft daylight — the default premium look.',
    suits: ['cosmetics', 'skincare', 'jewellery', 'watches'],
    scene: 'on a polished white marble podium, soft diffused daylight from the left, gentle shadow falloff, '
      + 'warm neutral background, subtle reflection on the stone',
    strength: 0.45,
  },
  {
    id: 'concrete_dramatic',
    name: 'Concrete & Drama',
    blurb: 'Raw concrete, hard side light. Reads modern and expensive.',
    suits: ['tech', 'sneakers', 'audio', 'tools'],
    scene: 'on a raw concrete plinth, dramatic hard side lighting, deep shadows, dark charcoal background, '
      + 'single key light with a soft rim highlight',
    strength: 0.5,
  },
  {
    id: 'sunlit_linen',
    name: 'Sunlit Linen',
    blurb: 'Natural linen and window light — warm, editorial, human.',
    suits: ['skincare', 'candles', 'food', 'home'],
    scene: 'on rumpled natural linen in warm late-afternoon window light, soft window-frame shadows across the surface, '
      + 'airy off-white background, editorial lifestyle mood',
    strength: 0.45,
  },
  {
    id: 'glass_water',
    name: 'Glass & Water',
    blurb: 'Wet glass and droplets — fresh, clinical, hydrating.',
    suits: ['skincare', 'beverages', 'supplements'],
    scene: 'on a wet glass surface with fine water droplets and light caustics, cool clean lighting, '
      + 'pale blue-grey gradient background, crisp refreshing mood',
    strength: 0.4,
  },
  {
    id: 'dark_luxury',
    name: 'Dark Luxury',
    blurb: 'Black satin and a single beam. For premium price points.',
    suits: ['perfume', 'watches', 'spirits', 'jewellery'],
    scene: 'on black satin fabric with a single narrow beam of light, rich deep blacks, subtle golden rim light, '
      + 'smoke haze in the background, luxury campaign mood',
    strength: 0.4,
  },
  {
    id: 'nature_stone',
    name: 'Nature & Stone',
    blurb: 'Moss, river stone, dappled light — organic and honest.',
    suits: ['natural cosmetics', 'supplements', 'outdoor', 'food'],
    scene: 'on weathered river stone surrounded by moss and small ferns, dappled forest light, '
      + 'soft green bokeh background, organic natural mood',
    strength: 0.45,
  },
  {
    id: 'pastel_clean',
    name: 'Pastel Clean',
    blurb: 'Flat pastel backdrop — bright, scroll-stopping, social-first.',
    suits: ['cosmetics', 'accessories', 'stationery', 'toys'],
    scene: 'on a seamless soft pastel backdrop with a coloured geometric riser, bright even lighting, '
      + 'minimal contemporary styling, playful modern e-commerce mood',
    strength: 0.5,
  },
  {
    id: 'neon_night',
    name: 'Neon Night',
    blurb: 'Wet asphalt and neon spill — energetic, street, night.',
    suits: ['sneakers', 'tech', 'energy drinks', 'streetwear'],
    scene: 'on wet reflective asphalt at night with magenta and cyan neon spill, moody atmosphere, '
      + 'shallow depth of field, urban night campaign mood',
    strength: 0.55,
  },
]

export type FormatId = 'square' | 'portrait' | 'story' | 'wide'

export interface FormatPreset {
  id: FormatId
  name: string
  aspect: '1:1' | '4:5' | '9:16' | '16:9'
  /** Where this format is actually used — helps the customer choose. */
  usedFor: string
}

export const FORMATS: FormatPreset[] = [
  { id: 'square',   name: 'Square',   aspect: '1:1',  usedFor: 'Instagram feed, product grid' },
  { id: 'portrait', name: 'Portrait', aspect: '4:5',  usedFor: 'Instagram/Facebook ads — most feed space' },
  { id: 'story',    name: 'Story',    aspect: '9:16', usedFor: 'Stories, Reels, TikTok' },
  { id: 'wide',     name: 'Wide',     aspect: '16:9', usedFor: 'Website hero, YouTube, email header' },
]

/** Fidelity mode — the honest trade-off, exposed to the customer instead of hidden. */
export type FidelityId = 'faithful' | 'balanced' | 'creative'

export interface FidelityPreset {
  id: FidelityId
  name: string
  blurb: string
  /** Multiplier applied to the scene's own strength. */
  factor: number
}

export const FIDELITY: FidelityPreset[] = [
  { id: 'faithful', name: 'Faithful',  blurb: 'Keeps your product exact. Best when colour and logo must match.', factor: 0.7 },
  { id: 'balanced', name: 'Balanced',  blurb: 'Recommended. Strong scene, product stays recognisable.',          factor: 1.0 },
  { id: 'creative', name: 'Creative',  blurb: 'Boldest scenes. Fine details may shift — check before publishing.', factor: 1.35 },
]

export interface BuildPromptInput {
  /** What the customer says their product is, e.g. "matte black skincare bottle". */
  product: string
  scene: SceneId
  fidelity?: FidelityId
}

export interface BuiltPrompt {
  prompt: string
  negative: string
  strength: number
}

export function getScene(id: SceneId): ScenePreset | undefined {
  return SCENES.find((s) => s.id === id)
}

export function getFormat(id: FormatId): FormatPreset | undefined {
  return FORMATS.find((f) => f.id === id)
}

/**
 * Compose the final prompt. The product description leads (so the subject
 * dominates), the scene follows, craft language closes.
 */
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const scene = getScene(input.scene) ?? SCENES[0]!
  const fidelity = FIDELITY.find((f) => f.id === (input.fidelity ?? 'balanced')) ?? FIDELITY[1]!
  const product = input.product.trim() || 'the product'

  return {
    prompt: `professional advertising photograph of ${product}, ${scene.scene}, ${CRAFT}`,
    negative: NEGATIVE,
    // Clamped so a "creative" preset can never drift into unrecognisable territory.
    strength: Math.min(0.85, Math.max(0.2, scene.strength * fidelity.factor)),
  }
}
