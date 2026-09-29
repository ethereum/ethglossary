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
import { closeDatabase, openDatabase, publishDatabase } from "./db/client"
import type { Sql } from "./db/client"
import { migrate, MigrationFilesError } from "./db/migrate"
import { describeBuild, runIndexer } from "./lib/indexer"
import { authConfig } from "./auth/config"

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
 * DB_STARTUP_TIMEOUT (whole seconds, default 60, minimum 5) bounds how long
 * a boot may wait on the database before giving up on it for this process.
 * It is also the ceiling on how long a migration may run; see
 * src/db/migrate.ts for why migrations are expected to be fast.
 */
function startupBudgetMs(): number {
  const raw = process.env.DB_STARTUP_TIMEOUT
  if (raw === undefined || raw === "") return 60_000
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 5) {
    console.warn(`ignoring DB_STARTUP_TIMEOUT=${JSON.stringify(raw)}: expected whole seconds, at least 5; using 60`)
    return 60_000
  }
  return Math.floor(seconds) * 1000
}
const budgetMs = startupBudgetMs()

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

/**
 * Open the pool and bring the schema up to date. Returns null, with the pool
 * closed again, when that cannot be done inside the budget; the caller
 * decides whether to try again later.
 */
async function connectDatabase(url: string, quiet: boolean): Promise<Sql | null> {
  // Not published yet: getDb() stays null, and the site advertises no
  // accounts, until the schema is confirmed current.
  const sql = openDatabase(url)
  try {
    // The database enforces the budget itself through lock and statement
    // timeouts; the outer timer sits just past it as the backstop.
    const applied = await withTimeout(migrate(sql, { budgetMs }), budgetMs + 5_000, "schema migration")
    console.log(applied.length ? `applied migrations: ${applied.join(", ")}` : "schema up to date")
    publishDatabase(sql)
    return sql
  } catch (err) {
    await closeDatabase(sql, 1)
    if (err instanceof MigrationFilesError) throw err
    if (!quiet) console.error(`database unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function startIndexer(sql: Sql) {
  describeBuild()
    .then((build) => runIndexer(sql, build))
    .then((r) => {
      const detail = r.status === "indexed" ? ` (${r.first ? "first run, " : ""}${r.changes} changes)` : ""
      console.log(`indexer: ${r.status}${detail}`)
    })
    .catch((err) => console.error("indexer failed:", err instanceof Error ? err.message : err))
}

/** How often to look again for a database that was not there at boot. */
const RECONNECT_MS = 30_000

let db: Sql | null = null
const databaseUrl = process.env.DATABASE_URL
if (databaseUrl) {
  try {
    db = await connectDatabase(databaseUrl, false)
  } catch (err) {
    // Missing migration files: a build problem, not something that heals.
    console.error(`build problem: ${(err as Error).message}; serving without feedback features`)
  }
  if (!db) {
    /*
     * Serve without accounts now, but keep looking. A database that was down
     * during a rollout, or a local container started after the dev server,
     * should not need every replica restarted by hand. getDb() turns non-null
     * the moment this succeeds, and the sign-in control follows on the next
     * request.
     */
    console.error(`serving without feedback features; retrying the database every ${RECONNECT_MS / 1000}s`)
    const retry = async () => {
      let sql: Sql | null = null
      try {
        sql = await connectDatabase(databaseUrl, true)
      } catch {
        return // build problem; give up quietly
      }
      if (sql) {
        db = sql
        console.log("database connected; feedback features enabled")
        startIndexer(sql)
      } else {
        setTimeout(retry, RECONNECT_MS).unref()
      }
    }
    setTimeout(retry, RECONNECT_MS).unref()
  }
} else {
  console.log("DATABASE_URL not set, serving without feedback features")
}

if (db) {
  const { providers, siwe } = authConfig()
  const methods = [...providers.map((p) => p.id), `siwe${siwe.rpcUrl ? "" : " (no rpc: EOA wallets only, no ENS)"}`]
  console.log(`sign-in: ${methods.join(", ")}`)
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(
    `ethglossary listening on http://${info.address}:${info.port}` +
      (process.env.GIT_SHA ? ` (${process.env.GIT_SHA.slice(0, 7)})` : "")
  )
})

if (db) startIndexer(db)

/*
 * A rollout sends SIGTERM and waits. Stop accepting connections, let in-flight
 * requests finish, close the pool, then exit; if something hangs, leave anyway
 * before the orchestrator's grace period runs out.
 */
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`)
  server.close(() => {
    void closeDatabase(undefined, 5).finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
