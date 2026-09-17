/**
 * Glossary data loading and indexing.
 *
 * Loads JSON data at module scope (bundled into the server). Builds lookup
 * indexes for term resolution and content filtering.
 */

import termsData from "../data/glossary-terms-enhanced.json"

// Types derived from the JSON structure
export interface GlossaryTerm {
  id: string
  /**
   * Stable identifier: ten characters of [0-9a-z], minted once by
   * `scripts/term-uid.mjs` and never changed. Feedback and change history
   * key on this, because both the canonical name and the `id` slug change
   * when a term is renamed.
   */
  uid: string
  term: string
  category: string
  term_role?:
    | "concept"
    | "brand-or-project"
    | "person-name"
    | "programming-language"
    | "os-platform"
    | "cryptographic-primitive"
    | "network-name"
    | "file-extension"
    | "cli-command"
    | "ticker-or-standard"
    | "identifier"
  definition: string
  references?: Array<{ label: string; url: string }>
  has_tooltip: boolean
  in_glossary: boolean
  content_occurrences: number
  forms: { base: string; plural?: string }
  script_rule: string
  casing: string
  aliases?: Array<string | { term: string; status: string; note?: string }>
  avoid?: string[]
  note?: string
  translation_note?: string
}

export interface TranslationEntry {
  term: string
  /**
   * A romanization of THIS entry's translation -- the target-language term
   * spelled in Latin letters, as a pronunciation aid. It is not the English
   * transliterated into the target script.
   *
   * Present only for the 13 non-Latin-script languages, and only where there
   * is something to romanize: in Russian, 405/409 `translate` terms carry one
   * and 0/32 `always_latin` terms do, because those are already Latin.
   * Undocumented in docs/data-shape.md until now.
   */
  transliteration?: string | null
  /** Other accepted renderings in the target language. */
  aliases?: string[] | null
  /** Noun/verb/adjective forms and compounds, where the language has them. */
  morphology?: Record<string, unknown> | null
  contexts?: {
    prose?: { term: string; example?: string }
    heading?: { term: string }
    tag?: { term: string }
    ui?: { term: string }
    code?: { term: string }
  }
  plurals?: {
    one: string | null
    two?: string | null
    few?: string | null
    many?: string | null
    other: string | null
  }
  grammar?: {
    gender?: string
    part_of_speech?: string
    formality?: string
  }
  confidence?: string
  notes?: string
}

// Load confirmed terms from the glossary data
const glossary = termsData as {
  metadata: { total_confirmed: number }
  confirmed_terms: Record<string, GlossaryTerm>
}

const confirmedTerms = glossary.confirmed_terms

// Build lookup index: lowercase surface form -> entry ID
const surfaceFormIndex = new Map<string, string>()

for (const [key, entry] of Object.entries(confirmedTerms)) {
  // Index the term itself
  surfaceFormIndex.set(entry.term.toLowerCase(), key)

  // Index the base form
  if (entry.forms?.base) {
    surfaceFormIndex.set(entry.forms.base.toLowerCase(), key)
  }

  // Index the plural form. A plural is not an alias, but it is a surface
  // form: without this, merging "events" into "event" would make the plural
  // unresolvable and stop /filter matching it in submitted content.
  if (entry.forms?.plural) {
    surfaceFormIndex.set(entry.forms.plural.toLowerCase(), key)
  }

  // Index aliases (handles both object and string forms)
  if (entry.aliases) {
    for (const alias of entry.aliases) {
      const aliasStr = typeof alias === "string" ? alias : alias.term
      if (aliasStr) surfaceFormIndex.set(aliasStr.toLowerCase(), key)
    }
  }

  // Index avoid forms (so "on-chain" resolves to "onchain")
  if (entry.avoid) {
    for (const avoidForm of entry.avoid) {
      surfaceFormIndex.set(avoidForm.toLowerCase(), key)
    }
  }
}

// Index the id slug last, so it wins any collision with an alias or avoid
// form. URLs are built from `id`, so this is what /style-guide/:termId and
// /translate/:lang/:termId actually look up -- without it, every term whose
// id differs from its key (200 of 532: any multi-word term) returns 404.
for (const [key, entry] of Object.entries(confirmedTerms)) {
  if (entry.id) surfaceFormIndex.set(entry.id.toLowerCase(), key)
}

// Build regex pattern for content matching (longest first)
const allForms = Array.from(surfaceFormIndex.keys())
allForms.sort((a, b) => b.length - a.length)
const escaped = allForms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
const matchPattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi")

// Translation cache
const translationCache = new Map<string, Record<string, TranslationEntry>>()

