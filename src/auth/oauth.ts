/**
 * OAuth 2.0 authorization-code sign-in for GitHub and Discord.
 *
 * Hand-rolled on purpose: each provider is one redirect out, one callback
 * in, one token exchange and one profile fetch. The parts that carry risk --
 * binding `state` to the browser, deriving the callback URL from the
 * request, never persisting provider tokens -- are ours to get right whatever
 * makes the HTTP calls, and the calls themselves are two documented POSTs.
 *
 * `state` is bound twice: to a short-lived cookie in the browser that started
 * the flow, and to a single-use row in auth_challenges. The callback must
 * match both. The cookie is per provider, so starting a GitHub sign-in and
 * then a Discord one does not invalidate the first. The provider's access
 * token is used for exactly one request, the profile fetch, and then dropped.
 */

import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { Sql } from "../db/client"
import { requestOrigin } from "../lib/request-origin"
import { consumeChallenge, createChallenge } from "./challenges"
import type { OAuthProvider } from "./config"

const STATE_COOKIE_MAX_AGE = 10 * 60

const stateCookie = (provider: OAuthProvider) => `ethglossary-oauth-${provider.id}`

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 502 = 400
  ) {
    super(message)
    this.name = "OAuthError"
  }
}

const callbackUrl = (c: Context, provider: OAuthProvider) =>
  `${requestOrigin(c.req)}/auth/${provider.id}/callback`

/** Step one: remember `state` in two places and send the browser to the provider. */
export async function startOAuth(
  sql: Sql,
  c: Context,
  provider: OAuthProvider,
  nextPath: string | null
): Promise<Response> {
  const state = await createChallenge(sql, "oauth_state", provider.id, nextPath)
  setCookie(c, stateCookie(provider), state, {
    httpOnly: true,
    secure: requestOrigin(c.req).startsWith("https://"),
    sameSite: "Lax",
    path: "/auth",
    maxAge: STATE_COOKIE_MAX_AGE,
  })

  const url = new URL(provider.authorizeUrl)
  url.searchParams.set("client_id", provider.clientId)
  url.searchParams.set("redirect_uri", callbackUrl(c, provider))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", state)
  if (provider.scope) url.searchParams.set("scope", provider.scope)
  return c.redirect(url.toString(), 302)
}

export interface OAuthIdentity {
  subject: string
  /** undefined when the profile did not include one; leaves a stored handle alone. */
  handle: string | undefined
  nextPath: string | null
}

/** Step two: the provider sent the browser back. Check state, exchange, read the profile. */
export async function finishOAuth(sql: Sql, c: Context, provider: OAuthProvider): Promise<OAuthIdentity> {
  const code = c.req.query("code")
  const state = c.req.query("state")
  const cookieState = getCookie(c, stateCookie(provider))
  deleteCookie(c, stateCookie(provider), { path: "/auth" })

  if (c.req.query("error")) {
    throw new OAuthError(`${provider.label} did not authorize the sign-in (${c.req.query("error")})`)
  }
  if (!code || !state) throw new OAuthError("the sign-in response was incomplete")
  if (!cookieState || cookieState !== state) {
    throw new OAuthError("this sign-in did not start in this browser, or took too long; try again")
  }
  const challenge = await consumeChallenge(sql, "oauth_state", state)
  if (!challenge || challenge.provider !== provider.id) {
    throw new OAuthError("this sign-in link was already used or has expired; try again")
  }

  const token = await exchangeCode(c, provider, code)
  const profile = await fetchProfile(provider, token)
  return { ...profile, nextPath: challenge.nextPath }
}

async function exchangeCode(c: Context, provider: OAuthProvider, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(c, provider),
  })
  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => {
    throw new OAuthError(`${provider.label} could not be reached (${err.message})`, 502)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const accessToken = json.access_token
  if (!res.ok || typeof accessToken !== "string" || !accessToken) {
    const detail = typeof json.error === "string" ? json.error : `HTTP ${res.status}`
    throw new OAuthError(`${provider.label} rejected the sign-in (${detail})`, 502)
  }
  return accessToken
}

async function fetchProfile(provider: OAuthProvider, accessToken: string) {
  const res = await fetch(provider.userUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      // GitHub refuses requests without one.
      "User-Agent": "ethglossary",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => {
    throw new OAuthError(`${provider.label} could not be reached (${err.message})`, 502)
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const profile = res.ok && json ? provider.profile(json) : null
  if (!profile) throw new OAuthError(`${provider.label} returned an unusable profile (HTTP ${res.status})`, 502)
  return profile
}
