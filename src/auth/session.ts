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
 * `c.var.user`, along with whether accounts are available at all, and marks
 * any response rendered for a signed-in person `private, no-store` so nothing
 * between the container and the browser can cache one person's page for
 * another. It runs only for pages: static assets and the read API never
 * depend on who is asking, and looking up a session for every font file
 * would be a database round trip per subresource.
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

export type AppEnv = {
  Bindings: Record<string, never>
  Variables: { user: SessionUser | null; accountsAvailable: boolean }
}

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")

/** Whether cookies for this request must carry `Secure`. Local http dev cannot. */
const isHttps = (c: Context) => requestOrigin(c.req).startsWith("https://")

export async function createSession(sql: Sql, c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expires = new Date(Date.now() + SLIDING_DAYS * 86_400_000)
  // A sign-in is a good moment to drop sessions nobody can use any more.
  await sql`DELETE FROM sessions WHERE expires_at < now()`
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

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) })
}

/**
 * Sign out. The cookie is cleared no matter what; the row goes if the
 * database is reachable, and otherwise expires on its own. A sign-out that
 * left the browser holding a live token because the database was down would
 * be worse than an orphaned row.
 */
export async function destroySession(sql: Sql | null, c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  clearSessionCookie(c)
  if (sql && token) {
    await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`.catch((err: Error) =>
      console.error("session delete failed:", err.message)
    )
  }
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
 * Paths whose responses never depend on who is asking: the read API, static
 * assets and the crawler files. The feedback write API under /api/v1/feedback
 * is the one API prefix that does need the session.
 */
const SKIP_PREFIXES = ["/api/", "/assets/", "/fonts/", "/img/"]
const SKIP_EXACT = new Set(["/healthz", "/favicon.svg", "/openapi.json", "/llms.txt", "/robots.txt", "/sitemap.xml", "/docs"])
const NEEDS_SESSION_PREFIXES = ["/api/v1/feedback/"]

export function isUserAgnosticPath(path: string): boolean {
  if (NEEDS_SESSION_PREFIXES.some((p) => path.startsWith(p))) return false
  return SKIP_EXACT.has(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))
}

/**
 * Attach the signed-in user to every page request. A database error here is
 * logged and treated as "not signed in": a broken session store must degrade
 * to the read-only site, never to an error page.
 */
export const sessionMiddleware = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const sql = getDb()
    c.set("accountsAvailable", sql !== null)
    c.set("user", null)

    if (isUserAgnosticPath(c.req.path)) {
      await next()
      return
    }

    let user: SessionUser | null = null
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

    // Every page body depends on the cookie (the nav differs), so say so to
    // any shared cache; a signed-in body must not be stored at all.
    c.res.headers.append("Vary", "Cookie")
    if (user) c.res.headers.set("Cache-Control", "private, no-store")
  }
}
