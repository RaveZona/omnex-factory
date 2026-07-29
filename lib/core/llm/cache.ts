/**
 * Semantic LLM response cache (migration 016). Opt-in via LlmOptions.cache.
 *
 * getCached(prompt): exact-hash lookup first (free, instant), then — if HF_TOKEN
 * is set — a semantic near-match over pgvector (reuses lib/llm/embeddings).
 * setCached(...): hash + embed + upsert. Everything is graceful: any failure
 * (no HF, no DB, error) means a normal cache miss / silent skip — never throws,
 * never blocks the LLM call.
 *
 * Best used for deterministic prompts (temperature 0). A cached answer is a prior
 * answer to a near-identical prompt — acceptable staleness for real cost savings.
 */
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/core/supabase/admin'
import { embedOne, hasEmbedProvider } from '@/lib/core/llm/embeddings'

const SIM_THRESHOLD = Number(process.env.LLM_CACHE_THRESHOLD) || 0.97

export interface CachedHit { response: string; model: string | null; source: 'exact' | 'semantic' }

const hashOf = (prompt: string) => createHash('sha256').update(prompt).digest('hex')

export async function getCached(prompt: string): Promise<CachedHit | null> {
  try {
    const db = createAdminClient()
    // 1. Exact-hash fast path (no embedding cost).
    const exact = await db.from('llm_cache')
      .select('response, model')
      .eq('prompt_hash', hashOf(prompt))
      .maybeSingle()
    if (exact.data?.response) {
      void db.from('llm_cache').update({ hit_count: 1, last_hit_at: new Date().toISOString() }).eq('prompt_hash', hashOf(prompt))
      return { response: exact.data.response, model: exact.data.model ?? null, source: 'exact' }
    }
    // 2. Semantic near-match (needs embeddings).
    if (!hasEmbedProvider()) return null
    const vec = await embedOne(prompt)
    const { data } = await db.rpc('match_llm_cache', { p_query: vec, p_threshold: SIM_THRESHOLD })
    const hit = Array.isArray(data) ? data[0] : null
    if (hit?.response) return { response: hit.response, model: hit.model ?? null, source: 'semantic' }
    return null
  } catch {
    return null
  }
}

export async function setCached(prompt: string, response: string, model: string): Promise<void> {
  try {
    if (!response) return
    const db = createAdminClient()
    const embedding = hasEmbedProvider() ? await embedOne(prompt).catch(() => null) : null
    await db.from('llm_cache').upsert(
      { prompt_hash: hashOf(prompt), prompt_embedding: embedding, response, model },
      { onConflict: 'prompt_hash' }
    )
  } catch {
    // best-effort — a cache write failure must never affect the caller
  }
}
