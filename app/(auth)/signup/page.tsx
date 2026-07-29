'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/core/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { data, error } = await createClient().auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { setError(error.message); setBusy(false); return }
    // When email confirmation is off, Supabase returns a session immediately.
    if (data.session) { router.push('/studio'); router.refresh(); return }
    setSent(true); setBusy(false)
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">Check your inbox</h1>
        <p className="mt-3 text-sm text-neutral-400">
          We sent a confirmation link to <span className="text-neutral-200">{email}</span>.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-2 text-sm text-neutral-400">20 free credits — enough for two full generations.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com" autoComplete="email"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-neutral-600" />
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 characters)" autoComplete="new-password"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-neutral-600" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-50">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-sm text-neutral-500">
        Already have one? <Link href="/login" className="text-neutral-300 underline">Sign in</Link>
      </p>
    </main>
  )
}
