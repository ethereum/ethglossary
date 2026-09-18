/**
 * Glossary change indexer.
 *
 * Every image carries one fixed glossary, so the question "what did this
 * deploy change" is answered once, at startup: compare the bundled data with
 * what the database recorded for the previous build and write one
 * term_changes row per slot or term that differs. That is what the Versions
 * rail renders, and it is how a reviewer's progress mark is allowed to go
 * stale honestly.
 *
 * The whole pass is one transaction under an advisory lock, so several
 * replicas booting together produce one snapshot between them. It is
 * idempotent: a build that was already indexed is a single SELECT.
 *
 * The first run ever records the current state and emits no change rows.
 * History starts at the first indexed deploy by design.
 *
 * Nothing on the request path reads the tables this writes. Whether a vote
 * is about the live value is always decided by hashing the bundled data, so
 * a late or failed index run can never make the site wrong.
 */

import { getTerms, loadTranslations, SUPPORTED_LANGUAGES } from "./glossary-data"
import { sha256Hex32, slotDigest, termHash } from "./hash"
import type { Sql } from "../db/client"

export interface BuildInfo {
  /** Git SHA of the image in production; a content hash in development. */
  versionId: string
  gitSha: string | null
  deployedAt: Date
}

export type IndexerResult =
  | { status: "noop"; reason: "already-indexed" }
  | { status: "indexed"; first: boolean; changes: number }

/** Arbitrary constant; only has to differ from the migration lock. */
const LOCK_KEY = 0x696e6478 // "indx"

/** Rows per bulk statement. A handful of array parameters each. */
const CHUNK = 4000

interface ChangeRow {
  id: string
  term_uid: string
  lang: string | null
  context: string | null
  kind: string
  old_value: string | null
  new_value: string | null
}

interface EntryStateRow {
  term_uid: string
  lang: string
  slot_hashes: Record<string, string>
  slot_values: Record<string, string>
}

/**
 * Identify the running build. GIT_SHA is baked into the image by the
 * workflow; without it (local development) hash the bundled data itself, so
 * an edited translation file still reads as a new version.
 */
export async function describeBuild(env: NodeJS.ProcessEnv = process.env): Promise<BuildInfo> {
  const gitSha = env.GIT_SHA?.trim() || null
  if (gitSha) return { versionId: gitSha, gitSha, deployedAt: new Date() }

  const parts = [JSON.stringify(getTerms())]
  for (const lang of SUPPORTED_LANGUAGES) parts.push(JSON.stringify(await loadTranslations(lang)))
  const digest = await sha256Hex32(parts.join("\n"))
  return { versionId: `dev-${digest}`, gitSha: null, deployedAt: new Date() }
}

