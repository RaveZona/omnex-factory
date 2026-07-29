/**
 * Embeddings via Hugging Face Inference API (free-tier friendly).
 *
 * Turns text into vectors for semantic RAG search. Uses a small, fast
 * sentence-transformers model by default (384 dims). Set HF_TOKEN in the
 * environment; optionally override HF_EMBED_MODEL / HF_EMBED_DIM.
 *
 * Kept separate from the chat provider chain (lib/llm/provider.ts) — embeddings
 * are a different task with a different endpoint and a fixed output dimension
 * that must match the pgvector column (migration 015).
 */
import { cleanKey } from '@/lib/core/supabase/env'

export const EMBED_MODEL = cleanKey(process.env.HF_EMBED_MODEL) || 'sentence-transformers/all-MiniLM-L6-v2'
export const EMBED_DIM = Number(cleanKey(process.env.HF_EMBED_DIM)) || 384

export function hasEmbedProvider(): boolean {
  return !!cleanKey(process.env.HF_TOKEN)
}

/**
 * Embed a batch of texts. Returns one vector (number[]) per input, each of
 * length EMBED_DIM. Throws if HF_TOKEN is not configured or the API errors.
 * HF cold-starts a model on first call; `wait_for_model` avoids a 503 then.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const token = cleanKey(process.env.HF_TOKEN)
  if (!token) throw new Error('no_embed_provider: set HF_TOKEN')
  if (texts.length === 0) return []

  // HF migrated Inference off api-inference.huggingface.co (now dead) to the
  // router. Feature-extraction pipeline endpoint returns one vector per input.
  const url = `https://router.huggingface.co/hf-inference/models/${EMBED_MODEL}/pipeline/feature-extraction`
  const call = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ inputs: texts }),
  })
  let res = await call()
  // Cold start: a not-yet-loaded model returns 503. Wait briefly and retry once.
  if (res.status === 503) {
    await new Promise(r => setTimeout(r, 3000))
    res = await call()
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`hf_embed ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as number[][] | number[]
  // feature-extraction returns number[][] for a batch. Guard the single-input shape.
  const vectors = Array.isArray(data[0]) ? (data as number[][]) : [data as number[]]
  if (vectors.length !== texts.length) {
    throw new Error(`hf_embed: expected ${texts.length} vectors, got ${vectors.length}`)
  }
  for (const v of vectors) {
    if (v.length !== EMBED_DIM) {
      throw new Error(`hf_embed: model dim ${v.length} != HF_EMBED_DIM ${EMBED_DIM} — set HF_EMBED_DIM and migration 015 to match`)
    }
  }
  return vectors
}

/** Embed a single query string → one vector. */
export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text])
  if (!v) throw new Error('hf_embed: no vector returned')
  return v
}
