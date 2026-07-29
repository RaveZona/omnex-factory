/**
 * ComfyUI client — local image generation on your own GPU.
 *
 * Why this file exists rather than reusing the A1111 branch in provider.ts:
 * ComfyUI has no `/sdapi/v1/txt2img`. It takes a workflow GRAPH — a map of node
 * ids to node definitions — queues it, and returns images asynchronously. The
 * graph is built here so callers keep the same simple interface.
 *
 * What this unlocks, concretely: the "Fidelity" control in Ad Studio currently
 * does nothing, because the free provider ignores `strength` (verified — the
 * same request returned a byte-identical image at 0.35 and 0.55). ComfyUI has a
 * real denoise parameter and a real negative prompt, so both become genuine
 * features instead of dead controls. Generation is also unmetered: no credits,
 * no monthly cap, no depleted balance.
 *
 * Trade-off stated plainly: this runs on localhost, so it serves local work —
 * sample galleries, portfolio, testing. A deployed app cannot reach it.
 */
import { cleanKey } from '@/lib/core/supabase/env'

export interface ComfyOptions {
  prompt: string
  negative?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
  /** Denoise: 1.0 = ignore the input image, lower = stay closer to it. */
  denoise?: number
  /** Filename of an image already uploaded to ComfyUI's input folder. */
  initImage?: string
  /** Checkpoint filename as ComfyUI lists it. */
  model?: string
}

export function comfyUrl(): string {
  return cleanKey(process.env.COMFYUI_URL).replace(/\/$/, '')
}

export function hasComfy(): boolean {
  return comfyUrl().length > 0
}

/** True when the server answers — used to fail loudly instead of hanging. */
export async function comfyReachable(timeoutMs = 5000): Promise<boolean> {
  const base = comfyUrl()
  if (!base) return false
  try {
    const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** Checkpoints the server actually has — never guess a model name. */
export async function comfyCheckpoints(): Promise<string[]> {
  const base = comfyUrl()
  if (!base) return []
  try {
    const res = await fetch(`${base}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []
    const data = await res.json() as Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>
    const list = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

/** Upload a product photo so an image-to-image graph can reference it by name. */
export async function comfyUpload(bytes: Buffer, filename: string): Promise<string | null> {
  const base = comfyUrl()
  if (!base) return null
  try {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(bytes)]), filename)
    form.append('overwrite', 'true')
    const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    const data = await res.json() as { name?: string }
    return data.name ?? null
  } catch {
    return null
  }
}

/**
 * Build the workflow graph. Two shapes share most nodes: text-to-image starts
 * from an empty latent, image-to-image encodes the uploaded photo instead and
 * applies `denoise` — which is the parameter the free provider ignores.
 */
function buildGraph(o: ComfyOptions, checkpoint: string): Record<string, unknown> {
  const width = o.width ?? 1024
  const height = o.height ?? 1024
  const seed = o.seed ?? Math.floor(Math.random() * 1_000_000_000)
  const denoise = o.initImage ? (o.denoise ?? 0.55) : 1.0

  const graph: Record<string, unknown> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: o.negative ?? '', clip: ['1', 1] } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: o.steps ?? 28,
        cfg: o.cfg ?? 6.5,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'omnex', images: ['6', 0] } },
  }

  if (o.initImage) {
    graph['8'] = { class_type: 'LoadImage', inputs: { image: o.initImage } }
    graph['4'] = { class_type: 'VAEEncode', inputs: { pixels: ['8', 0], vae: ['1', 2] } }
  } else {
    graph['4'] = { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } }
  }

  return graph
}

export interface ComfyResult { images: string[]; elapsedMs: number; seed: number }

/**
 * Queue a generation and wait for it. Returns absolute URLs served by ComfyUI.
 * Throws with a specific reason rather than returning empty, so a caller can
 * fall through to another provider knowing why this one failed.
 */
export async function comfyGenerate(o: ComfyOptions, timeoutMs = 300_000): Promise<ComfyResult> {
  const base = comfyUrl()
  if (!base) throw new Error('COMFYUI_URL not set')

  const checkpoints = await comfyCheckpoints()
  const checkpoint = o.model ?? checkpoints[0]
  if (!checkpoint) throw new Error('ComfyUI has no checkpoint installed')

  const started = Date.now()
  const graph = buildGraph(o, checkpoint)
  const seed = (graph['5'] as { inputs: { seed: number } }).inputs.seed

  const clientId = `omnex-${Date.now()}`
  const queued = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!queued.ok) {
    throw new Error(`ComfyUI rejected the graph: ${(await queued.text()).slice(0, 300)}`)
  }
  const { prompt_id: promptId } = await queued.json() as { prompt_id?: string }
  if (!promptId) throw new Error('ComfyUI returned no prompt_id')

  // Poll history: ComfyUI is asynchronous and offers no blocking mode.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const hist = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(15_000) })
    if (!hist.ok) continue
    const data = await hist.json() as Record<string, {
      outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
      status?: { status_str?: string }
    }>
    const entry = data[promptId]
    if (!entry) continue

    if (entry.status?.status_str === 'error') throw new Error('ComfyUI reported an execution error')

    const images: string[] = []
    for (const out of Object.values(entry.outputs ?? {})) {
      for (const img of out.images ?? []) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
        images.push(`${base}/view?${q}`)
      }
    }
    if (images.length > 0) return { images, elapsedMs: Date.now() - started, seed }
  }
  throw new Error('ComfyUI timed out')
}
