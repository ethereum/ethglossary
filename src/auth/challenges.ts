/**
 * Single-use values a sign-in flow has to remember between two requests: the
 * OAuth `state` and the SIWE nonce. Ten-minute lifetime, consumed exactly
 * once, stored hashed so a read of the table hands out nothing usable.
 */

import { randomBytes } from "node:crypto"
import type { Sql } from "../db/client"
import { sha256 } from "./session"

export type ChallengeKind = "oauth_state" | "siwe_nonce"

export const CHALLENGE_LIFETIME_MS = 10 * 60 * 1000

/**
 * Only same-origin paths may be a post-sign-in destination. Anything else --
 * a full URL, a protocol-relative `//host`, a backslash trick -- is dropped
 * so the sign-in flow can never be used as an open redirect. The sign-in
 * pages themselves are excluded too, or `/signin?next=/signin` would loop.
 */
export function safeNextPath(value: string | undefined | null): string | null {
  if (!value) return null
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (value.length > 512) return null
  const path = value.split(/[?#]/)[0]
  if (path === "/signin" || path === "/auth" || path.startsWith("/auth/")) return null
  return value
}

export async function createChallenge(
  sql: Sql,
  kind: ChallengeKind,
  provider: string | null,
  nextPath: string | null
): Promise<string> {
  // Alphanumeric, which EIP-4361 requires of a nonce and OAuth does not mind.
  const value = randomBytes(24).toString("base64url").replace(/[-_]/g, "")
  // Sweep on the way in as well as on the way out, so abandoned flows never
  // accumulate: this is the only table an unauthenticated request can grow.
  await sql`DELETE FROM auth_challenges WHERE expires_at < now()`
  await sql`
    INSERT INTO auth_challenges (challenge_hash, kind, provider, next_path, expires_at)
    VALUES (${sha256(value)}, ${kind}, ${provider}, ${nextPath}, ${new Date(Date.now() + CHALLENGE_LIFETIME_MS)})`
  return value
}

/**
 * Take a challenge out of the table. Returns its stored destination, or null
 * when the value is unknown, already used, or expired.
 */
export async function consumeChallenge(
  sql: Sql,
  kind: ChallengeKind,
  value: string
): Promise<{ provider: string | null; nextPath: string | null } | null> {
  const rows = await sql<{ provider: string | null; next_path: string | null }[]>`
    DELETE FROM auth_challenges
    WHERE challenge_hash = ${sha256(value)} AND kind = ${kind} AND expires_at >= now()
    RETURNING provider, next_path`
  const row = rows[0]
  return row ? { provider: row.provider, nextPath: row.next_path } : null
}
