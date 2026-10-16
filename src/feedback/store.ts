/**
 * The feedback store: votes, suggestions, proposals, and the two derived
 * views the translate page needs (a reviewer's progress and a term's
 * history).
 *
 * Everything a reviewer says is anchored to the hash of the exact value they
 * saw. `slot_versions` and `term_versions` rows are created lazily, on the
 * first vote or suggestion against a value, so the tables grow with
 * engagement rather than with the glossary. Whether a row is *current* is
 * never read from here: the caller hashes the bundled glossary.
 *
 * Nothing in this module changes the glossary. It is a mailbox with
 * structure; maintainers read it with the scripts under scripts/.
 */

import { randomUUID } from "node:crypto"
import type { Sql } from "../db/client"
import type { ContextId } from "../lib/context-types"
import type { FieldId } from "../lib/hash"

export interface Tally {
  up: number
  down: number
}

export type Direction = 1 | -1

/** `context:hash`, the key both tallies and a reviewer's own votes are looked up by. */
export const slotKey = (context: string, hash: string) => `${context}:${hash}`

/**
 * NFC, trimmed, internal whitespace collapsed, case kept. What suggestions
 * are grouped on, so five people proposing the same string read as one
 * suggestion with five supporters.
 */
export function normalizeValue(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim()
}

// ------------------------------------------------------------- versions

export async function slotVersionId(
  sql: Sql,
  uid: string,
  lang: string,
  context: ContextId,
  hash: string,
  value: string
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO slot_versions (id, term_uid, lang, context, value_hash, value)
    VALUES (${randomUUID()}, ${uid}, ${lang}, ${context}, ${hash}, ${value})
    ON CONFLICT (term_uid, lang, context, value_hash) DO UPDATE SET value = slot_versions.value
    RETURNING id`
  return rows[0].id
}

export async function termVersionId(sql: Sql, uid: string, hash: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO term_versions (id, term_uid, fields_hash)
    VALUES (${randomUUID()}, ${uid}, ${hash})
    ON CONFLICT (term_uid, fields_hash) DO UPDATE SET fields_hash = term_versions.fields_hash
    RETURNING id`
  return rows[0].id
}

// ---------------------------------------------------------------- votes

/** One vote per person per slot value. `null` clears it. */
export async function setVote(sql: Sql, userId: string, slotVersion: string, direction: Direction | null): Promise<void> {
  if (direction === null) {
    await sql`DELETE FROM votes WHERE user_id = ${userId} AND slot_version_id = ${slotVersion}`
    return
  }
  await sql`
    INSERT INTO votes (user_id, slot_version_id, direction)
    VALUES (${userId}, ${slotVersion}, ${direction})
    ON CONFLICT (user_id, slot_version_id) DO UPDATE SET direction = EXCLUDED.direction, updated_at = now()`
}

/** Up and down counts for every version of every slot of one term in one language. */
export async function tallies(sql: Sql, uid: string, lang: string): Promise<Map<string, Tally>> {
  const rows = await sql<{ context: string; value_hash: string; up: number; down: number }[]>`
    SELECT sv.context, sv.value_hash,
           COUNT(*) FILTER (WHERE v.direction = 1)::int  AS up,
           COUNT(*) FILTER (WHERE v.direction = -1)::int AS down
    FROM votes v
    JOIN slot_versions sv ON sv.id = v.slot_version_id
    WHERE sv.term_uid = ${uid} AND sv.lang = ${lang}
    GROUP BY sv.context, sv.value_hash`
  return new Map(rows.map((r) => [slotKey(r.context, r.value_hash), { up: r.up, down: r.down }]))
}

/** The caller's own votes on one term in one language, by `context:hash`. */
export async function myVotes(sql: Sql, userId: string, uid: string, lang: string): Promise<Map<string, Direction>> {
  const rows = await sql<{ context: string; value_hash: string; direction: number }[]>`
    SELECT sv.context, sv.value_hash, v.direction
    FROM votes v
    JOIN slot_versions sv ON sv.id = v.slot_version_id
    WHERE v.user_id = ${userId} AND sv.term_uid = ${uid} AND sv.lang = ${lang}`
  return new Map(rows.map((r) => [slotKey(r.context, r.value_hash), r.direction as Direction]))
}

