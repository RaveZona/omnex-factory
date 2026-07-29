/**
 * OMNEX Tool Registry
 *
 * Master registry for all sovereign tool integrations. Tools are registered
 * by ID and can be looked up, filtered by category, and executed through a
 * unified interface with input validation.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface ToolInputSpec {
  type:        'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required:    boolean
  default?:    unknown
}

export interface ToolResult {
  success: boolean
  data?:   unknown
  error?:  string
  meta?: {
    duration_ms: number
    tool_id:     string
  }
}

export interface OmnexTool {
  id:          string
  name:        string
  description: string
  category:    string
  inputs:      Record<string, ToolInputSpec>
  execute(inputs: Record<string, unknown>): Promise<ToolResult>
}

// ---------------------------------------------------------------------------
// Registry map
// ---------------------------------------------------------------------------

export const OMNEX_TOOL_REGISTRY: Map<string, OmnexTool> = new Map()

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

/** Register a tool. Overwrites any existing registration with the same ID. */
export function registerTool(tool: OmnexTool): void {
  OMNEX_TOOL_REGISTRY.set(tool.id, tool)
}

/** Retrieve a single tool by ID. Returns undefined when not found. */
export function getTool(id: string): OmnexTool | undefined {
  return OMNEX_TOOL_REGISTRY.get(id)
}

/**
 * List all registered tools, optionally filtered to a specific category.
 * Results are sorted alphabetically by ID.
 */
export function listTools(category?: string): OmnexTool[] {
  const all = Array.from(OMNEX_TOOL_REGISTRY.values())
  const filtered = category ? all.filter((t) => t.category === category) : all
  return filtered.sort((a, b) => a.id.localeCompare(b.id))
}

/** Validate inputs against a tool's input spec. Returns errors on failure. */
export function validateInputs(
  tool: OmnexTool,
  inputs: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const [key, spec] of Object.entries(tool.inputs)) {
    const value = inputs[key]

    // Required check
    if (spec.required && (value === undefined || value === null)) {
      errors.push(`Missing required input: "${key}"`)
      continue
    }

    // Type check when a value is present
    if (value !== undefined && value !== null) {
      const actual = Array.isArray(value) ? 'array' : typeof value
      if (actual !== spec.type) {
        errors.push(
          `Input "${key}" expected type "${spec.type}" but received "${actual}"`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Execute a tool by ID. Applies default values for unset optional inputs,
 * validates inputs, and wraps execution with timing metadata.
 *
 * Returns a ToolResult with success: false when the tool is not found or
 * input validation fails — never throws.
 */
export async function executeTool(
  id: string,
  inputs: Record<string, unknown>
): Promise<ToolResult> {
  const start = Date.now()

  const tool = getTool(id)
  if (!tool) {
    return {
      success: false,
      error: `Tool "${id}" not found in registry`,
      meta: { duration_ms: 0, tool_id: id },
    }
  }

  // Apply defaults for unset optional inputs
  const resolved: Record<string, unknown> = { ...inputs }
  for (const [key, spec] of Object.entries(tool.inputs)) {
    if ((resolved[key] === undefined || resolved[key] === null) && spec.default !== undefined) {
      resolved[key] = spec.default
    }
  }

  const { valid, errors } = validateInputs(tool, resolved)
  if (!valid) {
    return {
      success: false,
      error: `Validation failed: ${errors.join('; ')}`,
      meta: { duration_ms: Date.now() - start, tool_id: id },
    }
  }

  try {
    const result = await tool.execute(resolved)
    return {
      ...result,
      meta: { duration_ms: Date.now() - start, tool_id: id },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      meta: { duration_ms: Date.now() - start, tool_id: id },
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy tool module loading
//
// Each category module exports a `tools` array of OmnexTool. Modules are
// loaded with dynamic import so missing files do not crash the registry
// initialization — they are simply skipped.
// ---------------------------------------------------------------------------

const TOOL_MODULE_PATHS = [
  '@/lib/core/tools/communication',
  '@/lib/core/tools/data',
  '@/lib/core/tools/dev',
  '@/lib/core/tools/ai',
  '@/lib/core/tools/web',
  '@/lib/core/tools/storage',
  '@/lib/core/tools/crm',
  '@/lib/core/tools/hunter',
  '@/lib/core/tools/social',
  '@/lib/core/tools/generation',
  '@/lib/core/tools/payments',
] as const

/**
 * Load all tool modules and register their tools. Called once at startup.
 * Failures in individual modules are swallowed; the registry will contain
 * whatever loaded successfully.
 */
export async function loadAllTools(): Promise<void> {
  await Promise.all(
    TOOL_MODULE_PATHS.map(async (path) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import(path) as { tools?: OmnexTool[] }
        if (Array.isArray(mod.tools)) {
          for (const tool of mod.tools) {
            registerTool(tool)
          }
        }
      } catch {
        // Module does not exist yet — skip silently
      }
    })
  )
}
