import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * OMNEX owner-access auth.
 *
 * The owner key is the single credential that unlocks owner/admin actions
 * (autonomous revenue, publishing, sovereign controls). It is read from the
 * `OMNEX_OWNER_KEY` env var — never hard-coded, never committed. Set it in
 * Vercel → Project → Settings → Environment Variables.
 *
 * Present it on a request either way:
 *   Authorization: Bearer <key>
 *   x-omnex-owner-key: <key>
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the presented owner key from a request, if any. */
export function presentedOwnerKey(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const direct = request.headers.get("x-omnex-owner-key");
  return direct ? direct.trim() : null;
}

/**
 * True iff the request carries the correct owner key. Returns false (never
 * throws) when the env var is unset, so routes fail closed in misconfiguration.
 */
export function isOwner(request: NextRequest): boolean {
  const expected = process.env.OMNEX_OWNER_KEY;
  if (!expected || expected.length < 16) return false; // refuse weak/unset keys
  const presented = presentedOwnerKey(request);
  if (!presented) return false;
  return safeEqual(presented, expected);
}