/**
 * Every `uid:context:hash` the caller has voted on or suggested against in
 * one language. The progress mark for a term is derived from this against
 * the hashes of what is live, so a slot that changed under the reviewer
 * drops out on its own. A suggestion counts whatever the maintainers said
 * about it; only withdrawing it un-reviews the slot.
 *
 * Written user-first (the votes primary key and the suggestions user index
 * lead), as a union, so it never scans slot_versions.
 */
export async function coveredSlots(sql: Sql, userId: string, lang: string): Promise<Set<string>> {
  const rows = await sql<{ term_uid: string; context: string; value_hash: string }[]>`
    SELECT sv.term_uid, sv.context, sv.value_hash
    FROM votes v JOIN slot_versions sv ON sv.id = v.slot_version_id
    WHERE v.user_id = ${userId} AND sv.lang = ${lang}
    UNION
    SELECT sv.term_uid, sv.context, sv.value_hash
    FROM suggestions s JOIN slot_versions sv ON sv.id = s.slot_version_id
    WHERE s.user_id = ${userId} AND sv.lang = ${lang} AND s.status <> 'withdrawn'`
  return new Set(rows.map((r) => `${r.term_uid}:${r.context}:${r.value_hash}`))
}

// ------------------------------------------- English fields (style guide)

/** `field:hash`, the key field tallies and a reader's own field votes are looked up by. */
export const fieldKey = (field: string, hash: string) => `${field}:${hash}`

export async function fieldVersionId(sql: Sql, uid: string, field: FieldId, hash: string, value: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO field_versions (id, term_uid, field, value_hash, value)
    VALUES (${randomUUID()}, ${uid}, ${field}, ${hash}, ${value})
    ON CONFLICT (term_uid, field, value_hash) DO UPDATE SET value = field_versions.value
    RETURNING id`
  return rows[0].id
}

export async function setFieldVote(sql: Sql, userId: string, fieldVersion: string, direction: Direction | null): Promise<void> {
  if (direction === null) {
    await sql`DELETE FROM field_votes WHERE user_id = ${userId} AND field_version_id = ${fieldVersion}`
    return
  }
  await sql`
    INSERT INTO field_votes (user_id, field_version_id, direction)
    VALUES (${userId}, ${fieldVersion}, ${direction})
    ON CONFLICT (user_id, field_version_id) DO UPDATE SET direction = EXCLUDED.direction, updated_at = now()`
}

/** Up and down counts for every version of every English field of one term. */
export async function fieldTallies(sql: Sql, uid: string): Promise<Map<string, Tally>> {
  const rows = await sql<{ field: string; value_hash: string; up: number; down: number }[]>`
    SELECT fv.field, fv.value_hash,
           COUNT(*) FILTER (WHERE v.direction = 1)::int  AS up,
           COUNT(*) FILTER (WHERE v.direction = -1)::int AS down
    FROM field_votes v
    JOIN field_versions fv ON fv.id = v.field_version_id
    WHERE fv.term_uid = ${uid}
    GROUP BY fv.field, fv.value_hash`
  return new Map(rows.map((r) => [fieldKey(r.field, r.value_hash), { up: r.up, down: r.down }]))
}

export async function myFieldVotes(sql: Sql, userId: string, uid: string): Promise<Map<string, Direction>> {
  const rows = await sql<{ field: string; value_hash: string; direction: number }[]>`
    SELECT fv.field, fv.value_hash, v.direction
    FROM field_votes v
    JOIN field_versions fv ON fv.id = v.field_version_id
    WHERE v.user_id = ${userId} AND fv.term_uid = ${uid}`
  return new Map(rows.map((r) => [fieldKey(r.field, r.value_hash), r.direction as Direction]))
}

// ---------------------------------------------------------- suggestions

export interface Suggestion {
  id: string
  context: ContextId
  hash: string
  value: string
  reason: string | null
  created_at: Date
}

/**
 * Record "this slot should read X". The unique index on (user, slot
 * version, normalized value) makes a second identical suggestion from the
 * same person a no-op that reports `duplicate` -- unless they had withdrawn
 * it, in which case the same row reopens as if new.
 */
export async function addSuggestion(
  sql: Sql,
  userId: string,
  slotVersion: string,
  value: string,
  reason: string | null
): Promise<{ id: string; duplicate: boolean }> {
  const normalized = normalizeValue(value)
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO suggestions (id, user_id, slot_version_id, value, normalized_value, reason)
    VALUES (${randomUUID()}, ${userId}, ${slotVersion}, ${value.trim()}, ${normalized}, ${reason})
    ON CONFLICT (user_id, slot_version_id, normalized_value) DO NOTHING
    RETURNING id`
  if (inserted[0]) return { id: inserted[0].id, duplicate: false }
  const [existing] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM suggestions
    WHERE user_id = ${userId} AND slot_version_id = ${slotVersion} AND normalized_value = ${normalized}`
  if (existing.status !== "withdrawn") return { id: existing.id, duplicate: true }
  await sql`
    UPDATE suggestions
    SET status = 'open', value = ${value.trim()}, reason = ${reason}, created_at = now(), resolved_at = NULL, resolution_note = NULL
    WHERE id = ${existing.id}`
  return { id: existing.id, duplicate: false }
}

/** The caller's own open suggestions on one term in one language. Nobody else's, ever. */
export async function mySuggestions(sql: Sql, userId: string, uid: string, lang: string): Promise<Suggestion[]> {
  return sql<Suggestion[]>`
    SELECT s.id, sv.context, sv.value_hash AS hash, s.value, s.reason, s.created_at
    FROM suggestions s
    JOIN slot_versions sv ON sv.id = s.slot_version_id
    WHERE s.user_id = ${userId} AND sv.term_uid = ${uid} AND sv.lang = ${lang} AND s.status = 'open'
    ORDER BY s.created_at`
}

/**
 * Withdraw one of your own open suggestions. The row stays, marked, so the
 * author can see it and re-suggesting reopens it. False when nothing was open.
 */
export async function withdrawSuggestion(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE suggestions SET status = 'withdrawn', resolved_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'open' RETURNING id`
  return rows.length > 0
}

