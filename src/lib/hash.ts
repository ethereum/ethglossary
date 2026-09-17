/**
 * Content hashes for the glossary.
 *
 * Community feedback is never about a slot in the abstract; it is about the
 * exact string a reviewer saw. So a vote or suggestion is stored against the
 * hash of that value, and "is this feedback about what is live right now" is
 * answered by hashing the bundled data at request time and comparing. The
 * scheduled indexer (src/lib/indexer.ts) uses the same functions to notice
 * what a deploy changed.
 *
 * SHA-256, hex, first 32 characters. Truncation keeps rows small; 128 bits is
 * far beyond what collision resistance needs here.
 */

import type { GlossaryTerm, TranslationEntry } from "./glossary-data"
import { applicableContexts, slotValue } from "./context-types"
import type { ContextId } from "./context-types"

const encoder = new TextEncoder()

export async function sha256Hex32(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}

/** Hash of one translation slot, or null when the slot is not populated. */
export async function slotHash(entry: TranslationEntry, context: ContextId): Promise<string | null> {
  const value = slotValue(entry, context)
  return value === null ? null : sha256Hex32(value)
}

/**
 * Hash and value of every populated slot on one entry, keyed by context.
 * `values` is what the indexer stores so the History rail can show what a
 * slot used to say.
 */
export async function slotDigest(
  entry: TranslationEntry
): Promise<{ hashes: Record<string, string>; values: Record<string, string> }> {
  const hashes: Record<string, string> = {}
  const values: Record<string, string> = {}
  for (const context of applicableContexts(entry)) {
    const value = slotValue(entry, context)
    if (value === null) continue
    values[context] = value
    hashes[context] = await sha256Hex32(value)
  }
  return { hashes, values }
}

/**
 * The master fields a reader can give feedback on. Counters and pipeline
 * bookkeeping (`content_occurrences`, `content_files`, `intl_keys`, `sources`)
 * are deliberately excluded: they change without the term changing.
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

export async function termHash(term: GlossaryTerm): Promise<string> {
  return sha256Hex32(canonicalJson(termFields(term)))
}
