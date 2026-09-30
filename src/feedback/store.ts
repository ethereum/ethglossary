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
 * drops out on its own.
 */
export async function coveredSlots(sql: Sql, userId: string, lang: string): Promise<Set<string>> {
  const rows = await sql<{ term_uid: string; context: string; value_hash: string }[]>`
    SELECT DISTINCT sv.term_uid, sv.context, sv.value_hash
    FROM slot_versions sv
    WHERE sv.lang = ${lang} AND (
      EXISTS (SELECT 1 FROM votes v WHERE v.slot_version_id = sv.id AND v.user_id = ${userId})
      OR EXISTS (SELECT 1 FROM suggestions s WHERE s.slot_version_id = sv.id AND s.user_id = ${userId} AND s.status = 'open')
    )`
  return new Set(rows.map((r) => `${r.term_uid}:${r.context}:${r.value_hash}`))
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
 * same person a no-op that reports `duplicate`.
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
    VALUES (${randomUUID()}, ${userId}, ${slotVersion}, ${normalized}, ${normalized}, ${reason})
    ON CONFLICT (user_id, slot_version_id, normalized_value) DO NOTHING
    RETURNING id`
  if (inserted[0]) return { id: inserted[0].id, duplicate: false }
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM suggestions
    WHERE user_id = ${userId} AND slot_version_id = ${slotVersion} AND normalized_value = ${normalized}`
  return { id: existing[0].id, duplicate: true }
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

/** Withdraw one of your own open suggestions. False when there was nothing to remove. */
export async function removeSuggestion(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM suggestions WHERE id = ${id} AND user_id = ${userId} AND status = 'open' RETURNING id`
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

/** The caller's own open proposals about one term (flags, metadata), plus their new-term proposals for the language. */
export async function myProposals(sql: Sql, userId: string, uid: string, lang: string): Promise<Proposal[]> {
  return sql<Proposal[]>`
    SELECT id, kind, term_uid, lang, payload, reason, created_at
    FROM proposals
    WHERE user_id = ${userId} AND status = 'open'
      AND (term_uid = ${uid} OR (kind = 'new_term' AND lang = ${lang}))
    ORDER BY created_at`
}

export async function removeProposal(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM proposals WHERE id = ${id} AND user_id = ${userId} AND status = 'open' RETURNING id`
  return rows.length > 0
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
