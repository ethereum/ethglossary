/**
 * The one database connection pool.
 *
 * Opened and brought up to date by src/server.ts, then *published* here so
 * everything else can reach it through getDb(). Opening and publishing are
 * separate steps on purpose: until the schema is confirmed current, getDb()
 * stays null and the site advertises no accounts, instead of showing a live
 * "Sign in" against a database that is not ready.
 *
 * Without a DATABASE_URL the app runs exactly as it did before there was a
 * database: read-only glossary, no accounts, no feedback. That is deliberate
 * -- the glossary API is the critical path and must never depend on the
 * feedback store being reachable.
 */

import postgres from "postgres"

export type Sql = ReturnType<typeof postgres>

let published: Sql | null = null

/** Create a pool. Nothing sees it until publishDatabase(). */
export function openDatabase(url: string): Sql {
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // NOTICE messages ("relation already exists, skipping") are noise.
    onnotice: () => {},
  })
}

/** Make the pool the one getDb() hands out. Call only once the schema is current. */
export function publishDatabase(sql: Sql): void {
  published = sql
}

/** The pool, or null when the app is running without a database. */
export function getDb(): Sql | null {
  return published
}

/**
 * Close a pool, unpublishing it if it was the published one. At startup this
 * discards a pool whose database could not be reached; at shutdown it lets
 * in-flight statements finish for up to `timeoutSeconds`.
 */
export async function closeDatabase(sql: Sql | null = published, timeoutSeconds = 5): Promise<void> {
  if (!sql) return
  if (sql === published) published = null
  await sql.end({ timeout: timeoutSeconds }).catch(() => {})
}
