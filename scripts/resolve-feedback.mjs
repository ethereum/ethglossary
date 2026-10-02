#!/usr/bin/env node
/**
 * Mark suggestions and proposals as decided, so the next export does not
 * re-analyze them.
 *
 *   DATABASE_URL=postgres://... node scripts/resolve-feedback.mjs \
 *     --accept <id,id,...> --decline <id,id,...> [--note "why"] [--dry-run]
 *
 * Ids are the `ids` / `id` fields from export-feedback.mjs, for suggestions
 * and proposals alike. Accepting here records the decision only; the
 * glossary change itself is a pull request against the JSON files.
 */

import postgres from "postgres"

const args = process.argv.slice(2)
const list = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : []
}
const accept = list("accept")
const decline = list("decline")
const noteIdx = args.indexOf("--note")
const note = noteIdx >= 0 ? args[noteIdx + 1] ?? null : null
const dryRun = args.includes("--dry-run")

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required")
  process.exit(2)
}
if (!accept.length && !decline.length) {
  console.error("nothing to do: pass --accept and/or --decline with ids")
  process.exit(2)
}
const uuid = /^[0-9a-f-]{36}$/i
for (const id of [...accept, ...decline]) {
  if (!uuid.test(id)) {
    console.error(`not an id: ${id}`)
    process.exit(2)
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
let changed = 0
await sql.begin(async (tx) => {
  for (const [ids, status] of [
    [accept, "accepted"],
    [decline, "declined"],
  ]) {
    if (!ids.length) continue
    for (const table of ["suggestions", "proposals"]) {
      const rows = await tx`
        UPDATE ${tx(table)} SET status = ${status}, resolved_at = now(), resolution_note = ${note}
        WHERE id = ANY(${ids}::text[]) AND status = 'open'
        RETURNING id`
      changed += rows.length
      for (const r of rows) console.error(`${table} ${r.id} -> ${status}`)
    }
  }
  if (dryRun) throw new Error("dry run")
}).catch((err) => {
  if (err.message !== "dry run") throw err
  console.error("dry run: nothing written")
})
await sql.end()
if (!dryRun) console.error(`resolved ${changed} item(s)`)
