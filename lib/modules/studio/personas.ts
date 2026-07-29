/**
 * AI Ad Studio — virtual model personas.
 *
 * A synthetic model that can hold or wear the customer's product is worth more
 * than the scene behind it: cosmetics and fashion pay for the model.
 *
 * The finding that shaped this file: "an attractive model" is not one thing.
 * An editorial (Vogue) prompt and a glamour (pageant) prompt produce completely
 * different faces, and a customer who wanted one will call the other ugly. So
 * the school is an explicit choice, not a hidden default.
 *
 * Two more measured lessons are encoded here:
 *   1. Shot type must LEAD the prompt. A long facial description first made the
 *      model ignore "penthouse interior" and return tight close-ups every time.
 *   2. Glamour prompts drift toward an airbrushed "AI beauty filter" look, so
 *      REALISM anchors (visible pores, subsurface scattering, unretouched) are
 *      appended to every persona — they are what keeps it a photograph.
 *
 * Boundaries, encoded rather than assumed: personas are fully synthetic and never
 * describe a real, named or identifiable person, and output carries an
 * AI-generated disclosure (see AI_DISCLOSURE).
 */

export type SchoolId = 'high_fashion' | 'glamour' | 'editorial' | 'natural' | 'commercial'

export interface BeautySchool {
  id: SchoolId
  name: string
  /** One line so a non-photographer can choose correctly the first time. */
  blurb: string
  /** Face, makeup and hair language. */
  look: string
  /** Lighting that belongs to this school — the biggest driver of the "feel". */
  light: string
  suits: string[]
}

/**
 * Skin language, tuned by measurement. The first attempt ("visible pores and
 * natural sebum sheen, no airbrushing") over-fired: at close framing it produced
 * freckled, rough, almost damaged-looking skin. This wording lands between
 * plastic and grungy — flawless, but still a photograph.
 */
const CLEAR_SKIN =
  'clear even luminous complexion with fine natural skin texture, subtle healthy sheen, no heavy retouching'

/** Appended to every persona: what keeps the render a photograph, not an illustration. */
const REALISM =
  'natural asymmetric catchlights in the eyes, real photograph, photorealistic, tack sharp eyes, high dynamic range'

/**
 * Removes the tells. IMPORTANT: this only reaches providers that accept a
 * negative prompt. Pollinations does NOT — a run with these exclusions still
 * returned freckles — so anything that MUST be excluded has to be phrased
 * positively in the prompt itself (see CLEAR_SKIN). Treat this list as a bonus
 * on paid providers, never as a guarantee.
 */
export const PERSONA_NEGATIVE =
  'airbrushed, plastic skin, waxy skin, illustration, 3d render, cgi, doll-like, uncanny, '
  + 'freckles, blemishes, acne, rough skin, scars, macro close-up, '
  + 'extra fingers, duplicate limbs, bad anatomy, deformed eyes, glowing eyes, crooked teeth, '
  + 'watermark, text, logo, oversaturated, blurry'

/** Shown with any published persona render — a requirement, and a selling point to agencies. */
export const AI_DISCLOSURE = 'AI-generated model. Not a real person.'

