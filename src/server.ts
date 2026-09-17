/**
 * Node entry point.
 *
 * `src/index.ts` is the application and knows nothing about where it runs.
 * This file is the part that does: it serves the static assets under
 * `public/`, answers the cluster's health probe, listens on the configured
 * address, and shuts down cleanly when the orchestrator asks. Everything here
 * is also what `pnpm dev` runs locally, so development and production are the
 * same program.
 */

import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import app from "./index"

const port = Number(process.env.PORT ?? 8787)
// Loopback by default so a laptop is not listening on every interface; the
// container sets HOST=0.0.0.0 so the cluster can reach it.
const hostname = process.env.HOST ?? "127.0.0.1"

/*
 * Static files. Fonts and images are content that changes only with a new
 * deploy and can be cached for a long time; the stylesheet keeps its name
 * across edits, so it gets an hour and revalidation.
 */
const staticWithCache = (cacheControl: string) =>
  serveStatic({
    root: "./public",
    onFound: (_path, c) => c.header("Cache-Control", cacheControl),
  })

app.use("/assets/*", staticWithCache("public, max-age=3600, must-revalidate"))
app.use("/fonts/*", staticWithCache("public, max-age=2592000, immutable"))
app.use("/img/*", staticWithCache("public, max-age=2592000"))

/** Liveness and readiness probe. Always uncached, never logged as content. */
app.get("/healthz", (c) => {
  c.header("Cache-Control", "no-store")
  return c.text("ok")
})

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    `ethglossary listening on http://${info.address}:${info.port}` +
      (process.env.GIT_SHA ? ` (${process.env.GIT_SHA.slice(0, 7)})` : "")
  )
})

/*
 * A rollout sends SIGTERM and waits. Stop accepting connections, let in-flight
 * requests finish, then exit; if something hangs, leave anyway before the
 * orchestrator's grace period runs out.
 */
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
