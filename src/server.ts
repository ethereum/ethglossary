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
import { closeDatabase, openDatabase } from "./db/client"
import type { Sql } from "./db/client"
import { migrate, MigrationFilesError } from "./db/migrate"
import { describeBuild, runIndexer } from "./lib/indexer"

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

/*
 * The feedback store is optional. Without DATABASE_URL the site is the
 * read-only glossary it always was. With it, the schema is brought up to date
 * before the server listens, and the change indexer runs once the server is
 * up. Anything that goes wrong here -- an unparseable URL, an unreachable
 * host, a lock that never frees, a build missing its migration files -- is
 * logged and the site still serves. The glossary API is the critical path;
 * feedback is not.
 *
 * DB_STARTUP_TIMEOUT (seconds, default 60) bounds how long a boot may wait on
 * the database before giving up on it for this process.
 */
const startupBudgetMs = Number(process.env.DB_STARTUP_TIMEOUT ?? 60) * 1000

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000}s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

let db: Sql | null = null
if (process.env.DATABASE_URL) {
  try {
    db = openDatabase(process.env.DATABASE_URL)
    const applied = await withTimeout(migrate(db), startupBudgetMs, "schema migration")
    console.log(applied.length ? `applied migrations: ${applied.join(", ")}` : "schema up to date")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason = err instanceof MigrationFilesError ? `build problem: ${message}` : `database unavailable: ${message}`
    console.error(`${reason}; serving without feedback features`)
    await closeDatabase(1)
    db = null
  }
} else {
  console.log("DATABASE_URL not set, serving without feedback features")
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    `ethglossary listening on http://${info.address}:${info.port}` +
      (process.env.GIT_SHA ? ` (${process.env.GIT_SHA.slice(0, 7)})` : "")
  )
})

if (db) {
  const sql = db
  describeBuild()
    .then((build) => runIndexer(sql, build))
    .then((r) => {
      const detail = r.status === "indexed" ? ` (${r.first ? "first run, " : ""}${r.changes} changes)` : ""
      console.log(`indexer: ${r.status}${detail}`)
    })
    .catch((err) => console.error("indexer failed:", err instanceof Error ? err.message : err))
}

/*
 * A rollout sends SIGTERM and waits. Stop accepting connections, let in-flight
 * requests finish, close the pool, then exit; if something hangs, leave anyway
 * before the orchestrator's grace period runs out.
 */
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`)
  server.close(() => {
    void closeDatabase(5).finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
