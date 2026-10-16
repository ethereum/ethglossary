/**
 * What the account page shows about a person's feedback: how far they have
 * got in each language, and everything they have suggested or proposed,
 * resolved to the terms it is about. Read-only over the store; the page
 * links back to the term for anything that needs acting on.
 */

import type { Sql } from "../db/client"
import type { ContextId } from "../lib/context-types"
import { getTerms, loadTranslations } from "../lib/glossary-data"
import type { GlossaryTerm } from "../lib/glossary-data"
import { slotDigest, slotHash } from "../lib/hash"
import { getLanguageMeta } from "../lib/language-meta"
import * as store from "./store"

export interface LanguageProgress {
  lang: string
  name: string
  /** Terms the language has an entry for. */
  total: number
  /** Every applicable context covered. */
  full: number
  /** Some, not all. */
  partial: number
}

export interface TermRef {
  id: string
  term: string
}

export interface ProfileSuggestion {
  id: string
  lang: string
  language: string
  /** Null when the term has since left the glossary. */
  term: TermRef | null
  context: ContextId
  value: string
  reason: string | null
  /** False once the translation changed after this was written. */
  current: boolean
  status: store.FeedbackStatus
  resolutionNote: string | null
  createdAt: string
}

export interface ProfileProposal {
  id: string
  kind: store.ProposalKind
  lang: string | null
  language: string | null
  term: TermRef | null
  payload: Record<string, unknown>
  reason: string | null
  status: store.FeedbackStatus
  resolutionNote: string | null
  createdAt: string
}

export interface ProfileFeedback {
  progress: LanguageProgress[]
  suggestions: ProfileSuggestion[]
  proposals: ProfileProposal[]
}

let byUid: Map<string, GlossaryTerm & { key: string }> | null = null
function termByUid(uid: string) {
  if (!byUid) byUid = new Map(Object.entries(getTerms()).map(([key, t]) => [t.uid, { key, ...t }]))
  return byUid.get(uid)
}

const ref = (t?: { id: string; term: string }): TermRef | null => (t ? { id: t.id, term: t.term } : null)
const languageName = (lang: string) => getLanguageMeta(lang)?.name ?? lang
const day = (d: Date) => d.toISOString().slice(0, 10)

export async function profileFeedback(sql: Sql, userId: string): Promise<ProfileFeedback> {
  const [coverage, suggestions, proposals] = await Promise.all([
    store.coverageByLanguage(sql, userId),
    store.allMySuggestions(sql, userId),
    store.allMyProposals(sql, userId),
  ])

  // Same arithmetic as the term list's progress marks, per language.
  const progress: LanguageProgress[] = []
  for (const [lang, covered] of coverage) {
    const entries = await loadTranslations(lang)
    let total = 0
    let full = 0
    let partial = 0
    for (const [key, t] of Object.entries(getTerms())) {
      const entry = entries[key]
      if (!entry) continue
      total++
      const { hashes } = slotDigest(entry)
      const contexts = Object.keys(hashes)
      const done = contexts.filter((ctx) => covered.has(`${t.uid}:${ctx}:${hashes[ctx]}`)).length
      if (done && done === contexts.length) full++
      else if (done) partial++
    }
    progress.push({ lang, name: languageName(lang), total, full, partial })
  }
  progress.sort((a, b) => b.full - a.full || b.partial - a.partial || a.name.localeCompare(b.name))

  const own: ProfileSuggestion[] = []
  for (const s of suggestions) {
    const t = termByUid(s.term_uid)
    const entry = t ? (await loadTranslations(s.lang))[t.key] : undefined
    own.push({
      id: s.id,
      lang: s.lang,
      language: languageName(s.lang),
      term: ref(t),
      context: s.context,
      value: s.value,
      reason: s.reason,
      current: !!entry && slotHash(entry, s.context) === s.hash,
      status: s.status,
      resolutionNote: s.resolution_note,
      createdAt: day(s.created_at),
    })
  }

  return {
    progress,
    suggestions: own,
    proposals: proposals.map((p) => ({
      id: p.id,
      kind: p.kind,
      lang: p.lang,
      language: p.lang ? languageName(p.lang) : null,
      term: ref(p.term_uid ? termByUid(p.term_uid) : undefined),
      payload: p.payload,
      reason: p.reason,
      status: p.status,
      resolutionNote: p.resolution_note,
      createdAt: day(p.created_at),
    })),
  }
}