// ------------------------------------------------------------ proposals

export type ProposalKind =
  | "new_term"
  | "redundant"
  | "split"
  | "definition"
  | "references"
  | "avoid"
  | "casing"
  | "alias"
  | "note"
  | "category"
  | "script_rule"

export interface Proposal {
  id: string
  kind: ProposalKind
  term_uid: string | null
  lang: string | null
  payload: Record<string, unknown>
  reason: string | null
  created_at: Date
}

export async function addProposal(
  sql: Sql,
  userId: string,
  kind: ProposalKind,
  uid: string | null,
  termVersion: string | null,
  lang: string | null,
  payload: Record<string, unknown>,
  reason: string | null
): Promise<string> {
  const id = randomUUID()
  await sql`
    INSERT INTO proposals (id, user_id, kind, term_uid, term_version_id, lang, payload, reason)
    VALUES (${id}, ${userId}, ${kind}, ${uid}, ${termVersion}, ${lang}, ${sql.json(payload as never)}, ${reason})`
  return id
}

/**
 * The caller's own open proposals about one term: flags and metadata. A
 * new-term proposal is about no existing term, so it is listed on the
 * account page instead.
 */
export async function myProposals(sql: Sql, userId: string, uid: string): Promise<Proposal[]> {
  return sql<Proposal[]>`
    SELECT id, kind, term_uid, lang, payload, reason, created_at
    FROM proposals
    WHERE user_id = ${userId} AND status = 'open' AND term_uid = ${uid}
    ORDER BY created_at`
}

export async function withdrawProposal(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE proposals SET status = 'withdrawn', resolved_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'open' RETURNING id`
  return rows.length > 0
}

// ---------------------------------------------------------------- reopen

/** A withdrawn suggestion of the caller's, with what it was anchored to, so the route can check it is still live. */
export async function withdrawnSuggestion(sql: Sql, userId: string, id: string) {
  const [row] = await sql<{ id: string; term_uid: string; lang: string; context: ContextId; hash: string }[]>`
    SELECT s.id, sv.term_uid, sv.lang, sv.context, sv.value_hash AS hash
    FROM suggestions s JOIN slot_versions sv ON sv.id = s.slot_version_id
    WHERE s.id = ${id} AND s.user_id = ${userId} AND s.status = 'withdrawn'`
  return row ?? null
}

/** Back to open, as if newly made. */
export async function reopenSuggestion(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE suggestions SET status = 'open', created_at = now(), resolved_at = NULL, resolution_note = NULL
    WHERE id = ${id} AND user_id = ${userId} AND status = 'withdrawn' RETURNING id`
  return rows.length > 0
}

