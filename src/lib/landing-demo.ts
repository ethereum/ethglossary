/**
 * The landing page's two live demonstrations, built from the glossary at
 * request time so they can never drift from the data: five terms across six
 * languages, each card saying whether the term was kept in English,
 * transliterated or translated; and one sentence through /api/v1/filter.
 *
 * Which non-Latin renderings are transliterations is an editorial call the
 * data does not record (its `transliteration` field is a romanisation of the
 * target word, not a verdict), so it is stated here per term. Whether a term
 * was kept in English is derived: the rendering equals the English.
 */

import { getTerms, loadTranslations } from "./glossary-data"
import { slotValue } from "./context-types"
import { getLanguageMeta } from "./language-meta"
import { filterForContent } from "./content-filter"
import type { FilteredTerm } from "./content-filter"

export type DemoKind = "kept" | "transliterated" | "translated"

export interface DemoCard {
  lang: string
  name: string
  dir: "ltr" | "rtl"
  value: string
  kind: DemoKind
}

export interface DemoTerm {
  key: string
  term: string
  cards: DemoCard[]
}

export interface LandingDemo {
  terms: DemoTerm[]
  filter: { content: string; language: string; results: FilteredTerm[] }
}

const DEMO_LANGS = ["es", "pt-br", "ko", "ja", "hi", "ar"]

/** The five terms, and in which of the non-Latin-script languages the rendering is a transliteration. */
const DEMO_TERMS: Array<{ key: string; transliterated: string[] }> = [
  { key: "staking", transliterated: ["ko", "ja", "hi"] },
  { key: "wallet", transliterated: ["ja", "hi"] },
  { key: "onchain", transliterated: ["ko", "ja", "hi"] },
  { key: "smart contract", transliterated: ["ko", "ja"] },
  { key: "rollup", transliterated: ["ko", "ja", "hi"] },
]

export const DEMO_SENTENCE = "Stake from your wallet and earn rewards onchain."
export const DEMO_LANGUAGE = "ko"

let cached: Promise<LandingDemo> | null = null

/** Computed once per process: the glossary is immutable while it runs. */
export function landingDemo(): Promise<LandingDemo> {
  if (!cached) cached = build()
  return cached
}

async function build(): Promise<LandingDemo> {
  const master = getTerms()
  const files = await Promise.all(DEMO_LANGS.map(loadTranslations))

  const terms: DemoTerm[] = DEMO_TERMS.flatMap(({ key, transliterated }) => {
    const english = master[key]
    if (!english) return []
    const cards: DemoCard[] = []
    DEMO_LANGS.forEach((lang, i) => {
      const entry = files[i][key]
      const meta = getLanguageMeta(lang)
      if (!entry || !meta) return
      // The bare form: a tag, failing that a heading, failing that prose,
      // which in some languages carries a grammatical particle.
      const value = slotValue(entry, "tag") ?? slotValue(entry, "heading") ?? slotValue(entry, "prose")
      if (!value) return
      const kind: DemoKind =
        value.trim().toLowerCase() === english.term.toLowerCase()
          ? "kept"
          : transliterated.includes(lang)
            ? "transliterated"
            : "translated"
      cards.push({ lang, name: meta.name, dir: meta.dir, value, kind })
    })
    return [{ key, term: english.term, cards }]
  })

  const results = await filterForContent(DEMO_SENTENCE, "markdown", DEMO_LANGUAGE, false)
  return { terms, filter: { content: DEMO_SENTENCE, language: DEMO_LANGUAGE, results } }
}
