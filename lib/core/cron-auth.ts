/**
 * Central cron authentication. CRON_SECRET must be set in the environment —
 * there is deliberately NO hardcoded fallback: the old 'omnex-cron-2026'
 * default lives in git history, so any route still accepting it is effectively
 * unauthenticated. No secret configured → every cron request is rejected.
 */

/** The configured cron secret, or null when unset/empty (never a default). */
export function cronSecret(): string | null {
  const s = process.env.CRON_SECRET?.trim()
  return s ? s : null
}

/** True only when CRON_SECRET is configured and the request carries it. */
export function isCronAuthorized(request: Request): boolean {
  const secret = cronSecret()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

/** Query-param variant for routes triggered as `?cron=<secret>`. */
export function isCronKeyValid(key: string | null | undefined): boolean {
  const secret = cronSecret()
  return !!secret && key === secret
}
