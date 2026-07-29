/**
 * Prompt composition for AI Ad Studio, across all campaign categories.
 *
 * Order is deliberate and measured:
 *   shot grammar (lead) → subject → scene → craft
 *
 * The lead MUST come first. A long subject description placed before the framing
 * caused the model to ignore the requested setting entirely and return tight
 * close-ups every time; moving the shot type to the front fixed it in one change.
 *
 * For person-led categories (fashion, ambassador) the persona look is injected
 * between subject and scene, because the model IS the subject there.
 */
import { getCategory, getCategoryScene, CATEGORY_NEGATIVE, AI_DISCLOSURE, type CategoryId } from './categories'
import { SCHOOLS, type SchoolId } from './personas'
import { FIDELITY, type FidelityId } from './presets'

export interface BuildInput {
  category: CategoryId
  /** Scene id within that category. */
  scene: string
  /** What the customer described — product, look, dish, vehicle or space. */
  subject: string
  fidelity?: FidelityId
  /** Only used by person-led categories; ignored elsewhere. */
  school?: SchoolId
}

export interface Built {
  prompt: string
  negative: string
  strength: number
  /** True when the render will contain a synthetic person and needs labelling. */
  needsDisclosure: boolean
  disclosure: string
}

export function buildCampaignPrompt(input: BuildInput): Built {
  const category = getCategory(input.category) ?? getCategory('product')!
  const scene = getCategoryScene(category.id, input.scene) ?? category.scenes[0]!
  const fidelity = FIDELITY.find((f) => f.id === (input.fidelity ?? 'balanced')) ?? FIDELITY[1]!
  const subject = input.subject.trim() || category.subjectPlaceholder

  // Person-led categories carry a beauty school; object categories never do.
  const school = category.personLed
    ? (SCHOOLS.find((s) => s.id === input.school) ?? SCHOOLS[0]!)
    : null

  const parts = [
    category.lead,
    subject + ',',
    school ? school.look + ',' : '',
    scene.scene + ',',
    school ? school.light + ',' : '',
    category.craft,
  ].filter(Boolean)

  return {
    prompt: parts.join(' '),
    negative: CATEGORY_NEGATIVE,
    // Clamped so even the boldest fidelity cannot drift the subject beyond recognition.
    strength: Math.min(0.85, Math.max(0.2, scene.strength * fidelity.factor)),
    needsDisclosure: category.personLed,
    disclosure: AI_DISCLOSURE,
  }
}
