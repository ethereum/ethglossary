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
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { Sql } from "./client"

/** Arbitrary constant; only has to differ from the indexer's lock. */
const LOCK_KEY = 0x6d696772 // "migr"

const FILE_SHAPE = /^\d{4}_[a-z0-9_-]+\.sql$/

export async function migrate(sql: Sql, dir = "migrations"): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => FILE_SHAPE.test(f)).sort()

  return sql.begin(async (tx): Promise<string[]> => {
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
