/**
 * The words the landing page's animations pass around: a city per language,
 * and that language's rendering of a handful of terms. The globe
 * (src/ui/landing/globe.js) flies each term between cities and the hero's
 * community hall (src/ui/landing/community.js) between people, so every word
 * on screen is the glossary's own entry rather than painted or invented text.
 *
 * A language is pinned to a city purely as a place to draw it. That is a
 * visual shorthand, not a claim about where a language belongs. Most get one;
 * a few get a second where it fills an otherwise empty stretch of the globe.
 */

import { loadTranslations, SUPPORTED_LANGUAGES } from "./glossary-data"
import { slotValue } from "./context-types"
import { getLanguageMeta } from "./language-meta"

export interface RelayCity {
  lang: string
  /** Degrees. */
  lat: number
  lon: number
  dir: "ltr" | "rtl"
  /** Term key -> this language's bare form. Terms kept in English are left out. */
  words: Record<string, string>
}

export interface TermRelay {
  terms: string[]
  cities: RelayCity[]
}

const CITIES: Array<[string, number, number]> = [
  ["ar", 30.04, 31.24], // Cairo
  ["bn", 23.81, 90.41], // Dhaka
  ["cs", 50.08, 14.44], // Prague
  ["de", 52.52, 13.4], // Berlin
  ["es", 19.43, -99.13], // Mexico City
  ["fr", 48.86, 2.35], // Paris
  ["fr", 45.5, -73.57], // Montreal
  ["hi", 28.61, 77.21], // Delhi
  ["id", -6.21, 106.85], // Jakarta
  ["it", 41.9, 12.5], // Rome
  ["ja", 35.68, 139.69], // Tokyo
  ["ko", 37.57, 126.98], // Seoul
  ["mr", 19.08, 72.88], // Mumbai
  ["pl", 52.23, 21.01], // Warsaw
  ["pt-br", -23.55, -46.63], // Sao Paulo
  ["ru", 55.76, 37.62], // Moscow
  ["sw", -1.29, 36.82], // Nairobi
  ["ta", 13.08, 80.27], // Chennai
  ["te", 17.39, 78.49], // Hyderabad
  ["tr", 41.01, 28.98], // Istanbul
  ["uk", 50.45, 30.52], // Kyiv
  ["ur", 24.86, 67.01], // Karachi
  ["vi", 21.03, 105.85], // Hanoi
  ["zh", 39.9, 116.4], // Beijing
  ["zh-tw", 25.03, 121.57], // Taipei
]

const TERMS = [
  "ethereum",
  "wallet",
  "staking",
  "smart contract",
  "blockchain",
  "validator",
  "transaction",
  "decentralization",
  "consensus",
  "node",
]

let cached: Promise<TermRelay> | null = null

/** Computed once per process: the glossary is immutable while it runs. */
export function termRelay(): Promise<TermRelay> {
  if (!cached) cached = build()
  return cached
}

async function build(): Promise<TermRelay> {
  const files = await Promise.all(SUPPORTED_LANGUAGES.map(loadTranslations))
  const cities: RelayCity[] = []
  for (const [lang, lat, lon] of CITIES) {
    const file = files[SUPPORTED_LANGUAGES.indexOf(lang)]
    const meta = getLanguageMeta(lang)
    if (!file || !meta) continue
    const words: Record<string, string> = {}
    for (const key of TERMS) {
      const entry = file[key]
      if (!entry) continue
      // The bare form, as on the landing demo cards.
      const value = slotValue(entry, "tag") ?? slotValue(entry, "heading") ?? slotValue(entry, "prose")
      if (value && value.trim().toLowerCase() !== key) words[key] = value
    }
    cities.push({ lang, lat, lon, dir: meta.dir, words })
  }
  return { terms: TERMS, cities }
}
