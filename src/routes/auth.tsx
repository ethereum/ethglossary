/**
 * Sign-in, sign-out and the account page.
 *
 * Everything here needs the database. When there is none (no DATABASE_URL,
 * or it was unreachable at boot) the pages say so with a 503 and the rest of
 * the site is unaffected.
 *
 * Form posts are protected by Hono's CSRF middleware, which checks the
 * Origin header against the request's own origin. The two JSON endpoints
 * require `Content-Type: application/json`, which forces a CORS preflight
 * from any other origin, and check Origin themselves as well.
 */

import { Hono } from "hono"
import { csrf } from "hono/csrf"
import { bodyLimit } from "hono/body-limit"
import type { Context } from "hono"
import { SignInPage } from "../ui/pages/signin"
import { AccountPage } from "../ui/pages/account"
import { getDb } from "../db/client"
import type { Sql } from "../db/client"
import { requestOrigin } from "../lib/request-origin"
import { languageFromCookie } from "../lib/negotiate-language"
import type { PageUrl } from "../ui/layout"
import { authConfig, oauthProvider } from "../auth/config"
import { safeNextPath } from "../auth/challenges"
import { finishOAuth, OAuthError, startOAuth } from "../auth/oauth"
import { createSession, destroySession } from "../auth/session"
import type { AppEnv } from "../auth/session"
import { issueNonce, SiweError, verifySiwe } from "../auth/siwe"
import {
  AccountBannedError,
  deleteAccount,
  findOrCreateUser,
  shortAddress,
  updateDisplayName,
} from "../auth/users"

const app = new Hono<AppEnv>()

/** Same-origin only: the allowed origin is the request's own, never a constant. */
app.use("*", csrf({ origin: (origin, c) => origin === requestOrigin(c.req) }))
app.use("*", bodyLimit({ maxSize: 16 * 1024 }))

const pageUrl = (c: Context): PageUrl => ({ origin: requestOrigin(c.req), path: new URL(c.req.url).pathname })
const activeLang = (c: Context) => languageFromCookie(c.req.header("Cookie"))
const nextFromQuery = (c: Context) => safeNextPath(c.req.query("next"))

const signInPage = (c: Context, opts: { error?: string; next?: string | null; status?: 400 | 401 | 502 | 503 }) =>
  c.html(
    <SignInPage
      providers={authConfig().providers.map((p) => ({ id: p.id, label: p.label }))}
      next={opts.next ?? nextFromQuery(c)}
      error={opts.error}
      activeLang={activeLang(c)}
      url={pageUrl(c)}
    />,
    opts.status ?? 200
  )

/** The database, or a 503 page explaining that accounts are unavailable. */
async function requireDb(c: Context): Promise<Sql | Response> {
  const sql = getDb()
  if (sql) return sql
  return signInPage(c, {
    error: "Accounts are temporarily unavailable. The glossary itself is unaffected.",
    status: 503,
  })
}

/** JSON endpoints: same-origin, JSON body, database present. */
function jsonPrecheck(c: Context): Sql | Response {
  const origin = c.req.header("Origin")
  if (origin && origin !== requestOrigin(c.req)) return c.json({ error: "cross-origin request refused" }, 403)
  if (!/^application\/json\b/i.test(c.req.header("Content-Type") ?? "")) {
    return c.json({ error: "expected application/json" }, 415)
  }
  const sql = getDb()
  return sql ?? c.json({ error: "accounts are temporarily unavailable" }, 503)
}

// ------------------------------------------------------------------ pages

app.get("/signin", async (c) => {
  if (c.var.user) return c.redirect(nextFromQuery(c) ?? "/account", 302)
  const sql = await requireDb(c)
  if (sql instanceof Response) return sql
  return signInPage(c, {})
})

app.get("/account", (c) => {
  const user = c.var.user
  if (!user) return c.redirect("/signin?next=%2Faccount", 302)
  return c.html(
    <AccountPage user={user} saved={c.req.query("saved") === "1"} activeLang={activeLang(c)} url={pageUrl(c)} />
  )
})