export async function withdrawnProposal(sql: Sql, userId: string, id: string) {
  const [row] = await sql<{ id: string; kind: ProposalKind; term_uid: string | null; fields_hash: string | null }[]>`
    SELECT p.id, p.kind, p.term_uid, tv.fields_hash
    FROM proposals p LEFT JOIN term_versions tv ON tv.id = p.term_version_id
    WHERE p.id = ${id} AND p.user_id = ${userId} AND p.status = 'withdrawn'`
  return row ?? null
}

export async function reopenProposal(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE proposals SET status = 'open', created_at = now(), resolved_at = NULL, resolution_note = NULL
    WHERE id = ${id} AND user_id = ${userId} AND status = 'withdrawn' RETURNING id`
  return rows.length > 0
}

// ------------------------------------------------- the account page's view

export type FeedbackStatus = "open" | "accepted" | "declined" | "withdrawn"

export interface OwnSuggestion extends Suggestion {
  lang: string
  term_uid: string
  status: FeedbackStatus
  resolved_at: Date | null
  resolution_note: string | null
}

/** Everything the caller has suggested, in every language and every status, newest first. */
export async function allMySuggestions(sql: Sql, userId: string): Promise<OwnSuggestion[]> {
  return sql<OwnSuggestion[]>`
    SELECT s.id, sv.lang, sv.term_uid, sv.context, sv.value_hash AS hash, s.value, s.reason,
           s.status, s.created_at, s.resolved_at, s.resolution_note
    FROM suggestions s
    JOIN slot_versions sv ON sv.id = s.slot_version_id
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC`
}

export interface OwnProposal extends Proposal {
  status: FeedbackStatus
  resolved_at: Date | null
  resolution_note: string | null
}

export async function allMyProposals(sql: Sql, userId: string): Promise<OwnProposal[]> {
  return sql<OwnProposal[]>`
    SELECT id, kind, term_uid, lang, payload, reason, status, created_at, resolved_at, resolution_note
    FROM proposals
    WHERE user_id = ${userId}
    ORDER BY created_at DESC`
}

/** coveredSlots() for every language at once: lang -> `uid:context:hash`. */
export async function coverageByLanguage(sql: Sql, userId: string): Promise<Map<string, Set<string>>> {
  const rows = await sql<{ lang: string; term_uid: string; context: string; value_hash: string }[]>`
    SELECT sv.lang, sv.term_uid, sv.context, sv.value_hash
    FROM votes v JOIN slot_versions sv ON sv.id = v.slot_version_id
    WHERE v.user_id = ${userId}
    UNION
    SELECT sv.lang, sv.term_uid, sv.context, sv.value_hash
    FROM suggestions s JOIN slot_versions sv ON sv.id = s.slot_version_id
    WHERE s.user_id = ${userId} AND s.status <> 'withdrawn'`
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    let set = out.get(r.lang)
    if (!set) out.set(r.lang, (set = new Set()))
    set.add(`${r.term_uid}:${r.context}:${r.value_hash}`)
  }
  return out
}

// -------------------------------------------------------------- history

export interface HistoryEntry {
  /** ISO date of the deploy that made the change. */
  date: string
  kind: string
  context: string | null
  old_value: string | null
  new_value: string | null
}

/**
 * What changed about one term, in one language plus the English entry,
 * newest first. This is what the Versions rail renders; it comes from the
 * startup indexer and nothing else writes it.
 */
/**
 * The day the indexer first recorded the glossary: the baseline every history
 * starts from. Null before the first run; constant afterwards, so it is read
 * once per process.
 */
let sinceCache: string | null = null
export async function historySince(sql: Sql): Promise<string | null> {
  if (sinceCache) return sinceCache
  const [row] = await sql<{ since: Date | null }[]>`SELECT min(deployed_at) AS since FROM glossary_snapshots`
  sinceCache = row?.since ? row.since.toISOString().slice(0, 10) : null
  return sinceCache
}

export async function history(sql: Sql, uid: string, lang: string, limit = 50): Promise<HistoryEntry[]> {
  const rows = await sql<{ date: Date; kind: string; context: string | null; old_value: string | null; new_value: string | null }[]>`
    SELECT gs.deployed_at AS date, tc.kind, tc.context, tc.old_value, tc.new_value
    FROM term_changes tc
    JOIN glossary_snapshots gs ON gs.id = tc.snapshot_id
    WHERE tc.term_uid = ${uid} AND (tc.lang = ${lang} OR tc.lang IS NULL)
    ORDER BY gs.deployed_at DESC, tc.context NULLS FIRST
    LIMIT ${limit}`
  return rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }))
}
