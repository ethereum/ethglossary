/**
 * A small fixed-window rate limit for the two unauthenticated endpoints that
 * write a row: the SIWE nonce and the OAuth start. Both insert into
 * auth_challenges, so without a ceiling a loop over either grows the table
 * until the sweep catches up.
 *
 * In memory, per replica, keyed on the client address. That is dampening,
 * not accounting: a determined client with many addresses gets through, but
 * a script hammering one endpoint does not turn into a table of millions.
 * Nothing is persisted and no address is logged.
 */

import type { Context } from "hono"
import { getConnInfo } from "@hono/node-server/conninfo"

interface Window {
  count: number
  resetAt: number
}

const buckets = new Map<string, Window>()
let sweeps = 0

/**
 * The client's address as the proxy reports it. The last X-Forwarded-For
 * entry is the one our own ingress appended, so it is the one to trust; the
 * earlier entries are whatever the client claimed. With no header (local
 * development) it is the socket's peer.
 */
export function clientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown"
  } catch {
    return "unknown"
  }
}

/** True when this key is still within `limit` calls in the current `windowMs`. */
export function allow(scope: string, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const id = `${scope}:${key}`
  let w = buckets.get(id)
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs }
    buckets.set(id, w)
  }
  w.count++

  // Every so often drop windows that have expired, so the map cannot grow
  // with the number of distinct addresses ever seen.
  if (++sweeps % 500 === 0) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  return w.count <= limit
}
