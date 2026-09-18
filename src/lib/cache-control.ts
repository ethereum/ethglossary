/**
 * Cache-Control for successful GET responses.
 *
 * The read API is aggressively cacheable (see docs/design-decisions.md,
 * "Caching") and this is the whole mechanism: a header the proxy in front
 * of the container and every browser honor. It replaces Hono's `cache()`
 * middleware, which depends on the Workers Cache API and silently does
 * nothing on Node.
 */

import type { MiddlewareHandler } from "hono"

export const cacheControl = (value: string): MiddlewareHandler => {
  return async (c, next) => {
    await next()
    if (c.req.method === "GET" && c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
      c.res.headers.set("Cache-Control", value)
    }
  }
}
