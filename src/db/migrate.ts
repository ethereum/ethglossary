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
 * Waits are bounded. A replica must never sit at boot forever behind a lock
 * held by a stalled peer or a statement that will not finish; past the limits
 * below the caller treats the database as unavailable and serves without it.
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

export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => FILE_SHAPE.test(f)).sort()
  } catch (err) {
    throw new MigrationFilesError(dir, (err as Error).message)
  }
  if (files.length === 0) throw new MigrationFilesError(dir, "no migration files found")

  return sql.begin(async (tx): Promise<string[]> => {
    await tx.unsafe("SET LOCAL lock_timeout = '30s'")
    await tx.unsafe("SET LOCAL statement_timeout = '300s'")
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
