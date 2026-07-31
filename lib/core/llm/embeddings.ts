/**
 * Embeddings — local-first, with Hugging Face as fallback.
 *
 * Turns text into vectors for semantic search. The output dimension is fixed at
 * 384 because it must match the pgvector column; changing the model without
 * changing that column silently corrupts every comparison.
 *
 * Order is deliberate: **Ollama first, Hugging Face second.**
 * HF's free tier has a monthly credit cap that this project has already hit
 * (402 "depleted your monthly included credits") — at which point every semantic
 * feature silently degrades. A local model has no cap, no rate limit, no network
 * dependency, and costs nothing per call. `all-minilm` is the same underlying
 * model that produced the existing vectors, so old and new embeddings remain
 * comparable rather than living in different spaces.
 */
import { cleanKey } from '@/lib/core/supabase/env'

export const EMBED_DIM = Number(cleanKey(process.env.EMBED_DIM)) || 384

/** Hugging Face model id — the hosted fallback. */
export const HF_EMBED_MODEL = cleanKey(process.env.HF_EMBED_MODEL) || 'sentence-transformers/all-MiniLM-L6-v2'
/** Ollama model tag — the local primary. Must produce EMBED_DIM dimensions. */
export const OLLAMA_EMBED_MODEL = cleanKey(process.env.OLLAMA_EMBED_MODEL) || 'all-minilm'

function ollamaBase(): string {
  // Reuses OLLAMA_URL from the chat provider, which points at the /v1 shim;
  // the embeddings endpoint lives at the root, so strip it.
  const raw = cleanKey(process.env.OLLAMA_EMBED_URL) || cleanKey(process.env.OLLAMA_URL)
  return raw.replace(/\/v1\/?$/, '').replace(/\/$/, '')
}

export function hasOllamaEmbed(): boolean { return ollamaBase().length > 0 }
export function hasHfEmbed(): boolean { return !!cleanKey(process.env.HF_TOKEN) }

export function hasEmbedProvider(): boolean {
  return hasOllamaEmbed() || hasHfEmbed()
}

/** Which provider a call would use right now — for diagnostics and honest UI. */
export function embedProviderName(): 'ollama' | 'huggingface' | null {
  if (hasOllamaEmbed()) return 'ollama'
  if (hasHfEmbed()) return 'huggingface'
  return null
}

function assertDims(vectors: number[][], who: string, expected: number): void {
  for (const v of vectors) {
    if (v.length !== EMBED_DIM) {
      throw new Error(`${who}: model dim ${v.length} != EMBED_DIM ${EMBED_DIM} — vectors would be incomparable with stored ones`)
    }
  }
  if (vectors.length !== expected) {
    throw new Error(`${who}: expected ${expected} vectors, got ${vectors.length}`)
  }
}

/** Local Ollama. One request per text — its embeddings endpoint is single-input. */
async function embedOllama(texts: string[]): Promise<number[][]> {
  const base = ollamaBase()
  const out: number[][] = []
  for (const text of texts) {
    const res = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`ollama_embed ${res.status}: ${(await res.text()).slice(0, 160)}`)
    const data = await res.json() as { embedding?: number[] }
    if (!Array.isArray(data.embedding)) throw new Error('ollama_embed: no embedding in response')
    out.push(data.embedding)
  }
  assertDims(out, 'ollama_embed', texts.length)
  return out
}

/** Hosted Hugging Face — batched, but metered. */
async function embedHf(texts: string[]): Promise<number[][]> {
  const token = cleanKey(process.env.HF_TOKEN)
  // HF migrated Inference off api-inference.huggingface.co (now dead) to the router.
  const url = `https://router.huggingface.co/hf-inference/models/${HF_EMBED_MODEL}/pipeline/feature-extraction`
  const call = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ inputs: texts }),
    signal: AbortSignal.timeout(90_000),
  })
  let res = await call()
  // Cold start: a not-yet-loaded model returns 503. Wait briefly and retry once.
  if (res.status === 503) {
    await new Promise((r) => setTimeout(r, 3000))
    res = await call()
  }
  if (!res.ok) throw new Error(`hf_embed ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const data = (await res.json()) as number[][] | number[]
  const vectors = Array.isArray(data[0]) ? (data as number[][]) : [data as number[]]
  assertDims(vectors, 'hf_embed', texts.length)
  return vectors
}

/**
 * Embed a batch of texts, local-first with fallback.
 * Throws only when every configured provider failed.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  if (!hasEmbedProvider()) throw new Error('no_embed_provider: set OLLAMA_URL or HF_TOKEN')

  let lastErr: unknown = null
  if (hasOllamaEmbed()) {
    try { return await embedOllama(texts) } catch (e) { lastErr = e }
  }
  if (hasHfEmbed()) {
    try { return await embedHf(texts) } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all_embed_providers_failed')
}

/** Embed a single query string → one vector. */
export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text])
  if (!v) throw new Error('embed: no vector returned')
  return v
}
