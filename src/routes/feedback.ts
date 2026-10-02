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
import { HTTPException } from "hono/http-exception"
import type { z } from "@hono/zod-openapi"
import { getDb } from "../db/client"
import type { Sql } from "../db/client"
import { getTerms, loadTranslations, resolveTerm, SUPPORTED_LANGUAGES } from "../lib/glossary-data"
import type { GlossaryTerm } from "../lib/glossary-data"
import { applicableContexts, slotValue } from "../lib/context-types"
import { fieldHash, fieldValue, slotHash, termHash } from "../lib/hash"
import { requestOrigin } from "../lib/request-origin"
import { allow } from "../auth/ratelimit"
import type { AppEnv } from "../auth/session"
import { LangParamSchema, TermIdParamSchema } from "../schemas/common"
import {
  FieldVotesBodySchema,
  FieldVotesResponseSchema,
  ProposalBatchBodySchema,
  ProposalBatchResponseSchema,
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

/*
 * Validation failures answer in FeedbackErrorSchema's shape -- one line a
 * person can read -- rather than the validator's default dump of the whole
 * ZodError, which the islands cannot show.
 */
const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (result.success) return
    const issue = result.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
    return c.json({ error: `${where}${issue?.message ?? "invalid request"}` }, 400)
  },
})

/*
 * A database that fails mid-request (a failover, a restart) surfaces here as
 * a thrown query. Answer 503 in the shape the islands expect, log the
 * message only. HTTPExceptions (the body limit's 413) keep their own answer.
 */
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error("feedback:", err instanceof Error ? err.message : err)
  return c.json({ error: "accounts are temporarily unavailable" }, 503)
})

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
// Room for the largest valid body: a split with ten terms, each with a definition, plus a reason.
app.use("/feedback/*", bodyLimit({ maxSize: 32 * 1024 }))

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
const err = (description: string) => ({ content: { "application/json": { schema: FeedbackErrorSchema } }, description })
/** What every write can answer, from the guard and the validator. Routes add their own 400 where it means something more specific. */
const errors = {
  401: err("Not signed in"),
  403: err("Cross-origin request"),
  404: err("Unknown term or language"),
  409: err("The value changed since the page loaded; reload"),
  415: err("Body is not application/json"),
  429: err("Too many writes; wait"),
  503: err("Database unavailable"),
}
const invalid = { 400: err("Invalid request body") }

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
    ...invalid,
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

// ------------------------------------------- the English definition

const fieldVotesRoute = createRoute({
  method: "put",
  path: "/feedback/style-guide/{termId}/votes",
  tags: ["Feedback"],
  summary: "Vote on a term's English definition",
  description:
    "The style-guide counterpart of translation votes: one vote per person per version of the field. Each item carries the hash of the field as rendered; a stale hash is refused with 409. Requires a session cookie.",
  security,
  request: {
    params: TermIdParamSchema,
    body: { content: { "application/json": { schema: FieldVotesBodySchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: FieldVotesResponseSchema } }, description: "Current tallies for the fields voted on" },
    ...invalid,
    ...errors,
  },
})

