'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PLANS } from '@/lib/core/billing/plans'
import { CATEGORIES } from '@/lib/modules/studio/categories'

export default function PricingPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function subscribe(planId: string) {
    setBusy(planId); setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const json = await res.json() as { url?: string; error?: string }
      if (res.status === 401) { window.location.href = '/signup'; return }
      if (!res.ok || !json.url) { setError(json.error ?? 'Could not start checkout.'); return }
      window.location.href = json.url
    } catch {
      setError('Network error.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Campaign visuals, on a subscription</h1>
        <p className="mx-auto mt-3 max-w-xl text-neutral-400">
          One credit balance across every OMNEX module. Credits refill each month, and every
          new module we ship works with the same balance.
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id}
            className={`flex flex-col rounded-2xl border p-6 ${p.highlight ? 'border-neutral-500 bg-neutral-900/40' : 'border-neutral-800'}`}>
            {p.highlight && <div className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-400">Most popular</div>}
            <h2 className="text-lg font-medium">{p.name}</h2>
            <p className="mt-1 text-sm text-neutral-500">{p.blurb}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">€{p.priceEur}</span>
              <span className="text-sm text-neutral-500">/month</span>
            </div>
            <ul className="mt-5 flex-1 space-y-2 text-sm text-neutral-300">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-neutral-600">—</span>{f}
                </li>
              ))}
            </ul>
            <button onClick={() => subscribe(p.id)} disabled={busy !== null}
              className={`mt-6 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${p.highlight ? 'bg-white text-black' : 'border border-neutral-700 hover:border-neutral-500'}`}>
              {busy === p.id ? 'Opening checkout…' : `Choose ${p.name}`}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="mt-6 text-center text-sm text-red-400">{error}</p>}

      <div className="mt-14 rounded-2xl border border-neutral-800 p-6">
        <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Included in every plan</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <span key={c.id} className="rounded-full border border-neutral-800 px-3 py-1 text-sm text-neutral-300">{c.name}</span>
          ))}
        </div>
      </div>

      <p className="mt-10 text-center text-sm text-neutral-500">
        Not ready? <Link href="/signup" className="text-neutral-300 underline">Create a free account</Link> — 20 credits, no card.
      </p>
    </main>
  )
}
