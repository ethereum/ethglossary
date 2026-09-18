/**
 * The one database connection pool.
 *
 * Opened by src/server.ts when DATABASE_URL is set and handed to everything
 * else through getDb(). Without a DATABASE_URL the app runs exactly as it did
 * before there was a database: read-only glossary, no accounts, no feedback.
 * That is deliberate -- the glossary API is the critical path and must never
 * depend on the feedback store being reachable.
 */

import postgres from "postgres"

export type Sql = ReturnType<typeof postgres>

let db: Sql | null = null

export function openDatabase(url: string): Sql {
  db = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // NOTICE messages ("relation already exists, skipping") are noise.
    onnotice: () => {},
  })
  return db
}

/** The pool, or null when the app is running without a database. */
export function getDb(): Sql | null {
  return db
}

/**
 * Give up on the database for this process. Used when startup cannot reach
 * it: every feature that needs a database then sees getDb() === null and
 * degrades cleanly instead of failing request by request.
 */
export async function closeDatabase(): Promise<void> {
  const current = db
  db = null
  if (current) await current.end({ timeout: 1 }).catch(() => {})
}
