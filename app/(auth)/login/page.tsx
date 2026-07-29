'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/core/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setBusy(false); return }
    router.push('/studio')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-neutral-400">Your credits work across every OMNEX module.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com" autoComplete="email"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-neutral-600" />
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" autoComplete="current-password"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-neutral-600" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-sm text-neutral-500">
        No account? <Link href="/signup" className="text-neutral-300 underline">Create one</Link> — 20 free credits.
      </p>
    </main>
  )
}
