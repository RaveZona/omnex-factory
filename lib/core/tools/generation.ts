/**
 * OMNEX Generation Tools
 *
 * Integrations: OpenAI DALL-E 3, Stability AI, Replicate, Fal.ai
 */

import type { OmnexTool } from '@/lib/core/tools/registry'

// ---------------------------------------------------------------------------
// openai_image
// ---------------------------------------------------------------------------

const openai_image: OmnexTool = {
  id: 'openai_image',
  name: 'OpenAI Image (DALL-E 3)',
  description: 'Generate images from text prompts using OpenAI DALL-E 3',
  category: 'generation',
  inputs: {
    prompt: {
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    },
    size: {
      type: 'string',
      description: 'Image size: "1024x1024", "1792x1024", or "1024x1792" (default: "1024x1024")',
      required: false,
      default: '1024x1024',
    },
    quality: {
      type: 'string',
      description: 'Image quality: "standard" or "hd" (default: "standard")',
      required: false,
      default: 'standard',
    },
    style: {
      type: 'string',
      description: 'Image style: "vivid" or "natural" (default: "vivid")',
      required: false,
      default: 'vivid',
    },
    n: {
      type: 'number',
      description: 'Number of images to generate (default: 1, max: 1 for DALL-E 3)',
      required: false,
      default: 1,
    },
    apiKey: {
      type: 'string',
      description: 'OpenAI API key (falls back to OPENAI_API_KEY env)',
      required: false,
    },
  },
  async execute(inputs) {
    const apiKey = (inputs.apiKey as string | undefined) ?? process.env.OPENAI_API_KEY
    if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not set' }

    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: inputs.prompt,
          n: (inputs.n as number | undefined) ?? 1,
          size: (inputs.size as string | undefined) ?? '1024x1024',
          quality: (inputs.quality as string | undefined) ?? 'standard',
          style: (inputs.style as string | undefined) ?? 'vivid',
          response_format: 'url',
        }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        const err = (data as { error?: { message?: string } }).error
        return { success: false, error: err?.message ?? `HTTP ${res.status}` }
      }
      const images = (data.data as Array<{ url: string; revised_prompt?: string }>)
      return {
        success: true,
        data: {
          images: images.map((img) => ({ url: img.url, revised_prompt: img.revised_prompt })),
          created: data.created,
        },
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

// ---------------------------------------------------------------------------
// stability_image
// ---------------------------------------------------------------------------

const stability_image: OmnexTool = {
  id: 'stability_image',
  name: 'Stability AI Image',
  description: 'Generate images using Stability AI (Stable Diffusion 3.5) via the REST API',
  category: 'generation',
  inputs: {
    prompt: {
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    },
    negative_prompt: {
      type: 'string',
      description: 'Elements to exclude from the image',
      required: false,
    },
    model: {
      type: 'string',
      description: 'Model to use: "sd3.5-large", "sd3.5-large-turbo", "sd3.5-medium" (default: sd3.5-large)',
      required: false,
      default: 'sd3.5-large',
    },
    aspect_ratio: {
      type: 'string',
      description: 'Aspect ratio: "1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21" (default: 1:1)',
      required: false,
      default: '1:1',
    },
    output_format: {
      type: 'string',
      description: 'Output format: "webp", "jpeg", or "png" (default: "webp")',
      required: false,
      default: 'webp',
    },
    apiKey: {
      type: 'string',
      description: 'Stability AI API key (falls back to STABILITY_API_KEY env)',
      required: false,
    },
  },
  async execute(inputs) {
    const apiKey = (inputs.apiKey as string | undefined) ?? process.env.STABILITY_API_KEY
    if (!apiKey) return { success: false, error: 'STABILITY_API_KEY not set' }

    const model = (inputs.model as string | undefined) ?? 'sd3.5-large'
    const outputFormat = (inputs.output_format as string | undefined) ?? 'webp'

    const formData = new FormData()
    formData.append('prompt', inputs.prompt as string)
    formData.append('model', model)
    formData.append('aspect_ratio', (inputs.aspect_ratio as string | undefined) ?? '1:1')
    formData.append('output_format', outputFormat)
    if (inputs.negative_prompt) formData.append('negative_prompt', inputs.negative_prompt as string)

    try {
      const res = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/sd3`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        body: formData,
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        const err = (data as { errors?: string[] }).errors
        return { success: false, error: err?.join('; ') ?? `HTTP ${res.status}` }
      }
      return {
        success: true,
        data: {
          image_base64: data.image,
          finish_reason: data.finish_reason,
          seed: data.seed,
          content_type: `image/${outputFormat}`,
        },
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

// ---------------------------------------------------------------------------
// replicate_run
// ---------------------------------------------------------------------------

const replicate_run: OmnexTool = {
  id: 'replicate_run',
  name: 'Replicate Run',
  description: 'Run any model on Replicate and return the output (polling until complete)',
  category: 'generation',
  inputs: {
    model: {
      type: 'string',
      description: 'Model version string (owner/name:version or owner/name for latest)',
      required: true,
    },
    input: {
      type: 'object',
      description: 'Model-specific input parameters as a JSON object',
      required: true,
    },
    wait_timeout: {
      type: 'number',
      description: 'Maximum seconds to wait for prediction (default: 120)',
      required: false,
      default: 120,
    },
    apiKey: {
      type: 'string',
      description: 'Replicate API token (falls back to REPLICATE_API_TOKEN env)',
      required: false,
    },
  },
  async execute(inputs) {
    const apiKey = (inputs.apiKey as string | undefined) ?? process.env.REPLICATE_API_TOKEN
    if (!apiKey) return { success: false, error: 'REPLICATE_API_TOKEN not set' }

    const model = inputs.model as string
    const [ownerName, version] = model.includes(':')
      ? [model.split(':')[0], model.split(':')[1]]
      : [model, undefined]

    const body: Record<string, unknown> = { input: inputs.input }
    if (version) body.version = version

    const createUrl = version
      ? 'https://api.replicate.com/v1/predictions'
      : `https://api.replicate.com/v1/models/${ownerName}/predictions`

    try {
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify(body),
      })
      const prediction = await createRes.json() as Record<string, unknown>
      if (!createRes.ok) {
        const err = (prediction as { detail?: string }).detail
        return { success: false, error: err ?? `HTTP ${createRes.status}` }
      }

      // If the prediction is already complete (Prefer: wait resolved it), return directly
      if (prediction.status === 'succeeded') {
        return { success: true, data: { output: prediction.output, id: prediction.id } }
      }

      // Poll for completion
      const maxWait = ((inputs.wait_timeout as number | undefined) ?? 120) * 1000
      const pollStart = Date.now()
      const pollUrl = prediction.urls
        ? (prediction.urls as Record<string, string>).get
        : `https://api.replicate.com/v1/predictions/${prediction.id as string}`

      while (Date.now() - pollStart < maxWait) {
        await new Promise((r) => setTimeout(r, 2000))
        const pollRes = await fetch(pollUrl as string, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        const poll = await pollRes.json() as Record<string, unknown>
        if (poll.status === 'succeeded') {
          return { success: true, data: { output: poll.output, id: poll.id } }
        }
        if (poll.status === 'failed' || poll.status === 'canceled') {
          return { success: false, error: (poll.error as string | undefined) ?? `Prediction ${poll.status as string}` }
        }
      }

      return { success: false, error: `Prediction timed out after ${(inputs.wait_timeout as number | undefined) ?? 120}s` }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

// ---------------------------------------------------------------------------
// fal_image
// ---------------------------------------------------------------------------

const fal_image: OmnexTool = {
  id: 'fal_image',
  name: 'Fal.ai Image',
  description: 'Generate images using Fal.ai fast inference (FLUX, Stable Diffusion, and more)',
  category: 'generation',
  inputs: {
    model: {
      type: 'string',
      description: 'Fal model endpoint (e.g. "fal-ai/flux/schnell", "fal-ai/stable-diffusion-v3-medium")',
      required: false,
      default: 'fal-ai/flux/schnell',
    },
    prompt: {
      type: 'string',
      description: 'Text description of the image to generate',
      required: true,
    },
    image_size: {
      type: 'string',
      description: 'Image size preset: "square", "portrait_4_3", "landscape_4_3", "square_hd", "portrait_16_9", "landscape_16_9" (default: square)',
      required: false,
      default: 'square',
    },
    num_images: {
      type: 'number',
      description: 'Number of images to generate (default: 1)',
      required: false,
      default: 1,
    },
    num_inference_steps: {
      type: 'number',
      description: 'Number of inference steps (default: 4 for schnell, 28 for dev)',
      required: false,
    },
    seed: {
      type: 'number',
      description: 'Random seed for reproducible results',
      required: false,
    },
    apiKey: {
      type: 'string',
      description: 'Fal AI API key (falls back to FAL_KEY env)',
      required: false,
    },
  },
  async execute(inputs) {
    const apiKey = (inputs.apiKey as string | undefined) ?? process.env.FAL_KEY
    if (!apiKey) return { success: false, error: 'FAL_KEY not set' }

    const model = (inputs.model as string | undefined) ?? 'fal-ai/flux/schnell'

    const body: Record<string, unknown> = {
      prompt: inputs.prompt,
      image_size: (inputs.image_size as string | undefined) ?? 'square',
      num_images: (inputs.num_images as number | undefined) ?? 1,
    }
    if (inputs.num_inference_steps !== undefined) body.num_inference_steps = inputs.num_inference_steps
    if (inputs.seed !== undefined) body.seed = inputs.seed

    try {
      // Submit request
      const submitRes = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const submitData = await submitRes.json() as Record<string, unknown>
      if (!submitRes.ok) {
        const err = (submitData as { detail?: string }).detail
        return { success: false, error: err ?? `HTTP ${submitRes.status}` }
      }

      const requestId = submitData.request_id as string | undefined
      if (!requestId) return { success: false, error: 'Fal did not return a request_id' }

      // Poll for result
      const maxWait = 120_000
      const pollStart = Date.now()
      while (Date.now() - pollStart < maxWait) {
        await new Promise((r) => setTimeout(r, 2000))
        const resultRes = await fetch(`https://queue.fal.run/${model}/requests/${requestId}`, {
          headers: { Authorization: `Key ${apiKey}` },
        })
        const result = await resultRes.json() as Record<string, unknown>
        if (result.status === 'COMPLETED') {
          const images = result.images as Array<{ url: string; width: number; height: number }> | undefined
          return {
            success: true,
            data: {
              images: images ?? [],
              seed: result.seed,
              request_id: requestId,
            },
          }
        }
        if (result.status === 'FAILED') {
          const err = (result as { error?: string }).error
          return { success: false, error: err ?? 'Fal generation failed' }
        }
      }

      return { success: false, error: 'Fal generation timed out after 120s' }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

export const GENERATION_TOOLS: OmnexTool[] = [
  openai_image,
  stability_image,
  replicate_run,
  fal_image,
]

export const tools: OmnexTool[] = GENERATION_TOOLS
