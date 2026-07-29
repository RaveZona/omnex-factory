/**
 * POST /api/stripe/webhook — the only place credits are granted for money.
 *
 * Two properties matter more than anything else here:
 *
 * 1. IDEMPOTENCY. Stripe retries deliveries, and a double-processed renewal
 *    would hand out free credits forever. Every event id is inserted into
 *    `webhook_events` first; a primary-key conflict means "already handled" and
 *    the handler returns 200 without granting anything.
 *
 * 2. SIGNATURE VERIFICATION on the RAW body. Parsing before verifying would let
 *    anyone mint credits by POSTing JSON.
 *
 * Credits are granted on `checkout.session.completed` (first payment) and on
 * `invoice.paid` (every renewal) — the latter is what makes this MRR rather
 * than a one-off sale.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/core/supabase/admin'
import { cleanKey } from '@/lib/core/supabase/env'
import { grantCredits } from '@/lib/core/billing/credits'
import { planByPriceId, getPlan } from '@/lib/core/billing/plans'

export const dynamic = 'force-dynamic'

/** Resolve our user id from whatever the event carries. */
async function resolveUserId(admin: ReturnType<typeof createAdminClient>, opts: {
  clientReferenceId?: string | null
  metadataUserId?: string | null
  customerId?: string | null
}): Promise<string | null> {
  if (opts.clientReferenceId) return opts.clientReferenceId
  if (opts.metadataUserId) return opts.metadataUserId
  if (opts.customerId) {
    const { data } = await admin.from('profiles').select('id').eq('stripe_customer_id', opts.customerId).maybeSingle()
    return (data?.id as string | undefined) ?? null
  }
  return null
}

export async function POST(req: NextRequest) {
  const key = cleanKey(process.env.STRIPE_SECRET_KEY)
  const secret = cleanKey(process.env.STRIPE_WEBHOOK_SECRET)
  if (!key || !secret) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 })

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const raw = await req.text()
  const stripe = new Stripe(key, { maxNetworkRetries: 2 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch (e) {
    return NextResponse.json({ error: `Signature verification failed: ${e instanceof Error ? e.message : ''}` }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency gate — insert first, act only if this id was new.
  const { error: dupe } = await admin.from('webhook_events').insert({ id: event.id, type: event.type })
  if (dupe) {
    if (dupe.code === '23505') return NextResponse.json({ received: true, duplicate: true })
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        const planId = (s.metadata?.plan as string | undefined) ?? ''
        const plan = getPlan(planId)
        const userId = await resolveUserId(admin, {
          clientReferenceId: s.client_reference_id,
          metadataUserId: s.metadata?.user_id ?? null,
          customerId: typeof s.customer === 'string' ? s.customer : null,
        })
        if (userId && plan) {
          await grantCredits(userId, plan.monthlyCredits, 'purchase', s.id)
          if (typeof s.customer === 'string') {
            await admin.from('profiles').update({ stripe_customer_id: s.customer }).eq('id', userId)
          }
        }
        break
      }

      case 'invoice.paid': {
        // Every renewal refills the balance — this is the recurring half of MRR.
        const inv = event.data.object as Stripe.Invoice
        const line = inv.lines?.data?.[0]
        const priceId = (line as unknown as { price?: { id?: string } } | undefined)?.price?.id ?? ''
        const plan = planByPriceId(priceId)
        const userId = await resolveUserId(admin, {
          metadataUserId: (inv.metadata?.user_id as string | undefined) ?? null,
          customerId: typeof inv.customer === 'string' ? inv.customer : null,
        })
        // The first invoice arrives alongside checkout.session.completed; the
        // event-id gate makes them distinct events, so guard against granting
        // twice by only topping up when this invoice is a renewal.
        const isRenewal = inv.billing_reason === 'subscription_cycle'
        if (userId && plan && isRenewal) {
          await grantCredits(userId, plan.monthlyCredits, 'purchase', inv.id)
        }
        break
      }

      default:
        break
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    // Returning 500 asks Stripe to retry; the idempotency row already exists, so
    // record the failure rather than silently swallowing money-affecting errors.
    await admin.from('webhook_events').update({ type: `${event.type}:failed` }).eq('id', event.id)
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'handler failed' }, { status: 500 })
  }
}