/**
 * Every `id` has to survive being put in a URL path, unencoded.
 *
 * `51% attack` shipped with `id: "51%-attack"`, and `%-a` is a malformed
 * percent-escape: Cloudflare rejected it at the edge with a 400 before the
 * Worker ever ran, so the term was unreachable on the site AND through
 * `/api/v1/style-guide/{termId}`, which documents `id` as the thing you put
 * in the path. Encoding at each call site would have hidden it; this makes
 * the shape impossible instead.
 *
 * Called at module load so a bad id fails fast rather than 400ing one term.
 */
function assertIdsAreUrlSafe(): void {
  const shape = /^[a-z0-9]+(-[a-z0-9]+)*$/
  const bad = Object.values(confirmedTerms)
    .filter((entry) => !shape.test(entry.id))
    .map((entry) => `${entry.term} -> ${entry.id}`)

  if (bad.length) {
    throw new Error(
      `glossary ids must be lowercase kebab-case to be URL-safe -- ${bad.join("; ")}`
    )
  }
}

assertIdsAreUrlSafe()

/**
 * Every entry carries a stable `uid`, and no two share one. Feedback and
 * change history are keyed on it, so a missing or duplicated uid would
 * silently attach one term's feedback to another. Fail at load instead.
 */
function assertUidsAreUnique(): void {
  const shape = /^[0-9a-z]{10}$/
  const seen = new Map<string, string>()
  const bad: string[] = []
  for (const entry of Object.values(confirmedTerms)) {
    if (!entry.uid || !shape.test(entry.uid)) bad.push(`${entry.term} -> ${entry.uid ?? "missing"}`)
    else if (seen.has(entry.uid)) bad.push(`${entry.term} shares uid with ${seen.get(entry.uid)}`)
    else seen.set(entry.uid, entry.term)
  }
  if (bad.length) {
    throw new Error(`glossary uids must be present and unique -- ${bad.join("; ")}`)
  }
}

assertUidsAreUnique()

export function getTerms(): Record<string, GlossaryTerm> {
  return confirmedTerms
}

export function getTermCount(): number {
  return Object.keys(confirmedTerms).length
}

export function getTermById(id: string): GlossaryTerm | undefined {
  return confirmedTerms[id]
}

export function resolveTerm(query: string): GlossaryTerm | undefined {
  const key = surfaceFormIndex.get(query.toLowerCase())
  if (key) return confirmedTerms[key]
  return undefined
}

export function getSurfaceFormIndex(): Map<string, string> {
  return surfaceFormIndex
}

export function getMatchPattern(): RegExp {
  return matchPattern
}

export async function loadTranslations(
  lang: string
): Promise<Record<string, TranslationEntry>> {
  if (translationCache.has(lang)) {
    return translationCache.get(lang)!
  }

  try {
    // Dynamic import for translation files
    const mod = await import(`../data/translations/glossary-${lang}.json`)
    const translations = mod.default as Record<string, TranslationEntry>
    translationCache.set(lang, translations)
    return translations
  } catch {
    return {}
  }
}

export const SUPPORTED_LANGUAGES = [
  "ar",
  "bn",
  "cs",
  "de",
  "es",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "mr",
  "pl",
  "pt-br",
  "ru",
  "sw",
  "ta",
  "te",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
  "zh-tw",
]

export interface LanguageStats {
  code: string
  translatedTerms: number
  totalTerms: number
  completionPercent: number
  confidenceBreakdown: { high: number; medium: number; low: number }
}

/**
 * Coverage figures for one language.
 *
 * Shared by /api/v1/languages and the /languages page. They were separate
 * copies of the same loop, which meant the page's claim that the two "can
 * never disagree" was false the moment either was edited.
 *
 * Only keys present in the master list are counted -- translation files carry
 * 9 orphans that are not master terms. See docs/gotchas.md section 5.
 */
export async function computeLanguageStats(code: string): Promise<LanguageStats> {
  const totalTerms = getTermCount()
  const masterKeys = new Set(Object.keys(getTerms()))
  const translations = await loadTranslations(code)
  const validKeys = Object.keys(translations).filter((k) => masterKeys.has(k))

  const confidenceBreakdown = { high: 0, medium: 0, low: 0 }
  for (const key of validKeys) {
    const conf = translations[key].confidence ?? "high"
    if (conf in confidenceBreakdown) {
      confidenceBreakdown[conf as keyof typeof confidenceBreakdown]++
    }
  }

  return {
    code,
    translatedTerms: validKeys.length,
    totalTerms,
    completionPercent: Math.round((validKeys.length / totalTerms) * 100),
    confidenceBreakdown,
  }
}
