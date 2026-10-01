/**
 * The feedback write API, under /api/v1/feedback.
 *
 * Every route needs a signed-in person and the database, takes JSON only,
 * and appears in /openapi.json with the `cookieAuth` security scheme. The
 * `hash` in every body is the client's claim about what it saw; the server
 * recomputes it from the bundled glossary and answers 409 on a mismatch, so a
 * vote cast on a page loaded before a deploy can never land on the new value.
 *
 * Feedback is advisory. Nothing here changes the glossary.
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi"
import type { Context, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { getDb } from "../db/client"
import type { Sql } from "../db/client"
import { getTerms, loadTranslations, resolveTerm } from "../lib/glossary-data"
import type { GlossaryTerm } from "../lib/glossary-data"
import { applicableContexts, slotValue } from "../lib/context-types"
import { slotHash, termHash } from "../lib/hash"
import { requestOrigin } from "../lib/request-origin"
import { SUPPORTED_LANGUAGES } from "../lib/glossary-data"
import { allow } from "../auth/ratelimit"
import type { AppEnv } from "../auth/session"
import { LangParamSchema, TermIdParamSchema } from "../schemas/common"
import {
  FeedbackErrorSchema,
  IdParamSchema,
  ProposalBodySchema,
  ProposalResponseSchema,
  SuggestionBodySchema,
  SuggestionResponseSchema,
  VotesBodySchema,
  VotesResponseSchema,
} from "../schemas/feedback"
import * as store from "../feedback/store"

const app = new OpenAPIHono<AppEnv>()

/*
 * Per-person ceilings, in memory per replica: generous for a human working
 * through a language, uninteresting for a script. Writes above the ceiling
 * are refused with 429, nothing is recorded about them.
 */
const HOUR = 60 * 60 * 1000
const LIMITS = { votes: 600, suggestions: 60, proposals: 20 } as const

/**
 * Same origin, JSON, signed in, database present -- in that order, so an
 * anonymous cross-origin probe learns nothing about the account state.
 */
const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin")
  if (origin && origin !== requestOrigin(c.req)) return c.json({ error: "cross-origin request refused" }, 403)
  if (c.req.method !== "DELETE" && !/^application\/json\b/i.test(c.req.header("Content-Type") ?? "")) {
    return c.json({ error: "expected application/json" }, 415)
  }
  if (!c.var.user) return c.json({ error: "sign in to give feedback" }, 401)
  if (!getDb()) return c.json({ error: "accounts are temporarily unavailable" }, 503)
  c.header("Cache-Control", "no-store")
  await next()
}
app.use("/feedback/*", guard)
app.use("/feedback/*", bodyLimit({ maxSize: 16 * 1024 }))

const sql = (): Sql => getDb() as Sql
const userId = (c: Context<AppEnv>) => c.var.user!.id

/** The master entry and its key for a term id, plus the language's entry for it. */
async function locate(lang: string, termId: string) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) return null
  const term = resolveTerm(termId)
  if (!term) return null
  const master = getTerms()
  const key = Object.keys(master).find((k) => master[k].id === term.id)
  if (!key) return null
  const entry = (await loadTranslations(lang))[key]
  return entry ? { term, key, entry } : null
}

/**
 * A plurals suggestion arrives as `category=form` pairs joined by `|` and is
 * stored in slotValue()'s exact shape -- sorted by category -- so it compares
 * with what is live. Null when a pair is malformed, names a category this
 * entry does not mark, or repeats one.
 */
function canonicalPlurals(value: string, plurals: Record<string, string | null>): string | null {
  const allowed = new Set(Object.entries(plurals).filter(([, v]) => v).map(([k]) => k))
  const pairs = new Map<string, string>()
  for (const pair of value.split("|")) {
    const i = pair.indexOf("=")
    if (i <= 0) return null
    const k = pair.slice(0, i).trim()
    const v = store.normalizeValue(pair.slice(i + 1))
    if (!allowed.has(k) || pairs.has(k) || !v || v.length > 100) return null
    pairs.set(k, v)
  }
  if (!pairs.size) return null
  return [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("|")
}

const security = [{ cookieAuth: [] }]
const errors = {
  401: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Not signed in" },
  404: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Unknown term or language" },
  409: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "The value changed since the page loaded; reload" },
  429: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Too many writes; wait" },
}

