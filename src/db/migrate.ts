/**
 * Schema migrations.
 *
 * `migrations/NNNN_label.sql` files, applied in name order, each exactly once,
 * recorded in schema_migrations. Runs at startup before the server listens.
 *
 * Everything, including creating the bookkeeping table, happens inside one
 * transaction that first takes an advisory lock. Several replicas starting at
 * once therefore serialize completely: the first applies what is pending, the
 * rest wake up, see it recorded, and do nothing. Even `CREATE TABLE IF NOT
 * EXISTS` has to be inside the lock -- run concurrently from two connections
 * it races on the catalog and one side fails with a duplicate-key error.
 * PostgreSQL DDL is transactional, so a failing file leaves the database as
 * it was.
 *
 * Waits are bounded by one budget, `budgetMs`: the lock wait gets up to half
 * of it (capped at 30 s), no single statement may exceed it, and the caller's
 * own timer sits just past it as the backstop for the whole run. A replica
 * must never sit at boot forever behind a stalled peer or a statement that
 * will not finish; past the budget the caller treats the database as
 * unavailable and serves without it.
 *
 * That makes the budget a ceiling on how long a migration may run, and it is
 * meant to be one. Migration files change the schema and finish in seconds.
 * Anything that has to touch many rows -- a backfill, a rebuild of derived
 * data -- is a script or a startup task with its own pacing, never a
 * migration, because a file that cannot finish inside the budget fails on
 * every replica identically and leaves feedback off until someone raises
 * DB_STARTUP_TIMEOUT for that deploy.
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Sql } from "./client"

/** Arbitrary constant; only has to differ from the indexer's lock. */
const LOCK_KEY = 0x6d696772 // "migr"

const FILE_SHAPE = /^\d{4}_[a-z0-9_-]+\.sql$/

/**
 * `migrations/` beside `dist/`: `/app/migrations` in the image and
 * `<repo>/migrations` in development, wherever the process was started from.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url))

/**
 * The migration files themselves are missing or unreadable. That is a build
 * problem, not a database outage, and the log should say so.
 */
export class MigrationFilesError extends Error {
  constructor(dir: string, cause: string) {
    super(`migration files unreadable at ${dir}: ${cause}`)
    this.name = "MigrationFilesError"
  }
}

export interface MigrateOptions {
  dir?: string
  /** Upper bound on the whole run; also caps lock and statement waits. */
  budgetMs?: number
}

export async function migrate(sql: Sql, options: MigrateOptions = {}): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR
  const budgetSeconds = Math.max(5, Math.floor((options.budgetMs ?? 60_000) / 1000))
  const lockSeconds = Math.min(30, Math.max(1, Math.floor(budgetSeconds / 2)))

  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => FILE_SHAPE.test(f)).sort()
  } catch (err) {
    throw new MigrationFilesError(dir, (err as Error).message)
  }
  if (files.length === 0) throw new MigrationFilesError(dir, "no migration files found")

  return sql.begin(async (tx): Promise<string[]> => {
    await tx.unsafe(`SET LOCAL lock_timeout = '${lockSeconds}s'`)
    await tx.unsafe(`SET LOCAL statement_timeout = '${budgetSeconds}s'`)
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`
    const applied = new Set(
      (await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name)
    )

    const done: string[] = []
    for (const file of files) {
      if (applied.has(file)) continue
      const body = await readFile(path.join(dir, file), "utf8")
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
      done.push(file)
    }
    return done
  })
}
