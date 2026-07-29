/**
 * Image generation provider chain — the engine behind AI Ad Studio.
 *
 * Mirrors the proven `lib/core/llm/provider.ts` pattern: try providers in order,
 * fall through on failure, never hard-fail while any provider is reachable.
 *
 *   Pollinations  — keyless, free, FLUX. No image input (text-to-image only).
 *   Fal.ai        — FLUX schnell/dev, fastest paid path, supports image input.
 *   Replicate     — any model; used for product-placement / inpainting models.
 *   OpenAI        — DALL-E 3, text-to-image only.
 *   Local (Comfy) — a local ComfyUI/A1111 endpoint: €0, unlimited, img2img.
 *
 * Default order is QUALITY-first (paid providers when configured) because this
 * generates customer deliverables; Pollinations sits last as the free safety net
 * so the product still works at €0. Pass `preferFree` for internal/sample work.
 *
 * Two capability tiers matter for the product:
 *   textToImage  — invents a scene. Good for backgrounds and sample galleries.
 *   imageToImage — places the CUSTOMER'S OWN product in a scene. This is the
 *                  actual value of Ad Studio, and only some providers support it.
 */
import { cleanKey } from '@/lib/core/supabase/env'

export interface GenerateOptions {
  prompt: string
  /** Public URL or data URI of the customer's product photo (enables image-to-image). */
  imageUrl?: string
  aspect?: '1:1' | '4:5' | '16:9' | '9:16'
  count?: number
  seed?: number
  /** Prefer keyless/free providers — for internal sample generation, not customer work. */
  preferFree?: boolean
}

export interface GeneratedImage { url: string; width?: number; height?: number }

export interface GenerateResult {
  images: GeneratedImage[]
  provider: string
  model: string
  elapsedMs: number
}

type Capability = 'textToImage' | 'imageToImage'

interface ImageProvider {
  name: string
  model: string
  free: boolean
  supports: Capability[]
  configured: () => boolean
  run: (opts: GenerateOptions) => Promise<GeneratedImage[]>
}

const SIZES: Record<NonNullable<GenerateOptions['aspect']>, { w: number; h: number }> = {
  '1:1':  { w: 1024, h: 1024 },
  '4:5':  { w: 1024, h: 1280 },
  '16:9': { w: 1344, h: 768 },
  '9:16': { w: 768,  h: 1344 },
}

const env = (k: string) => cleanKey(process.env[k]).replace(/^["'`]+|["'`]+$/g, '').trim()

// ── Pollinations — keyless, free, text-to-image only ───────────────────────
const pollinations: ImageProvider = {
  name: 'pollinations',
  model: 'flux',
  free: true,
  supports: ['textToImage'],
  configured: () => true, // needs no key — always available as the safety net
  async run(opts) {
    const { w, h } = SIZES[opts.aspect ?? '1:1']
    const n = Math.min(opts.count ?? 1, 4)
    // One request per image; distinct seeds so a batch isn't four identical frames.
    const urls = Array.from({ length: n }, (_, i) => {
      const seed = (opts.seed ?? Math.floor(Math.random() * 1e6)) + i
      const q = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true', model: 'flux', seed: String(seed) })
      return `https://image.pollinations.ai/prompt/${encodeURIComponent(opts.prompt)}?${q}`
    })
    // Verify each URL actually returns an image before handing it to a customer.
    const checked = await Promise.all(urls.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`pollinations ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.startsWith('image/')) throw new Error(`pollinations returned ${ct}`)
      return { url, width: w, height: h }
    }))
    return checked
  },
}

// ── Fal.ai — FLUX, fast, supports image input ──────────────────────────────
const fal: ImageProvider = {
  name: 'fal',
  model: env('FAL_MODEL') || 'fal-ai/flux/schnell',
  free: false,
  supports: ['textToImage', 'imageToImage'],
  configured: () => !!env('FAL_KEY'),
  async run(opts) {
    const key = env('FAL_KEY')
    const { w, h } = SIZES[opts.aspect ?? '1:1']
    const model = opts.imageUrl ? (env('FAL_IMG2IMG_MODEL') || 'fal-ai/flux/dev/image-to-image') : (env('FAL_MODEL') || 'fal-ai/flux/schnell')
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      image_size: { width: w, height: h },
      num_images: Math.min(opts.count ?? 1, 4),
    }
    if (opts.imageUrl) body.image_url = opts.imageUrl
    if (opts.seed !== undefined) body.seed = opts.seed

    const submit = await fetch(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 200)}`)
    const { request_id: requestId } = await submit.json() as { request_id?: string }
    if (!requestId) throw new Error('fal: no request_id')

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const res = await fetch(`https://queue.fal.run/${model}/requests/${requestId}`, {
        headers: { Authorization: `Key ${key}` },
      })
      const j = await res.json() as { status?: string; images?: GeneratedImage[]; error?: string }
      if (j.images?.length) return j.images
      if (j.status === 'FAILED') throw new Error(`fal failed: ${j.error ?? 'unknown'}`)
    }
    throw new Error('fal: timed out')
  },
}

// ── Replicate — any model, including product placement / inpainting ────────
const replicate: ImageProvider = {
  name: 'replicate',
  model: env('REPLICATE_MODEL') || 'black-forest-labs/flux-schnell',
  free: false,
  supports: ['textToImage', 'imageToImage'],
  configured: () => !!env('REPLICATE_API_TOKEN'),
  async run(opts) {
    const key = env('REPLICATE_API_TOKEN')
    const model = env('REPLICATE_MODEL') || 'black-forest-labs/flux-schnell'
    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      num_outputs: Math.min(opts.count ?? 1, 4),
      aspect_ratio: opts.aspect ?? '1:1',
    }
    if (opts.imageUrl) input.image = opts.imageUrl
    if (opts.seed !== undefined) input.seed = opts.seed

    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(120_000),
    })
    const p = await res.json() as { status?: string; output?: unknown; detail?: string; urls?: { get?: string } }
    if (!res.ok) throw new Error(`replicate ${res.status}: ${p.detail ?? ''}`)

    const collect = (out: unknown): GeneratedImage[] =>
      Array.isArray(out) ? out.filter((u): u is string => typeof u === 'string').map((url) => ({ url }))
      : typeof out === 'string' ? [{ url: out }] : []

    if (p.status === 'succeeded') return collect(p.output)

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && p.urls?.get) {
      await new Promise((r) => setTimeout(r, 2000))
      const poll = await fetch(p.urls.get, { headers: { Authorization: `Bearer ${key}` } })
      const j = await poll.json() as { status?: string; output?: unknown; error?: string }
      if (j.status === 'succeeded') return collect(j.output)
      if (j.status === 'failed' || j.status === 'canceled') throw new Error(`replicate ${j.status}: ${j.error ?? ''}`)
    }
    throw new Error('replicate: timed out')
  },
}