// ---------------------------------------------------------------- votes

const votesRoute = createRoute({
  method: "put",
  path: "/feedback/translations/{lang}/{termId}/votes",
  tags: ["Feedback"],
  summary: "Vote on one or more translation slots",
  description:
    "One vote per person per slot value. `up`, `down`, or `none` to clear. Each item carries the hash of the value as rendered; a stale hash is refused with 409. Requires a session cookie.",
  security,
  request: {
    params: LangParamSchema.merge(TermIdParamSchema),
    body: { content: { "application/json": { schema: VotesBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: VotesResponseSchema } }, description: "Current tallies for the slots voted on" },
    ...errors,
  },
})

app.openapi(votesRoute, async (c) => {
  const { lang, termId } = c.req.valid("param")
  const { votes } = c.req.valid("json")
  const found = await locate(lang, termId)
  if (!found) return c.json({ error: "unknown term or language" }, 404)
  if (!allow("feedback-votes", userId(c), LIMITS.votes, HOUR)) return c.json({ error: "too many votes this hour" }, 429)

  const db = sql()
  const applicable = new Set(applicableContexts(found.entry))
  for (const v of votes) {
    if (!applicable.has(v.context)) return c.json({ error: `no ${v.context} slot for this term`, context: v.context }, 404)
    const current = slotHash(found.entry, v.context)
    if (current !== v.hash) return c.json({ error: "stale", context: v.context, current: current ?? undefined }, 409)
  }
  for (const v of votes) {
    const value = slotValue(found.entry, v.context) as string
    const version = await store.slotVersionId(db, found.term.uid, lang, v.context, v.hash, value)
    await store.setVote(db, userId(c), version, v.direction === "up" ? 1 : v.direction === "down" ? -1 : null)
  }

  const tallies = await store.tallies(db, found.term.uid, lang)
  const mine = await store.myVotes(db, userId(c), found.term.uid, lang)
  return c.json(
    {
      ok: true as const,
      tallies: votes.map((v) => {
        const key = store.slotKey(v.context, v.hash)
        const t = tallies.get(key) ?? { up: 0, down: 0 }
        const m = mine.get(key)
        return { context: v.context, hash: v.hash, up: t.up, down: t.down, mine: m === 1 ? ("up" as const) : m === -1 ? ("down" as const) : null }
      }),
    },
    200
  )
})

// ---------------------------------------------------------- suggestions

const suggestRoute = createRoute({
  method: "post",
  path: "/feedback/translations/{lang}/{termId}/suggestions",
  tags: ["Feedback"],
  summary: "Suggest a different translation for one slot",
  description:
    "Visible only to you and to the maintainers. Suggesting the same value twice is a no-op that reports `duplicate: true`. Requires a session cookie.",
  security,
  request: {
    params: LangParamSchema.merge(TermIdParamSchema),
    body: { content: { "application/json": { schema: SuggestionBodySchema } } },
  },
  responses: {
    201: { content: { "application/json": { schema: SuggestionResponseSchema } }, description: "Recorded" },
    400: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Suggestion equals the current value" },
    ...errors,
  },
})

app.openapi(suggestRoute, async (c) => {
  const { lang, termId } = c.req.valid("param")
  const body = c.req.valid("json")
  const found = await locate(lang, termId)
  if (!found) return c.json({ error: "unknown term or language" }, 404)
  if (!applicableContexts(found.entry).includes(body.context)) {
    return c.json({ error: `no ${body.context} slot for this term`, context: body.context }, 404)
  }
  const current = slotHash(found.entry, body.context)
  if (current !== body.hash) return c.json({ error: "stale", context: body.context, current: current ?? undefined }, 409)
  const currentValue = slotValue(found.entry, body.context) as string
  let value = body.value
  if (body.context === "plurals") {
    const canonical = canonicalPlurals(value, found.entry.plurals ?? {})
    if (!canonical) {
      return c.json({ error: "plural forms must be category=form pairs for this language's categories, joined by |" }, 400)
    }
    value = canonical
  }
  if (store.normalizeValue(value) === store.normalizeValue(currentValue)) {
    return c.json({ error: "that is already the current translation" }, 400)
  }
  if (!allow("feedback-suggestions", userId(c), LIMITS.suggestions, HOUR)) {
    return c.json({ error: "too many suggestions this hour" }, 429)
  }

  const db = sql()
  const version = await store.slotVersionId(db, found.term.uid, lang, body.context, body.hash, currentValue)
  const result = await store.addSuggestion(db, userId(c), version, value, body.reason?.trim() || null)
  return c.json(result, 201)
})

