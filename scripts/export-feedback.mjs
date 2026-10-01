#!/usr/bin/env node
/**
 * Export community feedback as JSON Lines for maintainer review.
 *
 *   DATABASE_URL=postgres://... node scripts/export-feedback.mjs [--since ISO] [--status open|accepted|declined|withdrawn|all] > feedback.jsonl
 *
 * One line per record. `type` is one of:
 *   suggestion  -- one distinct suggested value for one slot, with how many
 *                  accounts proposed it and their reasons
 *   proposal    -- a new term, a redundancy or split flag, or a metadata change
 *   tally       -- up/down counts for one slot value, live or superseded
 *
 * Each line names the term (uid and current English name), the language and
 * slot, the value that was live when the feedback was given, whether that
 * value is still live, and the accounts involved as provider:handle-or-id
 * plus the display name (labelled unverified). term_redirects are applied so
 * feedback on a merged term reads as feedback on its survivor.
 *
 * Read-only. Run it from a machine with database access (maintainers use
 * the Warpgate connection string). Feedback is advisory: acting on any of
 * this is a pull request against the JSON files.
 */

import postgres from "postgres"
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const since = opt("since", null)
const status = opt("status", "open")
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required")
  process.exit(2)
}

const master = JSON.parse(readFileSync(new URL("../src/data/glossary-terms-enhanced.json", import.meta.url), "utf8")).confirmed_terms
const byUid = new Map(Object.values(master).map((t) => [t.uid, t]))

const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} })
const redirects = new Map((await sql`SELECT from_uid, to_uid FROM term_redirects`).map((r) => [r.from_uid, r.to_uid]))
const canonical = (uid) => redirects.get(uid) ?? uid
const termName = (uid) => byUid.get(canonical(uid))?.term ?? null

const author = (u) => ({
  id: u.user_id,
  provider: u.provider,
  handle: u.handle ?? u.subject ?? null,
  display_name_unverified: u.display_name ?? null,
  deleted: u.deleted_at !== null,
  account_age_days: Math.floor((Date.now() - new Date(u.user_created).getTime()) / 86_400_000),
})

const statusClause = status === "all" ? sql`` : sql`AND s.status = ${status}`
const sinceClause = since ? sql`AND s.created_at >= ${new Date(since)}` : sql``
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")

// ---- suggestions, grouped by slot version and normalized value
const suggestions = await sql`
  SELECT s.id, s.value, s.normalized_value, s.reason, s.status, s.created_at,
         sv.term_uid, sv.lang, sv.context, sv.value AS live_value_then, sv.superseded_at,
         u.id AS user_id, u.provider, u.subject, u.handle, u.display_name, u.deleted_at, u.created_at AS user_created
  FROM suggestions s
  JOIN slot_versions sv ON sv.id = s.slot_version_id
  JOIN users u ON u.id = s.user_id
  WHERE TRUE ${statusClause} ${sinceClause}
  ORDER BY sv.term_uid, sv.lang, sv.context, s.normalized_value, s.created_at`
const groups = new Map()
for (const r of suggestions) {
  const key = [r.term_uid, r.lang, r.context, r.superseded_at ? "old" : "live", r.normalized_value].join("\u0000")
  const g = groups.get(key) ?? {
    type: "suggestion",
    term_uid: canonical(r.term_uid),
    term: termName(r.term_uid),
    lang: r.lang,
    context: r.context,
    value_then: r.live_value_then,
    still_live: r.superseded_at === null,
    suggested: r.value,
    status: r.status,
    supporters: 0,
    reasons: [],
    authors: [],
    ids: [],
    first_at: r.created_at,
  }
  g.supporters++
  if (r.reason) g.reasons.push(r.reason)
  g.authors.push(author(r))
  g.ids.push(r.id)
  groups.set(key, g)
}
for (const g of groups.values()) out(g)

// ---- proposals
const pStatus = status === "all" ? sql`` : sql`AND p.status = ${status}`
const pSince = since ? sql`AND p.created_at >= ${new Date(since)}` : sql``
const proposals = await sql`
  SELECT p.id, p.kind, p.term_uid, p.lang, p.payload, p.reason, p.status, p.created_at,
         tv.superseded_at,
         u.id AS user_id, u.provider, u.subject, u.handle, u.display_name, u.deleted_at, u.created_at AS user_created
  FROM proposals p
  LEFT JOIN term_versions tv ON tv.id = p.term_version_id
  JOIN users u ON u.id = p.user_id
  WHERE TRUE ${pStatus} ${pSince}
  ORDER BY p.created_at`
for (const p of proposals) {
  out({
    type: "proposal",
    id: p.id,
    kind: p.kind,
    term_uid: p.term_uid ? canonical(p.term_uid) : null,
    term: p.term_uid ? termName(p.term_uid) : null,
    lang: p.lang,
    payload: p.payload,
    reason: p.reason,
    status: p.status,
    english_entry_still_live: p.term_uid ? p.superseded_at === null : null,
    author: author(p),
    created_at: p.created_at,
  })
}

// ---- vote tallies per slot value
const tallies = await sql`
  SELECT sv.term_uid, sv.lang, sv.context, sv.value, sv.superseded_at,
         COUNT(*) FILTER (WHERE v.direction = 1)::int AS up,
         COUNT(*) FILTER (WHERE v.direction = -1)::int AS down,
         COUNT(DISTINCT v.user_id)::int AS voters
  FROM votes v
  JOIN slot_versions sv ON sv.id = v.slot_version_id
  GROUP BY sv.id
  ORDER BY sv.term_uid, sv.lang, sv.context, sv.superseded_at NULLS FIRST`
for (const t of tallies) {
  out({
    type: "tally",
    term_uid: canonical(t.term_uid),
    term: termName(t.term_uid),
    lang: t.lang,
    context: t.context,
    value: t.value,
    still_live: t.superseded_at === null,
    up: t.up,
    down: t.down,
    voters: t.voters,
  })
}

await sql.end()
console.error(`exported ${groups.size} suggestion groups, ${proposals.length} proposals, ${tallies.length} tallies`)
