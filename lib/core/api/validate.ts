/**
 * BATCH A3 — Sovereign API Validation Helper
 * Single reusable parseBody() — eliminates 30+ inline manual type-guard blocks.
 * Used by every API route: const parsed = await parseBody(request, Schema)
 */
import { type ZodSchema } from 'zod'
import { NextResponse } from 'next/server'

type ParseSuccess<T> = { data: T; error?: never }
type ParseFailure    = { data?: never; error: NextResponse }
type ParseResult<T>  = ParseSuccess<T> | ParseFailure

export async function parseBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<ParseResult<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Request body must be valid JSON', code: 'INVALID_JSON' },
        { status: 400 },
      ),
    }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    const field = first?.path.join('.') ?? 'body'
    const message = first?.message ?? 'Validation failed'
    return {
      error: NextResponse.json(
        { ok: false, error: `${field}: ${message}`, code: 'VALIDATION_ERROR', details: result.error.flatten() },
        { status: 400 },
      ),
    }
  }

  return { data: result.data }
}

export function parseQuery<T>(
  searchParams: URLSearchParams,
  schema: ZodSchema<T>,
): ParseResult<T> {
  const raw = Object.fromEntries(searchParams.entries())
  const result = schema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    return {
      error: NextResponse.json(
        { ok: false, error: first?.message ?? 'Invalid query params', code: 'VALIDATION_ERROR' },
        { status: 400 },
      ),
    }
  }
  return { data: result.data }
}

// Narrow the result in a type-safe way
export function isParseError<T>(r: ParseResult<T>): r is ParseFailure {
  return 'error' in r && r.error !== undefined
}
