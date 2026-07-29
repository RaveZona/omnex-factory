import { liveModules, upcomingModules } from '@/lib/modules/registry'

export default function Home() {
  const live = liveModules()
  const next = upcomingModules()

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">OMNEX Factory</h1>
      <p className="mt-4 text-lg text-neutral-400">
        One login, one credit balance, many AI business modules.
      </p>

      <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-neutral-500">Available now</h2>
      <ul className="mt-4 space-y-3">
        {live.map((m) => (
          <li key={m.id} className="rounded-lg border border-neutral-800 p-4">
            <div className="font-medium">{m.name}</div>
            <div className="mt-1 text-sm text-neutral-400">{m.blurb}</div>
            <div className="mt-2 text-xs text-neutral-500">{m.creditCost} credits per generation</div>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-neutral-500">Not built yet</h2>
      <ul className="mt-4 space-y-1 text-sm text-neutral-500">
        {next.map((m) => (
          <li key={m.id}>{m.order}. {m.name} — {m.blurb}</li>
        ))}
      </ul>
    </main>
  )
}