export const SCHOOLS: BeautySchool[] = [
  {
    // The founder's reference direction: red-carpet "cool girl". Highest-rated of
    // everything generated, and the school that finally produced convincing eyes.
    id: 'high_fashion',
    name: 'High Fashion',
    blurb: 'Red-carpet cool — striking bone structure, real eyes, flawless but not plastic.',
    look: 'pale ice-blue grey eyes with a distinct dark limbal ring and detailed fibrous iris texture, '
      + 'natural uneven catchlights, realistic eyelids and lashes, '
      + 'thick straight strong dark eyebrows, sharp high cheekbones, angular defined jawline, '
      + 'wet-look slicked-back dark hair, cool composed unsmiling gaze, deep red matte lipstick, '
      + CLEAR_SKIN,
    light: 'direct on-camera flash like a red carpet photograph, crisp specular highlights, cool colour grade, '
      + 'blurred dark event background',
    suits: ['luxury', 'fashion', 'perfume', 'jewellery'],
  },
  {
    id: 'glamour',
    name: 'Glamour',
    blurb: 'Pageant beauty — symmetrical, polished, radiant. The crowd-pleaser.',
    look: 'flawlessly symmetrical face, large bright almond eyes with long lashes, defined cheekbones, '
      + 'full glossy lips, radiant confident smile, voluminous glossy waved hair, polished glamour makeup, fine jewellery',
    light: 'bright clamshell beauty lighting, large softbox with reflector fill, luminous even skin, minimal shadows, high-key background',
    suits: ['cosmetics', 'jewellery', 'haircare', 'perfume'],
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'Vogue fashion — striking, unconventional, moody. Sells as art.',
    look: 'striking distinctive bone structure, strong brows, natural freckles, composed unsmiling expression, '
      + 'sculptural hairstyle, minimal makeup, designer styling',
    light: 'directional golden-hour rim light with deep soft shadows, single key source, moody low-key background',
    suits: ['fashion', 'luxury', 'eyewear', 'watches'],
  },
  {
    id: 'natural',
    name: 'Natural',
    blurb: 'Girl-next-door — warm, believable, no-makeup makeup. Best for trust.',
    look: 'warm approachable face, genuine relaxed smile, light freckles, soft loose hair, '
      + 'no-makeup makeup, simple everyday clothing',
    light: 'soft diffused daylight from a large window, gentle even shadows, bright airy background',
    suits: ['skincare', 'wellness', 'food', 'baby care'],
  },
  {
    id: 'commercial',
    name: 'Commercial',
    blurb: 'Ad-agency polish — friendly, energetic, brand-safe. The workhorse.',
    look: 'friendly attractive face, bright open smile showing teeth, healthy glowing skin, '
      + 'neat contemporary hairstyle, clean modern styling',
    light: 'bright even three-point commercial lighting, crisp and cheerful, clean seamless background',
    suits: ['retail', 'tech', 'fitness', 'services'],
  },
]

export type ShotId = 'beauty' | 'portrait' | 'half' | 'full'

export interface ShotType {
  id: ShotId
  name: string
  /** MUST lead the prompt — measured: framing described later is ignored. */
  lead: string
  usedFor: string
}

export const SHOTS: ShotType[] = [
  { id: 'beauty',   name: 'Beauty close-up',   lead: 'glamour beauty portrait, head and shoulders,',            usedFor: 'Cosmetics, skincare, jewellery detail' },
  { id: 'portrait', name: 'Portrait',          lead: 'close-up editorial portrait,',                             usedFor: 'Profile images, testimonials' },
  { id: 'half',     name: 'Half body',         lead: 'half-body editorial fashion photograph,',                  usedFor: 'Product held in hand, apparel tops' },
  { id: 'full',     name: 'Full length',       lead: 'full-length editorial fashion photograph, full body in frame,', usedFor: 'Apparel, footwear, lifestyle scenes' },
]

export interface BuildPersonaInput {
  school: SchoolId
  shot: ShotId
  /** Optional setting, e.g. "modern penthouse with Scandinavian furniture". */
  setting?: string
  /** Optional product the model holds or wears — the Ad Studio crossover. */
  product?: string
  /** Age is fixed to an adult range; callers may narrow within it. */
  age?: 22 | 25 | 28 | 32
}

export interface BuiltPersona {
  prompt: string
  negative: string
  disclosure: string
}

export function getSchool(id: SchoolId): BeautySchool | undefined {
  return SCHOOLS.find((s) => s.id === id)
}

export function getShot(id: ShotId): ShotType | undefined {
  return SHOTS.find((s) => s.id === id)
}

/**
 * Compose a persona prompt. Order is deliberate and measured:
 * shot type → subject → look → product → setting → light → realism.
 */
export function buildPersona(input: BuildPersonaInput): BuiltPersona {
  const school = getSchool(input.school) ?? SCHOOLS[0]!
  const shot = getShot(input.shot) ?? SHOTS[0]!
  const age = input.age ?? 25

  const parts = [
    shot.lead,
    `of an original fictional ${age}-year-old woman,`,
    `${school.look},`,
    input.product ? `presenting ${input.product} naturally in frame,` : '',
    input.setting ? `${input.setting},` : '',
    `${school.light},`,
    REALISM,
  ].filter(Boolean)

  return {
    prompt: parts.join(' '),
    negative: PERSONA_NEGATIVE,
    disclosure: AI_DISCLOSURE,
  }
}
