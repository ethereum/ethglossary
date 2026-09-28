#!/usr/bin/env node
/**
 * Stable term identifiers.
 *
 * Every master entry carries a `uid`: ten characters from [0-9a-z], minted
 * once and never changed. Feedback and change history key on it, so a term
 * can be renamed or merged without orphaning anything. The canonical name
 * (the JSON key) and the `id` slug both change on rename; `uid` does not.
 *
 *   node scripts/term-uid.mjs             print one fresh uid (for a new entry)
 *   node scripts/term-uid.mjs --backfill  add a uid to every entry that lacks one
 *   node scripts/term-uid.mjs --check     exit 1 if any uid is missing, malformed or duplicated
 */

import { readFileSync, writeFileSync } from "node:fs"
import { randomInt } from "node:crypto"

const DATA = new URL("../src/data/glossary-terms-enhanced.json", import.meta.url)
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
const LENGTH = 10
export const UID_SHAPE = /^[0-9a-z]{10}$/

export function newUid() {
  let out = ""
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

function load() {
  const raw = readFileSync(DATA, "utf8")
  return { raw, data: JSON.parse(raw) }
}

/** Re-serialize exactly as the file is kept: two-space indent, trailing newline. */
function save(data) {
  writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n")
}

/** Put `uid` directly after `id` so the two identifiers read together. */
function withUid(entry, uid) {
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    out[k] = v
    if (k === "id") out.uid = uid
  }
  if (!("uid" in out)) out.uid = uid
  return out
}

function check(data) {
  const seen = new Map()
  const problems = []
  for (const [key, entry] of Object.entries(data.confirmed_terms)) {
    const uid = entry.uid
    if (!uid) problems.push(`${key}: missing uid`)
    else if (!UID_SHAPE.test(uid)) problems.push(`${key}: malformed uid "${uid}"`)
    else if (seen.has(uid)) problems.push(`${key}: uid "${uid}" duplicates ${seen.get(uid)}`)
    else seen.set(uid, key)
  }
  return problems
}

const mode = process.argv[2]

if (mode === "--backfill") {
  const { data } = load()
  const used = new Set(Object.values(data.confirmed_terms).map((t) => t.uid).filter(Boolean))
  let added = 0
  for (const [key, entry] of Object.entries(data.confirmed_terms)) {
    if (entry.uid) continue
    let uid = newUid()
    while (used.has(uid)) uid = newUid()
    used.add(uid)
    data.confirmed_terms[key] = withUid(entry, uid)
    added++
  }
  const problems = check(data)
  if (problems.length) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  save(data)
  console.log(`added ${added} uid(s); ${used.size} entries carry one`)
} else if (mode === "--check") {
  const problems = check(load().data)
  if (problems.length) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log("ok")
} else {
  console.log(newUid())
}
