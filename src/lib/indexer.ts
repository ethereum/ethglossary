/**
 * Glossary change indexer.
 *
 * Every image carries one fixed glossary. At startup the indexer hashes the
 * bundled data, compares it with what the database recorded last time, and
 * writes one term_changes row per slot or term that differs. That is what
 * the Versions rail renders, and it is how a reviewer's progress mark is
 * allowed to go stale honestly.
 *
 * The comparison is always against the recorded state, never against a build
 * identifier. Redeploying an older image therefore records the rollback as
 * the change it is, instead of being skipped as "already indexed" while the
 * database keeps describing the newer build. A boot that finds nothing
 * different writes nothing.
 *
 * Hashing happens before the transaction opens; the transaction only reads
 * state, diffs, and writes, under an advisory lock with bounded waits, so
 * several replicas booting together produce one snapshot between them and a
 * managed cluster's idle-in-transaction timeout has nothing to object to.
 *
 * The first run ever records the current state and emits no change rows.
 * History starts at the first indexed deploy by design.
 *
 * Known limitation: the indexer cannot tell a deliberate rollback from an
 * old-image pod that restarts during a partial rollout. Both boot content
 * that differs from the recorded state, and both are recorded. The result
 * is a pair of inverse snapshots minutes apart; the Versions rail should
 * collapse such pairs rather than show them, and nothing on the request path
 * is affected either way.
 *
 * Nothing on the request path reads the tables this writes. Whether a vote
 * is about the live value is always decided by hashing the bundled data, so
 * a late or failed index run can never make the site wrong.
 */

import { randomUUID } from "node:crypto"
import { getTerms, loadTranslations, SUPPORTED_LANGUAGES } from "./glossary-data"
import { canonicalJson, sha256Hex32, slotDigest, termFields, termHash } from "./hash"
import type { Sql } from "../db/client"

export interface BuildInfo {
  /** Git SHA of the image in production; a content hash in development. Informational. */
  versionId: string
  gitSha: string | null
  deployedAt: Date
}

export type IndexerResult =
  | { status: "noop" }
  | { status: "indexed"; first: boolean; changes: number }

/** Arbitrary constant; only has to differ from the migration lock. */
const LOCK_KEY = 0x696e6478 // "indx"

/** Rows per bulk statement; keeps each parameter array a modest size. */
const CHUNK = 2000

interface TermRow {
  uid: string
  term: string
  hash: string
  fields: Record<string, unknown>
}

interface EntryRow {
  uid: string
  lang: string
  hashes: Record<string, string>
  values: Record<string, string>
}

interface ChangeRow {
  id: string
  term_uid: string
  lang: string | null
  context: string | null
  kind: string
  old_value: string | null
  new_value: string | null
}

interface StoredTerm {
  term_uid: string
  fields_hash: string
  term: string
}

interface StoredEntry {
  term_uid: string
  lang: string
  slot_hashes: Record<string, string>
  slot_values: Record<string, string>
}

/** Identify the running build for the record. Correctness never depends on it. */
export async function describeBuild(env: NodeJS.ProcessEnv = process.env): Promise<BuildInfo> {
  const gitSha = env.GIT_SHA?.trim() || null
  if (gitSha) return { versionId: gitSha, gitSha, deployedAt: new Date() }

  const parts = [JSON.stringify(getTerms())]
  for (const lang of SUPPORTED_LANGUAGES) parts.push(JSON.stringify(await loadTranslations(lang)))
  return { versionId: `dev-${sha256Hex32(parts.join("\n"))}`, gitSha: null, deployedAt: new Date() }
}

/**
 * Hash the bundled glossary. Pure, and run before any transaction is opened.
 *
 * A supported language whose file comes back empty aborts the whole pass:
 * `loadTranslations` returns `{}` on any failure, and treating that as "every
 * entry was removed" would write thousands of false history rows.
 */
export async function computeGlossaryState(): Promise<{ terms: TermRow[]; entries: EntryRow[] }> {
  const master = getTerms()
  const terms: TermRow[] = Object.values(master).map((t) => ({
    uid: t.uid,
    term: t.term,
    hash: termHash(t),
    fields: termFields(t),
  }))

  const entries: EntryRow[] = []
  for (const lang of SUPPORTED_LANGUAGES) {
    const translations = await loadTranslations(lang)
    if (Object.keys(translations).length === 0) {
      throw new Error(`translation file for "${lang}" is empty or failed to load; aborting the index pass`)
    }
    // Translation files are keyed by canonical name, never by id or uid.
    for (const [key, term] of Object.entries(master)) {
      const entry = translations[key]
      if (!entry) continue
      const { hashes, values } = slotDigest(entry)
      entries.push({ uid: term.uid, lang, hashes, values })
    }
  }
  return { terms, entries }
}

