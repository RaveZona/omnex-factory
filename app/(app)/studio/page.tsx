'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/core/supabase/client'
import { FORMATS, FIDELITY, type FormatId, type FidelityId } from '@/lib/modules/studio/presets'
import { CATEGORIES, type CategoryId } from '@/lib/modules/studio/categories'
import { SCHOOLS, type SchoolId } from '@/lib/modules/studio/personas'

interface RenderedImage { url: string; stored: boolean }

interface GenerateResponse {
  images?: RenderedImage[]
  balance?: number | null
  creditsSpent?: number
  provider?: string
  elapsedMs?: number
  disclosure?: string
  capabilities?: { fidelityControl: boolean; free: boolean; primary: string | null }
  error?: string
  needed?: number
}

const CREDITS_PER_IMAGE = 10

export default function StudioPage() {
  const router = useRouter()

  const [checking, setChecking] = useState(true)
  const [balance, setBalance] = useState<number | null>(null)

  const [categoryId, setCategoryId] = useState<CategoryId>('product')
  const [sceneId, setSceneId] = useState<string>(CATEGORIES[0]!.scenes[0]!.id)
  const [school, setSchool] = useState<SchoolId>('high_fashion')
  const [subject, setSubject] = useState('')
  const [format, setFormat] = useState<FormatId>('portrait')
  const [fidelity, setFidelity] = useState<FidelityId>('balanced')
  const [count, setCount] = useState(1)

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<RenderedImage[]>([])
  const [meta, setMeta] = useState<{ provider: string | undefined; elapsedMs: number | undefined; disclosure: string | undefined } | null>(null)
  // Hidden when the engine that actually served the render ignores it — a
  // control that changes nothing must not be shown.
  const [showFidelity, setShowFidelity] = useState(true)

  const category = useMemo(() => CATEGORIES.find((c) => c.id === categoryId)!, [categoryId])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.push('/login'); return }
      const { data: row } = await supabase.from('credit_balance').select('credits').eq('user_id', data.user.id).maybeSingle()
      setBalance((row?.credits as number | undefined) ?? 0)
      setChecking(false)
    })
  }, [router])

  // Scenes are per-category, so switching category must reset the scene or the
  // request would carry a scene id that does not exist in the new catalogue.
  function pickCategory(id: CategoryId) {
    setCategoryId(id)
    setSceneId(CATEGORIES.find((c) => c.id === id)!.scenes[0]!.id)
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/studio/upload', { method: 'POST', body: form })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok || !json.url) { setError(json.error ?? 'Upload failed.'); return }
      setPhotoUrl(json.url)
    } finally {
      setUploading(false)
    }
  }

  async function onGenerate() {
    setBusy(true); setError(null); setImages([])
    try {
      const res = await fetch('/api/studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject, category: categoryId, scene: sceneId, format, fidelity, count,
          ...(category.personLed ? { school } : {}),
          ...(photoUrl ? { imageUrl: photoUrl } : {}),
        }),
      })
      const json = await res.json() as GenerateResponse
      if (!res.ok) {
        setError(res.status === 402
          ? `Not enough credits — this needs ${json.needed ?? CREDITS_PER_IMAGE * count}, you have ${json.balance ?? 0}.`
          : json.error ?? 'Generation failed.')
        if (typeof json.balance === 'number') setBalance(json.balance)
        return
      }
      setImages(json.images ?? [])
      setMeta({ provider: json.provider, elapsedMs: json.elapsedMs, disclosure: json.disclosure })
      if (typeof json.balance === 'number') setBalance(json.balance)
      if (json.capabilities) setShowFidelity(json.capabilities.fidelityControl)
    } catch {
      setError('Network error — nothing was charged.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return <main className="p-10 text-sm text-neutral-500">Loading…</main>

  const cost = CREDITS_PER_IMAGE * count
  const canGenerate = subject.trim().length >= 3 && !busy && !uploading
  const outOfCredits = (balance ?? 0) < cost

  const btn = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition-colors ${active ? 'border-neutral-400 bg-neutral-900' : 'border-neutral-800 hover:border-neutral-700'}`

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">AI Ad Studio</h1>
          <p className="mt-1 text-sm text-neutral-400">Campaign-grade visuals for {CATEGORIES.length} industries.</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-neutral-500">Credits</div>
            <div className="text-lg font-medium">{balance ?? '—'}</div>
          </div>
          <Link href="/pricing" className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">
            Get more
          </Link>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Campaign type</label>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => pickCategory(c.id)} className={btn(categoryId === c.id)} title={c.blurb}>
                  {c.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-600">{category.blurb}</p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">{category.subjectLabel}</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={category.subjectPlaceholder}
              className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-neutral-600" />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Reference photo (optional)</label>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onUpload}
              className="mt-2 w-full text-xs text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:text-neutral-200" />
            <p className="mt-1.5 text-xs text-neutral-600">
              {uploading ? 'Uploading…' : photoUrl ? 'Uploaded — your real subject will be used.' : 'Without a photo the scene is built from your description.'}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Scene</label>
            <div className="mt-2 space-y-1.5">
              {category.scenes.map((s) => (
                <button key={s.id} onClick={() => setSceneId(s.id)} className={`w-full ${btn(sceneId === s.id)}`}>
                  <div className="font-medium">{s.name}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">{s.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          {category.personLed && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Model look</label>
              <div className="mt-2 space-y-1.5">
                {SCHOOLS.map((s) => (
                  <button key={s.id} onClick={() => setSchool(s.id)} className={`w-full ${btn(school === s.id)}`}>
                    <div className="font-medium">{s.name}</div>
                    <div className="mt-0.5 text-xs text-neutral-500">{s.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Format</label>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {FORMATS.map((f) => (
                <button key={f.id} onClick={() => setFormat(f.id)} className={btn(format === f.id)} title={f.usedFor}>
                  <div>{f.name}</div>
                  <div className="mt-0.5 text-[11px] text-neutral-500">{f.aspect}</div>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-600">{FORMATS.find((f) => f.id === format)?.usedFor}</p>
          </div>

          {showFidelity && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Fidelity</label>
              <div className="mt-2 space-y-1.5">
                {FIDELITY.map((f) => (
                  <button key={f.id} onClick={() => setFidelity(f.id)} className={`w-full ${btn(fidelity === f.id)}`}>
                    <div className="font-medium">{f.name}</div>
                    <div className="mt-0.5 text-xs text-neutral-500">{f.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-500">Images</label>
            <div className="mt-2 flex gap-1.5">
              {[1, 2, 4].map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`flex-1 text-center ${btn(count === n)}`}>{n}</button>
              ))}
            </div>
          </div>

          <button onClick={onGenerate} disabled={!canGenerate}
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-40">
            {busy ? 'Generating…' : `Generate — ${cost} credits`}
          </button>
          {outOfCredits && !busy && (
            <p className="text-xs text-amber-400">
              You have {balance ?? 0} credits. <Link href="/pricing" className="underline">Top up</Link> to run this.
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div>
          {images.length === 0 && !busy && (
            <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-neutral-800 text-sm text-neutral-600">
              Your campaign renders appear here.
            </div>
          )}
          {busy && (
            <div className="flex h-72 items-center justify-center rounded-xl border border-neutral-800 text-sm text-neutral-500">
              Shooting your {category.name.toLowerCase()} campaign…
            </div>
          )}
          {images.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {images.map((img, i) => (
                  <figure key={i} className="overflow-hidden rounded-xl border border-neutral-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Render ${i + 1}`} className="w-full" />
                    <figcaption className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-neutral-500">{img.stored ? 'Saved to your library' : 'Temporary link'}</span>
                      <a href={img.url} download target="_blank" rel="noreferrer" className="text-neutral-300 underline">Download</a>
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="mt-3 text-xs text-neutral-600">
                {meta?.provider} · {((meta?.elapsedMs ?? 0) / 1000).toFixed(1)}s
                {meta?.disclosure ? ` · ${meta.disclosure}` : ' · AI-generated image'}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
