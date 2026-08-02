'use client'

import { useState } from 'react'

type State = 'idle' | 'sending' | 'sent' | 'error'

const FIELD =
  'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm ' +
  'outline-none transition placeholder:text-neutral-600 focus:border-neutral-600'

export function BriefForm() {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState('sending')
    setMessage('')
    const data = Object.fromEntries(new FormData(e.currentTarget))

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        // Show the server's reason rather than a generic failure — the two real
        // cases are a malformed email and an empty brief, and both are fixable
        // by the visitor if we say which.
        setState('error')
        setMessage(json.error ?? 'Something went wrong.')
        return
      }
      setState('sent')
    } catch {
      setState('error')
      setMessage('Network error. Please try again, or email us directly.')
    }
  }

  if (state === 'sent') {
    return (
      <div className="mt-6 rounded-xl border border-neutral-800 p-6">
        <div className="font-medium">Brief received.</div>
        <p className="mt-2 text-sm text-neutral-400">
          You will get a reply with scope and price. If we are not the right fit for
          this campaign, we will say so plainly rather than waste your time.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-3 sm:grid-cols-2">
      <input name="name" placeholder="Your name" className={FIELD} autoComplete="name" />
      <input
        name="email"
        type="email"
        required
        placeholder="Email *"
        className={FIELD}
        autoComplete="email"
      />
      <input name="company" placeholder="Brand or company" className={FIELD} autoComplete="organization" />
      <input name="brand_site" placeholder="Website or Instagram" className={FIELD} />

      <select name="budget" className={FIELD} defaultValue="">
        <option value="" disabled>Budget</option>
        <option>under €500</option>
        <option>€500–2,000</option>
        <option>€2,000–10,000</option>
        <option>€10,000+</option>
        <option>not sure yet</option>
      </select>
      <select name="timeline" className={FIELD} defaultValue="">
        <option value="" disabled>Timeline</option>
        <option>this week</option>
        <option>this month</option>
        <option>next quarter</option>
        <option>exploring</option>
      </select>

      <textarea
        name="brief"
        required
        rows={5}
        placeholder="What are you launching, and where does it need to run? *"
        className={`${FIELD} sm:col-span-2`}
      />

      {/* Honeypot: hidden from people, irresistible to bots. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Send brief'}
        </button>
        {state === 'error' && <span className="text-sm text-red-400">{message}</span>}
      </div>
    </form>
  )
}
