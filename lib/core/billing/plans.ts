/**
 * Credit packs — one-time purchases, not subscriptions.
 *
 * A subscription asks a stranger to commit monthly, before they have any proof
 * the tool works for their product. That is the slowest possible path to a first
 * payment. A pack asks for one decision, once, at a price someone can approve
 * without thinking — and the credits never expire, so there is nothing to cancel
 * and nothing to regret.
 *
 * Credits remain the single currency across every module, so a pack bought for
 * the Ad Studio still works in whatever ships next. That is what makes each new
 * module raise the value of a purchase already made.
 *
 * Price ids come from env because they differ per Stripe environment and rotate.
 * A pack with no configured price id is not offered at all, so a half-configured
 * deploy hides the button instead of showing a broken one.
 */
import { cleanKey } from '@/lib/core/supabase/env'

export type PackId = 'taster' | 'brand' | 'studio' | 'agency'

export interface CreditPack {
  id: PackId
  name: string
  /** EUR, one-time. Display only — Stripe is the source of truth. */
  priceEur: number
  credits: number
  blurb: string
  features: string[]
  priceEnv: string
  highlight?: boolean
}

/** 10 credits per image, so images = credits / 10. */
export const CREDITS_PER_IMAGE = 10

export const PACKS: CreditPack[] = [
  {
    id: 'taster',
    name: 'Taster',
    priceEur: 9,
    credits: 100,
    blurb: 'Enough to shoot one product properly.',
    features: ['100 credits — 10 images', 'All 11 campaign categories', 'Commercial usage rights', 'Credits never expire'],
    priceEnv: 'STRIPE_PRICE_TASTER',
  },
  {
    id: 'brand',
    name: 'Brand',
    priceEur: 29,
    credits: 400,
    blurb: 'A full campaign across every format.',
    features: ['400 credits — 40 images', 'Every scene and format', 'Virtual brand ambassadors', 'Credits never expire'],
    priceEnv: 'STRIPE_PRICE_BRAND',
    highlight: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    priceEur: 79,
    credits: 1200,
    blurb: 'Several brands, or a season of content.',
    features: ['1,200 credits — 120 images', 'Everything in Brand', 'Priority generation', 'Credits never expire'],
    priceEnv: 'STRIPE_PRICE_STUDIO',
  },
  {
    id: 'agency',
    name: 'Agency',
    priceEur: 199,
    credits: 3500,
    blurb: 'Client work at volume.',
    features: ['3,500 credits — 350 images', 'Everything in Studio', 'Highest-quality engine routing', 'Credits never expire'],
    priceEnv: 'STRIPE_PRICE_AGENCY',
  },
]

export function getPack(id: string): CreditPack | undefined {
  return PACKS.find((p) => p.id === id)
}

/** Stripe price id for a pack, empty when not configured in this environment. */
export function priceIdFor(pack: CreditPack): string {
  return cleanKey(process.env[pack.priceEnv])
}

/** Only packs that can actually be purchased right now. */
export function purchasablePacks(): CreditPack[] {
  return PACKS.filter((p) => priceIdFor(p).length > 0)
}

/** Reverse lookup used by the webhook to know how many credits a payment grants. */
export function packByPriceId(priceId: string): CreditPack | undefined {
  return PACKS.find((p) => priceIdFor(p) === priceId)
}

/** Effective price per image, for honest comparison on the pricing page. */
export function perImageEur(pack: CreditPack): number {
  return pack.priceEur / (pack.credits / CREDITS_PER_IMAGE)
}