const deleteSuggestionRoute = createRoute({
  method: "delete",
  path: "/feedback/suggestions/{id}",
  tags: ["Feedback"],
  summary: "Withdraw one of your open suggestions",
  security,
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Withdrawn" },
    401: errors[401],
    404: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Not yours, not open, or not found" },
  },
})

app.openapi(deleteSuggestionRoute, async (c) => {
  const removed = await store.withdrawSuggestion(sql(), userId(c), c.req.valid("param").id)
  return removed ? c.body(null, 204) : c.json({ error: "no such open suggestion of yours" }, 404)
})

// ------------------------------------------------------------ proposals

const proposalRoute = createRoute({
  method: "post",
  path: "/feedback/proposals",
  tags: ["Feedback"],
  summary: "Propose a new term, flag a term as redundant or in need of a split, or suggest a change to a term's English metadata",
  description:
    "One endpoint, one payload shape per `kind`. Metadata kinds carry the hash of the English entry as rendered and are refused with 409 when it has changed. Requires a session cookie.",
  security,
  request: { body: { content: { "application/json": { schema: ProposalBodySchema } } } },
  responses: {
    201: { content: { "application/json": { schema: ProposalResponseSchema } }, description: "Recorded" },
    400: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "A referenced term does not exist" },
    ...errors,
  },
})

app.openapi(proposalRoute, async (c) => {
  const body = c.req.valid("json")
  if (!allow("feedback-proposals", userId(c), LIMITS.proposals, HOUR)) return c.json({ error: "too many proposals this hour" }, 429)
  const db = sql()
  const reason = body.reason?.trim() || null

  if (body.kind === "new_term") {
    const lang = body.payload.translation?.lang ?? body.lang ?? null
    if (lang && !SUPPORTED_LANGUAGES.includes(lang)) return c.json({ error: "unknown language" }, 404)
    if (resolveTerm(body.payload.term)) {
      return c.json({ error: `"${body.payload.term}" already resolves to an existing term; suggest a change to that term instead` }, 400)
    }
    const id = await store.addProposal(db, userId(c), "new_term", null, null, lang, body.payload, reason)
    return c.json({ id }, 201)
  }

  const term: GlossaryTerm | undefined = resolveTerm(body.termId)
  if (!term) return c.json({ error: "unknown term" }, 404)
  const currentHash = termHash(term)
  if ("hash" in body && body.hash && body.hash !== currentHash) return c.json({ error: "stale", current: currentHash }, 409)
  const version = await store.termVersionId(db, term.uid, currentHash)

  let payload: Record<string, unknown> = body.payload
  if (body.kind === "redundant") {
    const others = body.payload.with.map((ref) => ({ ref, term: resolveTerm(ref) }))
    const missing = others.filter((o) => !o.term).map((o) => o.ref)
    if (missing.length) return c.json({ error: `unknown term(s): ${missing.join(", ")}` }, 400)
    const distinct = others.filter((o) => o.term!.uid !== term.uid)
    if (!distinct.length) return c.json({ error: "a term cannot be redundant with itself" }, 400)
    payload = { with: distinct.map((o) => ({ uid: o.term!.uid, term: o.term!.term })) }
  }

  const id = await store.addProposal(db, userId(c), body.kind, term.uid, version, null, payload, reason)
  return c.json({ id }, 201)
})

const deleteProposalRoute = createRoute({
  method: "delete",
  path: "/feedback/proposals/{id}",
  tags: ["Feedback"],
  summary: "Withdraw one of your open proposals",
  security,
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Withdrawn" },
    401: errors[401],
    404: { content: { "application/json": { schema: FeedbackErrorSchema } }, description: "Not yours, not open, or not found" },
  },
})

app.openapi(deleteProposalRoute, async (c) => {
  const removed = await store.withdrawProposal(sql(), userId(c), c.req.valid("param").id)
  return removed ? c.body(null, 204) : c.json({ error: "no such open proposal of yours" }, 404)
})

export default app
