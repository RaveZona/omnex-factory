/**
 * Credits — the factory's single currency.
 *
 * One balance per user, spendable in every module. That shared balance is the
 * mechanism behind "each new module increases the value of the previous ones":
 * credits bought for the Ad Studio also unlock Landing Pages later.
 *
 * spendCredits() delegates to the `consume_credits` SQL function (migration
 * 001), which takes a FOR UPDATE row lock — so two concurrent requests can
 * never spend the same credits twice. Charge BEFORE doing paid work, and
 * refund() if the provider call fails, so a customer is never billed for
 * nothing.
 */
import { createAdminClient } from '@/lib/core/supabase/admin'

export interface SpendResult {
  ok: boolean
  /** Present when ok === false: why the spend failed. */
  reason?: 'insufficient_credits' | 'error'
  error?: string
}

/** Atomically charge `amount` credits to a user for a module. */
export async function spendCredits(userId: string, amount: number, moduleId: string): Promise<SpendResult> {
  if (amount <= 0) return { ok: true }
  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('consume_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_module: moduleId,
    })
    if (error) return { ok: false, reason: 'error', error: error.message }
    return data === true ? { ok: true } : { ok: false, reason: 'insufficient_credits' }
  } catch (e) {
    return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/** Give credits back when paid work failed after the charge. Best-effort. */
export async function refundCredits(userId: string, amount: number, ref?: string): Promise<void> {
  if (amount <= 0) return
  try {
    const db = createAdminClient()
    await db.rpc('grant_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_reason: 'refund',
      p_ref: ref ?? null,
    })
  } catch {
    // never let a refund failure surface as a request error — it is logged by usage_events
  }
}

/** Grant purchased credits (called from the Stripe webhook after idempotency check). */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: 'purchase' | 'signup_bonus' | 'refund' = 'purchase',
  stripeRef?: string,
): Promise<number | null> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('grant_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_ref: stripeRef ?? null,
    })
    return error ? null : (data as number)
  } catch {
    return null
  }
}

/** Current balance; null when unknown (never throws in a render path). */
export async function creditBalance(userId: string): Promise<number | null> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('credit_balance')
      .select('credits')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    return data.credits as number
  } catch {
    return null
  }
}

/** Record what a module did, for per-product analytics and revenue attribution. */
export async function recordUsage(params: {
  userId: string | null
  moduleId: string
  action: string
  credits: number
  ok: boolean
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const db = createAdminClient()
    await db.from('usage_events').insert({
      user_id: params.userId,
      module_id: params.moduleId,
      action: params.action,
      credits: params.credits,
      ok: params.ok,
      meta: params.meta ?? {},
    })
  } catch {
    // analytics must never break a customer request
  }
}
