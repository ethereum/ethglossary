/**
 * A small fixed-window rate limit for the two unauthenticated endpoints that
 * write a row: the SIWE nonce and the OAuth start. Both insert into
 * auth_challenges, so without a ceiling a loop over either grows the table
 * until the sweep catches up.
 *
 * In memory, per replica, keyed on the client address. That is dampening,
 * not accounting: a determined client with many addresses gets through, but
 * a script hammering one endpoint does not turn into a table of millions.
 * Nothing is persisted and no address is logged except when a limit trips.
 *
 * The one failure that matters is keying every visitor on the same address,
 * which would turn "30 per client" into "30 for the whole site". So the key
 * is resolved carefully, and when it cannot be resolved the limit is skipped
 * rather than shared -- a limiter that cannot tell clients apart must not be
 * enforced.
 */

import type { Context } from "hono"
import { getConnInfo } from "@hono/node-server/conninfo"

interface Window {
  count: number
  resetAt: number
}

const buckets = new Map<string, Window>()
let sweeps = 0
const warned = new Set<string>()

/**
 * How many proxies in front of this process append to X-Forwarded-For. Each
 * hop records the peer it received from, left to right, so the client is the
 * entry this many places from the right. Default 1: a single ingress.
 */
export const TRUSTED_PROXY_HOPS = (() => {
  const raw = process.env.TRUSTED_PROXY_HOPS
  const n = raw === undefined || raw === "" ? 1 : Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`ignoring TRUSTED_PROXY_HOPS=${JSON.stringify(raw)}: expected a whole number of at least 1; using 1`)
    return 1
  }
  return n
})()

/** Loopback, link-local and RFC 1918 / ULA space: a proxy or a dev machine, never an internet client. */
export function isPrivateAddress(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase()
  if (a === "::1" || a === "localhost") return true
  if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7))
  if (/^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return true
  return false
}

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

/**
 * The client's address as the proxy chain reports it, or null when it cannot
 * be determined: too few X-Forwarded-For entries for the configured hops, an
 * address that is plainly a proxy's own, or no connection information.
 */
export function clientKey(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for")
  let address: string | null = null
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean)
    const index = parts.length - TRUSTED_PROXY_HOPS
    if (index < 0) {
      warnOnce("xff-short", `rate limit skipped: X-Forwarded-For has ${parts.length} entries but TRUSTED_PROXY_HOPS is ${TRUSTED_PROXY_HOPS}`)
      return null
    }
    address = parts[index]
  } else {
    try {
      address = getConnInfo(c).remote.address ?? null
    } catch {
      address = null
    }
  }
  if (!address) {
    warnOnce("no-address", "rate limit skipped: client address could not be determined")
    return null
  }
  if (isPrivateAddress(address)) {
    // Every visitor would share this key. Almost always a proxy hop that is
    // not counted in TRUSTED_PROXY_HOPS, or a proxy that sets no header.
    warnOnce(
      "private-address",
      `rate limit skipped: resolved client address ${address} is a private or loopback address; check TRUSTED_PROXY_HOPS and the proxy's X-Forwarded-For`
    )
    return null
  }
  return address
}

/** True when this key is still within `limit` calls in the current `windowMs`. A null key is never limited. */
export function allow(scope: string, key: string | null, limit: number, windowMs: number): boolean {
  if (key === null) return true
  const now = Date.now()
  const id = `${scope}:${key}`
  let w = buckets.get(id)
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs }
    buckets.set(id, w)
  }
  w.count++
  if (w.count === limit + 1) {
    console.warn(`rate limit tripped: ${scope} for ${key} (${limit} per ${windowMs / 1000}s)`)
  }

  // Every so often drop windows that have expired, so the map cannot grow
  // with the number of distinct addresses ever seen.
  if (++sweeps % 500 === 0) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  return w.count <= limit
}
