/**
 * Content hashes for the glossary.
 *
 * Community feedback is never about a slot in the abstract; it is about the
 * exact string a reviewer saw. So a vote or suggestion is stored against the
 * hash of that value, and "is this feedback about what is live right now" is
 * answered by hashing the bundled data at request time and comparing. The
 * startup indexer (src/lib/indexer.ts) uses the same functions to notice what
 * a deploy changed.
 *
 * SHA-256, hex, first 32 characters. Truncation keeps rows small; 128 bits is
 * far beyond what collision resistance needs here. Synchronous on purpose:
 * the indexer hashes tens of thousands of short strings, and Node's native
 * hash does that in well under a second without a single event-loop hop.
 */

import { createHash } from "node:crypto"
import type { GlossaryTerm, TranslationEntry } from "./glossary-data"
import { applicableContexts, slotValue } from "./context-types"
import type { ContextId } from "./context-types"

export function sha256Hex32(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32)
}

/** Hash of one translation slot, or null when the slot is not populated. */
export function slotHash(entry: TranslationEntry, context: ContextId): string | null {
  const value = slotValue(entry, context)
  return value === null ? null : sha256Hex32(value)
}

/**
 * Hash and value of every populated slot on one entry, keyed by context.
 * `values` is what the indexer stores so the History rail can show what a
 * slot used to say.
 */
export function slotDigest(entry: TranslationEntry): {
  hashes: Record<string, string>
  values: Record<string, string>
} {
  const hashes: Record<string, string> = {}
  const values: Record<string, string> = {}
  for (const context of applicableContexts(entry)) {
    const value = slotValue(entry, context)
    if (value === null) continue
    values[context] = value
    hashes[context] = sha256Hex32(value)
  }
  return { hashes, values }
}

/**
 * The master fields a reader can give feedback on.
 *
 * Excluded on purpose: pipeline counters (`content_occurrences`,
 * `content_files`, `intl_keys`, `sources`), which move without the term
 * changing, and the ethereum.org display flags (`has_tooltip`,
 * `in_glossary`), which are not something a reader reviews.
 */
export function termFields(term: GlossaryTerm): Record<string, unknown> {
  return {
    term: term.term,
    definition: term.definition,
    references: term.references,
    avoid: term.avoid,
    aliases: term.aliases,
    casing: term.casing,
    note: term.note,
    translation_note: term.translation_note,
    script_rule: term.script_rule,
    term_role: term.term_role,
    category: term.category,
  }
}

/** JSON with object keys sorted at every depth and `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function termHash(term: GlossaryTerm): string {
  return sha256Hex32(canonicalJson(termFields(term)))
}