app.post("/account", async (c) => {
  const user = c.var.user
  if (!user) return c.redirect("/signin?next=%2Faccount", 302)
  const sql = await requireDb(c)
  if (sql instanceof Response) return sql
  const form = await c.req.parseBody()
  const value = typeof form.display_name === "string" ? form.display_name : null
  await updateDisplayName(sql, user.id, value)
  return c.redirect("/account?saved=1", 303)
})

app.post("/account/delete", async (c) => {
  const user = c.var.user
  if (!user) return c.redirect("/signin", 302)
  const sql = await requireDb(c)
  if (sql instanceof Response) return sql
  await deleteAccount(sql, user.id)
  await destroySession(sql, c)
  return c.redirect("/", 303)
})

app.post("/auth/signout", async (c) => {
  const sql = getDb()
  if (sql) await destroySession(sql, c)
  return c.redirect("/", 303)
})

// ------------------------------------------------------------------ oauth

app.get("/auth/:provider", async (c) => {
  const provider = oauthProvider(c.req.param("provider"))
  if (!provider) return c.notFound()
  const sql = await requireDb(c)
  if (sql instanceof Response) return sql
  return startOAuth(sql, c, provider, nextFromQuery(c))
})

app.get("/auth/:provider/callback", async (c) => {
  const provider = oauthProvider(c.req.param("provider"))
  if (!provider) return c.notFound()
  const sql = await requireDb(c)
  if (sql instanceof Response) return sql

  try {
    const identity = await finishOAuth(sql, c, provider)
    const user = await findOrCreateUser(sql, provider.id, identity.subject, {
      handle: identity.handle,
      displayName: identity.handle,
      ensName: null,
    })
    await createSession(sql, c, user.id)
    return c.redirect(identity.nextPath ?? "/account", 303)
  } catch (err) {
    return signInFailure(c, err)
  }
})

// ------------------------------------------------------------------- siwe

app.post("/auth/siwe/nonce", async (c) => {
  const sql = jsonPrecheck(c)
  if (sql instanceof Response) return sql
  const body = (await c.req.json().catch(() => ({}))) as { next?: unknown }
  const next = safeNextPath(typeof body.next === "string" ? body.next : null)
  const nonce = await issueNonce(sql, next)
  c.header("Cache-Control", "no-store")
  return c.json({ nonce })
})

app.post("/auth/siwe/verify", async (c) => {
  const sql = jsonPrecheck(c)
  if (sql instanceof Response) return sql
  const body = (await c.req.json().catch(() => ({}))) as { message?: unknown; signature?: unknown }
  const origin = requestOrigin(c.req)
  c.header("Cache-Control", "no-store")

  try {
    const identity = await verifySiwe(
      sql,
      new URL(origin).host,
      origin,
      authConfig().siwe.rpcUrl,
      String(body.message ?? ""),
      String(body.signature ?? "")
    )
    const user = await findOrCreateUser(sql, "siwe", identity.address.toLowerCase(), {
      handle: null,
      displayName: identity.ensName ?? shortAddress(identity.address),
      ensName: identity.ensName,
    })
    await createSession(sql, c, user.id)
    return c.json({ ok: true, next: identity.nextPath ?? "/account" })
  } catch (err) {
    if (err instanceof SiweError) return c.json({ error: err.message }, err.status)
    if (err instanceof AccountBannedError) return c.json({ error: err.message }, 403)
    console.error("siwe verify failed:", err instanceof Error ? err.message : err)
    return c.json({ error: "sign-in failed" }, 500)
  }
})

function signInFailure(c: Context, err: unknown) {
  if (err instanceof OAuthError) return signInPage(c, { error: err.message, status: err.status })
  if (err instanceof AccountBannedError) return signInPage(c, { error: err.message, status: 401 })
  console.error("sign-in failed:", err instanceof Error ? err.message : err)
  return signInPage(c, { error: "Sign-in failed. Please try again.", status: 502 })
}

export default app
