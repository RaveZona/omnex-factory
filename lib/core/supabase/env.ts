// Strips UTF-8 BOM (0xFEFF) and non-ASCII chars that Windows/PowerShell can inject.
export const cleanKey = (v: string | undefined): string =>
  (v ?? '').replace(/[﻿￾]/g, '').replace(/[^\x20-\x7E]/g, '').trim()

const _url  = cleanKey(process.env.NEXT_PUBLIC_SUPABASE_URL)
const _anon = cleanKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// These are public values (NEXT_PUBLIC_) — safe fallbacks ensure auth works even if
// the Vercel env var was stored with a BOM and cleanKey reduced it to empty string.
export const SUPABASE_URL      = _url  || 'https://zwkzqeecagvmogfqsxja.supabase.co'
export const SUPABASE_ANON_KEY = _anon || 'sb_publishable_hAPk1YoTuQ9jzPlfiIwa6Q_vROIJQQs'
export const SUPABASE_SERVICE_KEY = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY)
