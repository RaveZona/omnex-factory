/**
 * OMNEX safeFetch — production-grade typed fetch wrapper (DUG #8)
 *
 * Features:
 *   - Typed responses with discriminated union (ok: true/false)
 *   - 401 → refresh Supabase session → retry once
 *   - 429 → exponential backoff (max 3 retries)
 *   - Network errors → retry 3× with jitter
 *   - Request timeout (10s default, configurable)
 *   - No stale auth — always reads current session before retrying
 */
import { createClient } from '@/lib/core/supabase/client'

export type SafeResult<T> =
  | { ok: true;  data: T;      status: number }
  | { ok: false; error: string; status: number }

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?:  number
  maxRetries?: number
  auth?:       boolean
}

async function refreshSession(): Promise<string | null> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data: { session: fresh } } = await supabase.auth.refreshSession()
  return fresh?.access_token ?? null
}

function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms))
}

export async function safeFetch<T = unknown>(
  url:     string,
  options: SafeFetchOptions = {},
): Promise<SafeResult<T>> {
  const {
    timeoutMs  = 10_000,
    maxRetries = 3,
    auth       = true,
    ...fetchOpts
  } = options

  const headers = new Headers(fetchOpts.headers)
  if (!headers.has('Content-Type') && fetchOpts.body) {
    headers.set('Content-Type', 'application/json')
  }

  let lastError = ''
  let sessionRefreshed = false

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timer)

      // 401 — try refreshing the session once
      if (res.status === 401 && auth && !sessionRefreshed) {
        sessionRefreshed = true
        const token = await refreshSession()
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
          attempt--  // don't count the 401 as a retry
          continue
        }
        return { ok: false, error: 'Authentication required', status: 401 }
      }

      // 429 — exponential backoff
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10) * 1000
        await sleep(retryAfter || 2 ** attempt * 500 + Math.random() * 200)
        continue
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try {
          const body = await res.json()
          errMsg = body.error ?? body.message ?? errMsg
        } catch {}
        return { ok: false, error: errMsg, status: res.status }
      }

      const data: T = await res.json()
      return { ok: true, data, status: res.status }

    } catch (err) {
      clearTimeout(timer)
      const isAbort   = err instanceof DOMException && err.name === 'AbortError'
      const isNetwork = err instanceof TypeError && err.message.includes('fetch')
      lastError = isAbort ? `Request timed out after ${timeoutMs}ms` : String(err)

      if ((isAbort || isNetwork) && attempt < maxRetries) {
        await sleep(2 ** attempt * 300 + Math.random() * 150)
        continue
      }
      return { ok: false, error: lastError, status: 0 }
    }
  }

  return { ok: false, error: lastError || 'Max retries exceeded', status: 0 }
}

export async function safeGet<T>(url: string, opts?: SafeFetchOptions) {
  return safeFetch<T>(url, { method: 'GET', ...opts })
}

export async function safePost<T>(url: string, body: unknown, opts?: SafeFetchOptions) {
  return safeFetch<T>(url, {
    method: 'POST',
    body:   JSON.stringify(body),
    ...opts,
  })
}

export async function safePatch<T>(url: string, body: unknown, opts?: SafeFetchOptions) {
  return safeFetch<T>(url, {
    method: 'PATCH',
    body:   JSON.stringify(body),
    ...opts,
  })
}