export async function runIndexer(sql: Sql, build: BuildInfo): Promise<IndexerResult> {
  const current = await computeGlossaryState()

  return sql.begin(async (tx): Promise<IndexerResult> => {
    await tx.unsafe("SET LOCAL lock_timeout = '60s'")
    await tx.unsafe("SET LOCAL statement_timeout = '300s'")
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`

    const storedTerms = await tx<StoredTerm[]>`SELECT term_uid, fields_hash, term FROM term_state`
    const storedEntries = await tx<StoredEntry[]>`
      SELECT term_uid, lang, slot_hashes, slot_values FROM entry_state`
    const firstRun = storedTerms.length === 0 && storedEntries.length === 0

    const changes: ChangeRow[] = []
    const change = (
      uid: string,
      lang: string | null,
      context: string | null,
      kind: string,
      oldValue: string | null,
      newValue: string | null
    ) =>
      changes.push({
        id: randomUUID(),
        term_uid: uid,
        lang,
        context,
        kind,
        old_value: oldValue,
        new_value: newValue,
      })

    // ------------------------------------------------------------ master
    const prevTerms = new Map(storedTerms.map((r) => [r.term_uid, r]))
    const dirtyTerms: TermRow[] = []
    /** (uid, hash): `hash` is the live version of this term, every other one is not. "" retires all. */
    const supersededTerms: Array<[string, string]> = []

    for (const t of current.terms) {
      const prev = prevTerms.get(t.uid)
      prevTerms.delete(t.uid)
      if (firstRun) {
        dirtyTerms.push(t)
        continue
      }
      if (!prev) {
        change(t.uid, null, null, "term_added", null, t.term)
        dirtyTerms.push(t)
        // A term that was removed and comes back has versions on file: the
        // one matching the current hash is live again.
        supersededTerms.push([t.uid, t.hash])
        continue
      }
      if (prev.fields_hash === t.hash) continue

      // A rename changes the hash by itself. Re-hash with the old name to
      // learn whether anything besides the name moved, so a rename and an
      // edit in one deploy leave two rows, not one.
      const renamed = prev.term !== t.term
      const bodyChanged =
        !renamed || sha256Hex32(canonicalJson({ ...t.fields, term: prev.term })) !== prev.fields_hash
      if (renamed) change(t.uid, null, null, "term_renamed", prev.term, t.term)
      if (bodyChanged) change(t.uid, null, null, "term_changed", null, null)
      dirtyTerms.push(t)
      supersededTerms.push([t.uid, t.hash])
    }
    const goneTerms = [...prevTerms.values()]
    for (const gone of goneTerms) {
      change(gone.term_uid, null, null, "term_removed", gone.term, null)
      supersededTerms.push([gone.term_uid, ""])
    }

    // --------------------------------------------------------- languages
    const entryKey = (lang: string, uid: string) => `${lang}::${uid}`
    const prevEntries = new Map(storedEntries.map((r) => [entryKey(r.lang, r.term_uid), r]))
    const dirtyEntries: EntryRow[] = []
    /** (uid, lang, context, hash): `hash` is the live version of the slot, every other one is not. "" retires all. */
    const supersededSlots: Array<[string, string, string, string]> = []

    for (const e of current.entries) {
      const k = entryKey(e.lang, e.uid)
      const prev = prevEntries.get(k)
      prevEntries.delete(k)
      if (firstRun) {
        dirtyEntries.push(e)
        continue
      }
      const prevHashes = prev?.slot_hashes ?? {}
      const prevValues = prev?.slot_values ?? {}
      let dirty = !prev
      for (const context of Object.keys(e.hashes)) {
        if (!(context in prevHashes)) {
          change(e.uid, e.lang, context, "slot_added", null, e.values[context])
          supersededSlots.push([e.uid, e.lang, context, e.hashes[context]])
          dirty = true
        } else if (prevHashes[context] !== e.hashes[context]) {
          change(e.uid, e.lang, context, "slot_changed", prevValues[context] ?? null, e.values[context])
          supersededSlots.push([e.uid, e.lang, context, e.hashes[context]])
          dirty = true
        }
      }
      for (const context of Object.keys(prevHashes)) {
        if (!(context in e.hashes)) {
          change(e.uid, e.lang, context, "slot_removed", prevValues[context] ?? null, null)
          supersededSlots.push([e.uid, e.lang, context, ""])
          dirty = true
        }
      }
      if (dirty) dirtyEntries.push(e)
    }
    const goneEntries = [...prevEntries.values()]
    for (const gone of goneEntries) {
      for (const [context, value] of Object.entries(gone.slot_values)) {
        change(gone.term_uid, gone.lang, context, "slot_removed", value, null)
        supersededSlots.push([gone.term_uid, gone.lang, context, ""])
      }
    }

    if (!firstRun && changes.length === 0) return { status: "noop" }

    // -------------------------------------------------------------- write
    const snapshotId = randomUUID()
    await tx`
      INSERT INTO glossary_snapshots (id, version_id, git_sha, deployed_at, term_count, change_count)
      VALUES (${snapshotId}, ${build.versionId}, ${build.gitSha}, ${build.deployedAt},
              ${current.terms.length}, ${changes.length})`

    for (const rows of chunks(dirtyTerms)) {
      await tx`
        INSERT INTO term_state (term_uid, snapshot_id, fields_hash, term)
        SELECT u, ${snapshotId}, h, t
        FROM unnest(${rows.map((r) => r.uid)}::text[],
                    ${rows.map((r) => r.hash)}::text[],
                    ${rows.map((r) => r.term)}::text[]) AS x(u, h, t)
        ON CONFLICT (term_uid) DO UPDATE
          SET snapshot_id = EXCLUDED.snapshot_id, fields_hash = EXCLUDED.fields_hash, term = EXCLUDED.term`
    }
    if (goneTerms.length) {
      await tx`DELETE FROM term_state WHERE term_uid = ANY(${goneTerms.map((g) => g.term_uid)}::text[])`
    }
    for (const rows of chunks(dirtyEntries)) {
      await tx`
        INSERT INTO entry_state (term_uid, lang, snapshot_id, slot_hashes, slot_values)
        SELECT u, l, ${snapshotId}, h::jsonb, v::jsonb
        FROM unnest(${rows.map((r) => r.uid)}::text[],
                    ${rows.map((r) => r.lang)}::text[],
                    ${rows.map((r) => JSON.stringify(r.hashes))}::text[],
                    ${rows.map((r) => JSON.stringify(r.values))}::text[]) AS x(u, l, h, v)
        ON CONFLICT (term_uid, lang) DO UPDATE
          SET snapshot_id = EXCLUDED.snapshot_id,
              slot_hashes = EXCLUDED.slot_hashes,
              slot_values = EXCLUDED.slot_values`
    }
    if (goneEntries.length) {
      await tx`
        DELETE FROM entry_state e
        USING unnest(${goneEntries.map((g) => g.term_uid)}::text[],
                     ${goneEntries.map((g) => g.lang)}::text[]) AS x(u, l)
        WHERE e.term_uid = x.u AND e.lang = x.l`
    }

    for (const rows of chunks(changes)) {
      await tx`
        INSERT INTO term_changes (id, snapshot_id, term_uid, lang, context, kind, old_value, new_value)
        SELECT i, ${snapshotId}, u, l, c, k, o, n
        FROM unnest(${rows.map((r) => r.id)}::text[],
                    ${rows.map((r) => r.term_uid)}::text[],
                    ${rows.map((r) => r.lang)}::text[],
                    ${rows.map((r) => r.context)}::text[],
                    ${rows.map((r) => r.kind)}::text[],
                    ${rows.map((r) => r.old_value)}::text[],
                    ${rows.map((r) => r.new_value)}::text[]) AS x(i, u, l, c, k, o, n)`
    }

    // Bring `superseded_at` in line with what is live: the version whose hash
    // matches the current value is live (a restored value comes back to
    // life), every other version of that slot or term is not. A hash of ""
    // matches nothing, so it retires every version. Only rows whose state is
    // wrong are touched.
    for (const rows of chunks(supersededSlots)) {
      await tx`
        UPDATE slot_versions s
        SET superseded_at = CASE WHEN s.value_hash = x.h THEN NULL ELSE COALESCE(s.superseded_at, now()) END
        FROM unnest(${rows.map((r) => r[0])}::text[],
                    ${rows.map((r) => r[1])}::text[],
                    ${rows.map((r) => r[2])}::text[],
                    ${rows.map((r) => r[3])}::text[]) AS x(u, l, c, h)
        WHERE s.term_uid = x.u AND s.lang = x.l AND s.context = x.c
          AND (s.value_hash = x.h) <> (s.superseded_at IS NULL)`
    }
    for (const rows of chunks(supersededTerms)) {
      await tx`
        UPDATE term_versions t
        SET superseded_at = CASE WHEN t.fields_hash = x.h THEN NULL ELSE COALESCE(t.superseded_at, now()) END
        FROM unnest(${rows.map((r) => r[0])}::text[], ${rows.map((r) => r[1])}::text[]) AS x(u, h)
        WHERE t.term_uid = x.u AND (t.fields_hash = x.h) <> (t.superseded_at IS NULL)`
    }

    return { status: "indexed", first: firstRun, changes: changes.length }
  })
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
}
