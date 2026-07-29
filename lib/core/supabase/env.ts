// Strips UTF-8 BOM (0xFEFF) and non-ASCII chars that Windows/PowerShell can inject.
// This is not paranoia: a BOM stored in a Vercel env var once crashed the live
// platform, because the value was rejected as an HTTP header.
export const cleanKey = (v: string | undefined): string =>
  (v ?? '').replace(/[﻿￾]/g, '').replace(/[^\x20-\x7E]/g, '').trim()

export const SUPABASE_URL         = cleanKey(process.env.NEXT_PUBLIC_SUPABASE_URL)
export const SUPABASE_ANON_KEY    = cleanKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
export const SUPABASE_SERVICE_KEY = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY)

/**
 * No hardcoded fallbacks, deliberately.
 *
 * The file this was copied from carried literal fallback values pointing at a
 * DIFFERENT Supabase project. Inherited unchanged, a missing or BOM-mangled env
 * var here would have silently connected the factory to the old platform's
 * database and written customer rows into it. Failing loudly at boot is the only
 * safe behaviour — a misconfigured deploy must not look healthy.
 */
export function assertSupabaseEnv(): void {
  const missing: string[] = []
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (missing.length > 0) {
    throw new Error(`Missing Supabase env: ${missing.join(', ')}`)
  }
}