export async function runIndexer(sql: Sql, build: BuildInfo): Promise<IndexerResult> {
  return sql.begin(async (tx): Promise<IndexerResult> => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`

    const existing = await tx<{ id: string; completed_at: Date | null }[]>`
      SELECT id, completed_at FROM glossary_snapshots WHERE version_id = ${build.versionId}`
    if (existing[0]?.completed_at) return { status: "noop", reason: "already-indexed" }

    const master = getTerms()
    const snapshotId = existing[0]?.id ?? crypto.randomUUID()
    if (!existing[0]) {
      await tx`
        INSERT INTO glossary_snapshots (id, version_id, git_sha, deployed_at, term_count)
        VALUES (${snapshotId}, ${build.versionId}, ${build.gitSha}, ${build.deployedAt}, ${Object.keys(master).length})`
    }

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
        id: crypto.randomUUID(),
        term_uid: uid,
        lang,
        context,
        kind,
        old_value: oldValue,
        new_value: newValue,
      })

    // ------------------------------------------------------------ master
    const storedTerms = await tx<{ term_uid: string; fields_hash: string; term: string }[]>`
      SELECT term_uid, fields_hash, term FROM term_state`
    const firstRun = storedTerms.length === 0
    const prevTerms = new Map(storedTerms.map((r) => [r.term_uid, r]))

    const termRows: { uid: string; hash: string; term: string }[] = []
    const supersededTerms: { uid: string; hash: string }[] = []
    for (const term of Object.values(master)) {
      const hash = await termHash(term)
      termRows.push({ uid: term.uid, hash, term: term.term })
      const prev = prevTerms.get(term.uid)
      prevTerms.delete(term.uid)
      if (firstRun) continue
      if (!prev) {
        change(term.uid, null, null, "term_added", null, term.term)
        continue
      }
      if (prev.term !== term.term) change(term.uid, null, null, "term_renamed", prev.term, term.term)
      if (prev.fields_hash !== hash) {
        if (prev.term === term.term) change(term.uid, null, null, "term_changed", null, null)
        supersededTerms.push({ uid: term.uid, hash })
      }
    }
    for (const gone of prevTerms.values()) change(gone.term_uid, null, null, "term_removed", gone.term, null)

    await tx`
      INSERT INTO term_state (term_uid, snapshot_id, fields_hash, term)
      SELECT u, ${snapshotId}, h, t
      FROM unnest(${termRows.map((r) => r.uid)}::text[],
                  ${termRows.map((r) => r.hash)}::text[],
                  ${termRows.map((r) => r.term)}::text[]) AS x(u, h, t)
      ON CONFLICT (term_uid) DO UPDATE
        SET snapshot_id = EXCLUDED.snapshot_id, fields_hash = EXCLUDED.fields_hash, term = EXCLUDED.term`
    if (prevTerms.size) {
      await tx`DELETE FROM term_state WHERE term_uid = ANY(${[...prevTerms.keys()]}::text[])`
    }
    for (const s of supersededTerms) {
      await tx`
        UPDATE term_versions SET superseded_at = now()
        WHERE term_uid = ${s.uid} AND fields_hash <> ${s.hash} AND superseded_at IS NULL`
    }

    // --------------------------------------------------------- languages
    // Translation files are keyed by canonical name, never by id or uid.
    const storedEntries = await tx<EntryStateRow[]>`
      SELECT term_uid, lang, slot_hashes, slot_values FROM entry_state`
    const entryKey = (lang: string, uid: string) => `${lang}::${uid}`
    const prevEntries = new Map(storedEntries.map((r) => [entryKey(r.lang, r.term_uid), r]))

    const entryRows: { uid: string; lang: string; hashes: string; values: string }[] = []
    const supersededSlots: { uid: string; lang: string; context: string; hash: string }[] = []

    for (const lang of SUPPORTED_LANGUAGES) {
      const translations = await loadTranslations(lang)
      for (const [key, term] of Object.entries(master)) {
        const entry = translations[key]
        if (!entry) continue
        const { hashes, values } = await slotDigest(entry)
        entryRows.push({ uid: term.uid, lang, hashes: JSON.stringify(hashes), values: JSON.stringify(values) })

        const k = entryKey(lang, term.uid)
        const prev = prevEntries.get(k)
        prevEntries.delete(k)
        if (firstRun) continue
        const prevHashes = prev?.slot_hashes ?? {}
        const prevValues = prev?.slot_values ?? {}
        for (const context of Object.keys(hashes)) {
          if (!(context in prevHashes)) {
            change(term.uid, lang, context, "slot_added", null, values[context])
          } else if (prevHashes[context] !== hashes[context]) {
            change(term.uid, lang, context, "slot_changed", prevValues[context] ?? null, values[context])
            supersededSlots.push({ uid: term.uid, lang, context, hash: hashes[context] })
          }
        }
        for (const context of Object.keys(prevHashes)) {
          if (!(context in hashes)) {
            change(term.uid, lang, context, "slot_removed", prevValues[context] ?? null, null)
            supersededSlots.push({ uid: term.uid, lang, context, hash: "" })
          }
        }
      }
    }
    for (const gone of prevEntries.values()) {
      for (const [context, value] of Object.entries(gone.slot_values)) {
        change(gone.term_uid, gone.lang, context, "slot_removed", value, null)
      }
    }

    for (let i = 0; i < entryRows.length; i += CHUNK) {
      const rows = entryRows.slice(i, i + CHUNK)
      await tx`
        INSERT INTO entry_state (term_uid, lang, snapshot_id, slot_hashes, slot_values)
        SELECT u, l, ${snapshotId}, h::jsonb, v::jsonb
        FROM unnest(${rows.map((r) => r.uid)}::text[],
                    ${rows.map((r) => r.lang)}::text[],
                    ${rows.map((r) => r.hashes)}::text[],
                    ${rows.map((r) => r.values)}::text[]) AS x(u, l, h, v)
        ON CONFLICT (term_uid, lang) DO UPDATE
          SET snapshot_id = EXCLUDED.snapshot_id,
              slot_hashes = EXCLUDED.slot_hashes,
              slot_values = EXCLUDED.slot_values`
    }
    if (prevEntries.size) {
      const gone = [...prevEntries.values()]
      await tx`
        DELETE FROM entry_state e
        USING unnest(${gone.map((g) => g.term_uid)}::text[], ${gone.map((g) => g.lang)}::text[]) AS x(u, l)
        WHERE e.term_uid = x.u AND e.lang = x.l`
    }
    for (const s of supersededSlots) {
      await tx`
        UPDATE slot_versions SET superseded_at = now()
        WHERE term_uid = ${s.uid} AND lang = ${s.lang} AND context = ${s.context}
          AND value_hash <> ${s.hash} AND superseded_at IS NULL`
    }

    // ----------------------------------------------------------- changes
    for (let i = 0; i < changes.length; i += CHUNK) {
      const rows = changes.slice(i, i + CHUNK)
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

    await tx`UPDATE glossary_snapshots SET completed_at = now() WHERE id = ${snapshotId}`
    return { status: "indexed", first: firstRun, changes: changes.length }
  })
}
