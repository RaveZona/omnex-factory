/**
 * Plans — the revenue model.
 *
 * MRR requires recurring subscriptions, not one-off packs, so the primary
 * product is a monthly plan that REFILLS a credit balance. Credits are the
 * single currency across every module, which is what makes each new module
 * raise the value of the existing subscription instead of splitting it.
 *
 * Price ids come from env because they differ per Stripe environment and rotate;
 * never hardcode them. A plan with no configured price id is simply not offered,
 * so a half-configured deploy hides the button rather than showing a broken one.
 */
import { cleanKey } from '@/lib/core/supabase/env'

export type PlanId = 'starter' | 'studio' | 'agency'

export interface Plan {
  id: PlanId
  name: string
  /** EUR per month, for display only — Stripe is the source of truth on price. */
  priceEur: number
  /** Credits granted on subscription and on every renewal. */
  monthlyCredits: number
  blurb: string
  features: string[]
  /** Env var holding the Stripe price id. */
  priceEnv: string
  highlight?: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceEur: 29,
    monthlyCredits: 300,
    blurb: 'For one brand shipping regular content.',
    features: ['300 credits monthly (~30 images)', 'All 11 campaign categories', 'All formats and scenes', 'Commercial usage rights'],
    priceEnv: 'STRIPE_PRICE_STARTER',
  },
  {
    id: 'studio',
    name: 'Studio',
    priceEur: 99,
    monthlyCredits: 1200,
    blurb: 'For agencies running several brands.',
    features: ['1,200 credits monthly (~120 images)', 'Everything in Starter', 'Virtual brand ambassadors', 'Priority generation queue'],
    priceEnv: 'STRIPE_PRICE_STUDIO',
    highlight: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    priceEur: 299,
    monthlyCredits: 4000,
    blurb: 'For teams with continuous campaign output.',
    features: ['4,000 credits monthly (~400 images)', 'Everything in Studio', 'Highest-quality engine routing', 'Priority support'],
    priceEnv: 'STRIPE_PRICE_AGENCY',
  },
]

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id)
}

/** Stripe price id for a plan, empty when not configured in this environment. */
export function priceIdFor(plan: Plan): string {
  return cleanKey(process.env[plan.priceEnv])
}

/** Only plans that can actually be purchased right now. */
export function purchasablePlans(): Plan[] {
  return PLANS.filter((p) => priceIdFor(p).length > 0)
}

/** Reverse lookup used by the webhook to know how many credits a renewal grants. */
export function planByPriceId(priceId: string): Plan | undefined {
  return PLANS.find((p) => priceIdFor(p) === priceId)
}
