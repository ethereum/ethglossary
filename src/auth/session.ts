/**
 * Sessions.
 *
 * The cookie carries a random 256-bit token; the database stores only its
 * SHA-256, so a read of the sessions table cannot be replayed as a login.
 * Sessions slide: each visit more than an hour after the last extends the
 * expiry to thirty days out, up to ninety days after sign-in, then the
 * person signs in again.
 *
 * The middleware attaches the signed-in user (or null) to the request as
 * `c.var.user`, and marks any response rendered for a signed-in person
 * `private, no-store` so nothing between the container and the browser can
 * cache one person's page for another.
 */

import { createHash, randomBytes } from "node:crypto"
import type { Context, MiddlewareHandler } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { getDb } from "../db/client"
import type { Sql } from "../db/client"
import { requestOrigin } from "../lib/request-origin"

export const SESSION_COOKIE = "ethglossary-session"

const SLIDING_DAYS = 30
const ABSOLUTE_DAYS = 90
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface SessionUser {
  id: string
  provider: string
  displayName: string | null
  ensName: string | null
  createdAt: Date
}

export type AppEnv = { Bindings: Record<string, never>; Variables: { user: SessionUser | null } }

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")

/** Whether cookies for this request must carry `Secure`. Local http dev cannot. */
const isHttps = (c: Context) => requestOrigin(c.req).startsWith("https://")

export async function createSession(sql: Sql, c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expires = new Date(Date.now() + SLIDING_DAYS * 86_400_000)
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${sha256(token)}, ${userId}, ${expires})`
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SLIDING_DAYS * 86_400,
  })
}

export async function destroySession(sql: Sql, c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) })
}

/** Sign the person out of every browser. Used when an account is deleted. */
export async function destroyAllSessions(sql: Sql, userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`
}

interface SessionRow {
  token_hash: string
  user_id: string
  session_created: Date
  last_seen_at: Date
  provider: string
  display_name: string | null
  ens_name: string | null
  user_created: Date
}

async function resolveSession(sql: Sql, token: string): Promise<SessionUser | null> {
  const hash = sha256(token)
  const rows = await sql<SessionRow[]>`
    SELECT s.token_hash, s.user_id, s.created_at AS session_created, s.last_seen_at,
           u.provider, u.display_name, u.ens_name, u.created_at AS user_created
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash}
      AND s.expires_at > now()
      AND u.deleted_at IS NULL
      AND u.banned_at IS NULL`
  const row = rows[0]
  if (!row) return null

  // Slide the expiry, at most once an hour, never past the absolute cap.
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    const cap = new Date(row.session_created.getTime() + ABSOLUTE_DAYS * 86_400_000)
    const slid = new Date(Date.now() + SLIDING_DAYS * 86_400_000)
    const expires = slid < cap ? slid : cap
    await sql`UPDATE sessions SET last_seen_at = now(), expires_at = ${expires} WHERE token_hash = ${hash}`
    await sql`UPDATE users SET last_seen_at = now() WHERE id = ${row.user_id}`
  }

  return {
    id: row.user_id,
    provider: row.provider,
    displayName: row.display_name,
    ensName: row.ens_name,
    createdAt: row.user_created,
  }
}

/**
 * Attach the signed-in user to every request. A database error here is
 * logged and treated as "not signed in": a broken session store must degrade
 * to the read-only site, never to an error page.
 */
export const sessionMiddleware = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    let user: SessionUser | null = null
    const sql = getDb()
    const token = getCookie(c, SESSION_COOKIE)
    if (sql && token) {
      try {
        user = await resolveSession(sql, token)
      } catch (err) {
        console.error("session lookup failed:", err instanceof Error ? err.message : err)
      }
    }
    c.set("user", user)
    await next()
    if (user) {
      c.res.headers.set("Cache-Control", "private, no-store")
      c.res.headers.append("Vary", "Cookie")
    }
  }
}