// ── OpenAI DALL-E 3 — text-to-image only ───────────────────────────────────
const openai: ImageProvider = {
  name: 'openai',
  model: 'dall-e-3',
  free: false,
  supports: ['textToImage'],
  configured: () => !!env('OPENAI_API_KEY'),
  async run(opts) {
    const size = opts.aspect === '16:9' ? '1792x1024' : opts.aspect === '9:16' ? '1024x1792' : '1024x1024'
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt: opts.prompt, n: 1, size, quality: 'hd' }),
      signal: AbortSignal.timeout(120_000),
    })
    const j = await res.json() as { data?: Array<{ url: string }>; error?: { message?: string } }
    if (!res.ok) throw new Error(`openai: ${j.error?.message ?? res.status}`)
    return (j.data ?? []).map((d) => ({ url: d.url }))
  },
}

// ── Local ComfyUI / A1111 — €0, unlimited, real img2img on your own GPU ────
const local: ImageProvider = {
  name: 'local',
  model: env('LOCAL_IMAGE_MODEL') || 'sdxl',
  free: true,
  supports: ['textToImage', 'imageToImage'],
  configured: () => !!env('LOCAL_IMAGE_URL'),
  async run(opts) {
    // Expects an OpenAI-images-compatible shim (A1111 `--api`, ComfyUI adapters).
    const base = env('LOCAL_IMAGE_URL').replace(/\/$/, '')
    const { w, h } = SIZES[opts.aspect ?? '1:1']
    const res = await fetch(`${base}/sdapi/v1/${opts.imageUrl ? 'img2img' : 'txt2img'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt,
        width: w,
        height: h,
        steps: 25,
        batch_size: Math.min(opts.count ?? 1, 4),
        ...(opts.imageUrl ? { init_images: [opts.imageUrl], denoising_strength: 0.6 } : {}),
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`local ${res.status}`)
    const j = await res.json() as { images?: string[] }
    return (j.images ?? []).map((b64) => ({ url: `data:image/png;base64,${b64}`, width: w, height: h }))
  },
}

const ALL: ImageProvider[] = [fal, replicate, local, openai, pollinations]

/** Providers that are configured, in the order they should be tried. */
function chain(opts: GenerateOptions): ImageProvider[] {
  const needed: Capability = opts.imageUrl ? 'imageToImage' : 'textToImage'
  const usable = ALL.filter((p) => p.configured() && p.supports.includes(needed))
  // Explicit override wins: IMAGE_PROVIDER_ORDER="local,fal,pollinations"
  const override = env('IMAGE_PROVIDER_ORDER').split(',').map((s) => s.trim()).filter(Boolean)
  if (override.length > 0) {
    return [...usable].sort((a, b) => {
      const ia = override.indexOf(a.name), ib = override.indexOf(b.name)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }
  // Free-first for internal work; quality-first (paid, then free net) for customers.
  return opts.preferFree
    ? [...usable].sort((a, b) => Number(b.free) - Number(a.free))
    : usable
}

/** True when at least one provider can serve this request. */
export function hasImageProvider(imageToImage = false): boolean {
  const needed: Capability = imageToImage ? 'imageToImage' : 'textToImage'
  return ALL.some((p) => p.configured() && p.supports.includes(needed))
}

/** Names of providers that would be tried, in order (diagnostics + UI). */
export function imageProviderNames(opts: GenerateOptions = { prompt: '' }): string[] {
  return chain(opts).map((p) => p.name)
}

/**
 * Generate images, falling through the provider chain on failure.
 * Throws only when every configured provider failed.
 */
export async function generateImages(opts: GenerateOptions): Promise<GenerateResult> {
  const providers = chain(opts)
  if (providers.length === 0) {
    throw new Error(opts.imageUrl ? 'no_image_to_image_provider' : 'no_image_provider')
  }
  const started = Date.now()
  let lastErr: unknown = null
  for (const p of providers) {
    try {
      const images = await p.run(opts)
      if (images.length > 0) {
        return { images, provider: p.name, model: p.model, elapsedMs: Date.now() - started }
      }
      lastErr = new Error(`${p.name}: returned no images`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all_image_providers_failed')
}