app.openapi(fieldVotesRoute, async (c) => {
  const { termId } = c.req.valid("param")
  const { votes } = c.req.valid("json")
  const term = resolveTerm(termId)
  if (!term) return c.json({ error: "unknown term" }, 404)
  if (!allow("feedback-votes", userId(c), LIMITS.votes, HOUR)) return c.json({ error: "too many votes this hour" }, 429)

  for (const v of votes) {
    const current = fieldHash(term, v.field)
    if (!current) return c.json({ error: `this term has no ${v.field}`, field: v.field }, 404)
    if (current !== v.hash) return c.json({ error: "stale", field: v.field, current }, 409)
  }
  const db = sql()
  for (const v of votes) {
    const version = await store.fieldVersionId(db, term.uid, v.field, v.hash, fieldValue(term, v.field) as string)
    await store.setFieldVote(db, userId(c), version, v.direction === "up" ? 1 : v.direction === "down" ? -1 : null)
  }

  const tallies = await store.fieldTallies(db, term.uid)
  const mine = await store.myFieldVotes(db, userId(c), term.uid)
  return c.json(
    {
      ok: true as const,
      tallies: votes.map((v) => {
        const key = store.fieldKey(v.field, v.hash)
        const t = tallies.get(key) ?? { up: 0, down: 0 }
        const m = mine.get(key)
        return { field: v.field, hash: v.hash, up: t.up, down: t.down, mine: m === 1 ? ("up" as const) : m === -1 ? ("down" as const) : null }
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
  if (body.context !== "plurals" && value.length > 200) {
    return c.json({ error: "value: a translation is at most 200 characters" }, 400)
  }
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

/*
 * Re-submitting a withdrawn item reopens the same row, but only while what
 * it was about is still live: a suggestion against a translation that has
 * since changed, or a proposal against an entry that has, is refused with
 * 409 so the reader looks at the new text and suggests afresh.
 */
const reopenSuggestionRoute = createRoute({
  method: "post",
  path: "/feedback/suggestions/{id}/reopen",
  tags: ["Feedback"],
  summary: "Re-submit one of your withdrawn suggestions",
  security,
  request: { params: IdParamSchema },
  responses: { 204: { description: "Open again" }, ...invalid, ...errors, 404: err("No such withdrawn suggestion of yours") },
})

app.openapi(reopenSuggestionRoute, async (c) => {
  const db = sql()
  const row = await store.withdrawnSuggestion(db, userId(c), c.req.valid("param").id)
  if (!row) return c.json({ error: "no such withdrawn suggestion of yours" }, 404)
  const found = Object.entries(getTerms()).find(([, t]) => t.uid === row.term_uid)
  const entry = found ? (await loadTranslations(row.lang))[found[0]] : undefined
  if (!entry || slotHash(entry, row.context) !== row.hash) {
    return c.json({ error: "the translation has changed since; suggest it afresh", context: row.context }, 409)
  }
  if (!allow("feedback-suggestions", userId(c), LIMITS.suggestions, HOUR)) return c.json({ error: "too many suggestions this hour" }, 429)
  const reopened = await store.reopenSuggestion(db, userId(c), row.id)
  return reopened ? c.body(null, 204) : c.json({ error: "no such withdrawn suggestion of yours" }, 404)
})

const reopenProposalRoute = createRoute({
  method: "post",
  path: "/feedback/proposals/{id}/reopen",
  tags: ["Feedback"],
  summary: "Re-submit one of your withdrawn proposals",
  security,
  request: { params: IdParamSchema },
  responses: { 204: { description: "Open again" }, ...invalid, ...errors, 404: err("No such withdrawn proposal of yours") },
})

app.openapi(reopenProposalRoute, async (c) => {
  const db = sql()
  const row = await store.withdrawnProposal(db, userId(c), c.req.valid("param").id)
  if (!row) return c.json({ error: "no such withdrawn proposal of yours" }, 404)
  if (row.term_uid) {
    const term = Object.values(getTerms()).find((t) => t.uid === row.term_uid)
    if (!term) return c.json({ error: "that term is no longer in the glossary" }, 409)
    if (row.fields_hash && termHash(term) !== row.fields_hash) {
      return c.json({ error: "the entry has changed since; suggest it afresh", current: termHash(term) }, 409)
    }
  }
  if (!allow("feedback-proposals", userId(c), LIMITS.proposals, HOUR)) return c.json({ error: "too many proposals this hour" }, 429)
  const reopened = await store.reopenProposal(db, userId(c), row.id)
  return reopened ? c.body(null, 204) : c.json({ error: "no such withdrawn proposal of yours" }, 404)
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

type ProposalBody = z.infer<typeof ProposalBodySchema>
type Refusal = { status: 400 | 404 | 409; body: { error: string; current?: string } }
type Checked = { kind: ProposalBody["kind"]; term: GlossaryTerm | null; hash: string | null; lang: string | null; payload: Record<string, unknown>; reason: string | null }

/** Validate one proposal against the live glossary and shape its row. Pure: nothing is written. */
function checkProposal(body: ProposalBody): Checked | Refusal {
  const reason = body.reason?.trim() || null
  if (body.kind === "new_term") {
    const lang = body.payload.translation?.lang ?? body.lang ?? null
    if (lang && !SUPPORTED_LANGUAGES.includes(lang)) return { status: 404, body: { error: "unknown language" } }
    if (resolveTerm(body.payload.term)) {
      return { status: 400, body: { error: `"${body.payload.term}" already resolves to an existing term; suggest a change to that term instead` } }
    }
    return { kind: body.kind, term: null, hash: null, lang, payload: body.payload, reason }
  }
  const term = resolveTerm(body.termId)
  if (!term) return { status: 404, body: { error: "unknown term" } }
  const currentHash = termHash(term)
  if ("hash" in body && body.hash && body.hash !== currentHash) return { status: 409, body: { error: "stale", current: currentHash } }
  let payload: Record<string, unknown> = body.payload
  if (body.kind === "redundant") {
    const others = body.payload.with.map((ref) => ({ ref, term: resolveTerm(ref) }))
    const missing = others.filter((o) => !o.term).map((o) => o.ref)
    if (missing.length) return { status: 400, body: { error: `unknown term(s): ${missing.join(", ")}` } }
    const distinct = others.filter((o) => o.term!.uid !== term.uid)
    if (!distinct.length) return { status: 400, body: { error: "a term cannot be redundant with itself" } }
    payload = { with: distinct.map((o) => ({ uid: o.term!.uid, term: o.term!.term })) }
  }
  return { kind: body.kind, term, hash: currentHash, lang: null, payload, reason }
}
const refused = (x: Checked | Refusal): x is Refusal => "status" in x

async function insertProposal(db: Sql, user: string, p: Checked): Promise<string> {
  const version = p.term && p.hash ? await store.termVersionId(db, p.term.uid, p.hash) : null
  return store.addProposal(db, user, p.kind, p.term?.uid ?? null, version, p.lang, p.payload, p.reason)
}

app.openapi(proposalRoute, async (c) => {
  const checked = checkProposal(c.req.valid("json"))
  if (refused(checked)) return c.json(checked.body, checked.status)
  if (!allow("feedback-proposals", userId(c), LIMITS.proposals, HOUR)) return c.json({ error: "too many proposals this hour" }, 429)
  const id = await insertProposal(sql(), userId(c), checked)
  return c.json({ id }, 201)
})

/*
 * "Suggest changes" sends one proposal per field that changed. They land
 * together or not at all, so a refusal in the middle cannot leave half a
 * form recorded and the rest to be re-sent (and duplicated) on retry.
 */
const proposalBatchRoute = createRoute({
  method: "post",
  path: "/feedback/proposals/batch",
  tags: ["Feedback"],
  summary: "Record several proposals in one transaction",
  description:
    "Every item is checked first; any refusal answers for the whole batch and nothing is recorded. Counts against the proposals limit once per item. Requires a session cookie.",
  security,
  request: { body: { content: { "application/json": { schema: ProposalBatchBodySchema } } } },
  responses: {
    201: { content: { "application/json": { schema: ProposalBatchResponseSchema } }, description: "Recorded, ids in request order" },
    400: err("A referenced term does not exist, or an item is invalid"),
    ...errors,
  },
})

app.openapi(proposalBatchRoute, async (c) => {
  const items = c.req.valid("json").proposals.map(checkProposal)
  const bad = items.find(refused)
  if (bad) return c.json(bad.body, bad.status)
  for (const _ of items) {
    if (!allow("feedback-proposals", userId(c), LIMITS.proposals, HOUR)) return c.json({ error: "too many proposals this hour" }, 429)
  }
  const ids = await sql().begin(async (tx) => {
    const out: string[] = []
    for (const p of items as Checked[]) out.push(await insertProposal(tx as unknown as Sql, userId(c), p))
    return out
  })
  return c.json({ ids: ids as string[] }, 201)
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
