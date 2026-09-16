/**
 * Viewer routes -- the human-facing site.
 *
 * Replaces the single inline-HTML template with server-rendered hono/jsx
 * pages. Everything here reads the bundled glossary directly rather than
 * fetching its own API, which saves a request hop and keeps the pages
 * renderable even if the API surface changes shape.
 */

import { OpenAPIHono } from "@hono/zod-openapi"

import { HomePage } from "../ui/pages/home"
import { TranslatePage } from "../ui/pages/translate"
import type { TermListItem } from "../ui/pages/translate"
import { ContextsPage } from "../ui/pages/contexts"
import { LanguagesPage } from "../ui/pages/languages"
import type { LanguageStat } from "../ui/pages/languages"
import { StyleGuidePage, TermDetailPage } from "../ui/pages/style-guide"
import { NotFoundPage } from "../ui/pages/not-found"
import { ComparePage } from "../ui/pages/compare"
import type { CompareRow } from "../ui/pages/compare"
import {
  computeLanguageStats,
  getTerms,
  loadTranslations,
  resolveTerm,
  SUPPORTED_LANGUAGES,
} from "../lib/glossary-data"
import { getLanguageMeta } from "../lib/language-meta"
import type { TranslationEntry } from "../lib/glossary-data"
import { CONTEXT_TYPES, EXEMPLAR_KEY, applicableContexts, slotValue } from "../lib/context-types"
import type { ContextId } from "../lib/context-types"
import { languageFromCookie } from "../lib/negotiate-language"
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "../lib/constants"
import type { PageUrl } from "../ui/layout"
import { requestOrigin } from "../lib/request-origin"
import type { OriginRequest } from "../lib/request-origin"
import ethglossaryMark from "../ui/icons/ethglossary.svg"

const app = new OpenAPIHono()

/**
 * Remember the language a reviewer is actually looking at, so /translate and
 * the next visit land there. Set on the page rather than by a picker script,
 * because reaching a language is now a plain link from the Languages tab.
 */
function rememberLanguage(c: { header: (k: string, v: string) => void }, lang: string) {
  c.header(
    "Set-Cookie",
    `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`
  )
}

/** The language on the nav's Translate tab, if one has been chosen. */
const navLang = (c: { req: { header: (k: string) => string | undefined } }) =>
  languageFromCookie(c.req.header("Cookie"))

/**
 * Origin and path for the canonical link and share card.
 *
 * Read off the request every time rather than stored in a constant -- the
 * site has answered on a workers.dev host and on glossary.ethereum.org, and a
 * share card has to name whichever host the visitor actually reached. The
 * scheme comes from the proxy's forwarded header; see src/lib/request-origin.ts.
 * Query strings are dropped: ?category= is a filter, not a separate page.
 */
const pageUrl = (c: { req: OriginRequest }): PageUrl => ({
  origin: requestOrigin(c.req),
  path: new URL(c.req.url).pathname,
})

/** Master terms sorted for display, with their canonical key kept alongside. */
function sortedTerms() {
  return Object.entries(getTerms())
    .map(([key, term]) => ({ key, ...term }))
    .sort((a, b) => a.term.localeCompare(b.term))
}

// The stylesheet is a build artifact served from public/assets by the
// Workers assets binding, not a route -- see scripts in package.json.

// The favicon is the same vector file the nav renders, served rather than
// copied into public/ so there is one source of truth for the mark.
app.get("/favicon.svg", (c) => {
  c.header("Content-Type", "image/svg+xml; charset=utf-8")
  c.header("Cache-Control", "public, max-age=604800, immutable")
  return c.body(ethglossaryMark)
})

// ---------------------------------------------------------------- pages

app.get("/", (c) => c.html(<HomePage activeLang={navLang(c)} url={pageUrl(c)} />))

app.get("/contexts", async (c) => {
  // The example rows come from the live glossary rather than being authored,
  // so the page cannot drift from the data it is explaining.
  const [es, ru] = await Promise.all([loadTranslations("es"), loadTranslations("ru")])
  const esEntry = es[EXEMPLAR_KEY]
  const ruEntry = ru[EXEMPLAR_KEY]

  /*
   * slotValue() serializes plurals for hashing, which is not readable prose.
   * The lesson of that row is how many CLDR categories a language marks --
   * Spanish two, Russian five -- so show the count and the distinct forms.
   */
  const readable = (entry: TranslationEntry | undefined, id: ContextId) => {
    if (!entry) return null
    if (id !== "plurals") return slotValue(entry, id)
    const forms = Object.values(entry.plurals ?? {}).filter(Boolean) as string[]
    if (!forms.length) return null
    const marked = Object.values(entry.plurals ?? {}).filter(Boolean).length
    return `${marked} forms: ${[...new Set(forms)].join(", ")}`
  }

  const rows: Record<string, { es: string; ru: string }> = {}
  for (const { id } of CONTEXT_TYPES) {
    const a = readable(esEntry, id)
    const b = readable(ruEntry, id)
    if (a || b) rows[id] = { es: a ?? "--", ru: b ?? "--" }
  }

  return c.html(
    <ContextsPage
      activeLang={navLang(c)}
      url={pageUrl(c)}
      exemplar={{
        term: getTerms()[EXEMPLAR_KEY]?.term ?? EXEMPLAR_KEY,
        rows,
        transliteration: ruEntry?.transliteration ?? undefined,
      }}
    />
  )
})

/*
 * The picker. What used to be /languages.
 *
 * Choosing a language and reviewing one were two tabs pointing at one task;
 * they are now one section. /translations picks, /translations/:lang works,
 * /translations/all compares. The old paths redirect at the bottom of this
 * file.
 */
app.get("/translations", async (c) => {
  const stats = await Promise.all(SUPPORTED_LANGUAGES.map(computeLanguageStats))

  const notice =
    c.req.query("changed") === "1"
      ? "changed"
      : c.req.query("choose") === "1"
        ? "choose"
        : undefined

  return c.html(
    <LanguagesPage stats={stats} notice={notice} activeLang={navLang(c)} url={pageUrl(c)} />
  )
})

app.get("/style-guide", (c) => {
  const category = c.req.query("category")
  const all = sortedTerms()
  const categories = Array.from(new Set(all.map((t) => t.category))).sort()
  const terms = category ? all.filter((t) => t.category === category) : all

  return c.html(
    <StyleGuidePage
      terms={terms}
      categories={categories}
      activeCategory={category}
      activeLang={navLang(c)}
      url={pageUrl(c)}
    />
  )
})

app.get("/style-guide/:termId", async (c) => {
  const term = resolveTerm(c.req.param("termId"))
  if (!term) return c.notFound()

  return c.html(
    <TermDetailPage
      term={term}
      translations={await proseByLanguage(term.id)}
      activeLang={navLang(c)}
      url={pageUrl(c)}
    />
  )
})

/**
 * The prose form of one term in every language.
 *
 * Prose is the slot the others are derived from, so it is the one worth
 * showing on the English reference page. The full six-context grid lives at
 * /translate/all/:termId.
 */
async function proseByLanguage(id: string): Promise<Array<{ code: string; prose: string | null }>> {
  const master = getTerms()
  const key = Object.keys(master).find((k) => master[k].id === id)
  if (!key) return []

  const files = await Promise.all(SUPPORTED_LANGUAGES.map(loadTranslations))
  return SUPPORTED_LANGUAGES.map((code, i) => ({
    code,
    prose: files[i][key] ? slotValue(files[i][key], "prose") : null,
  }))
}

/** Forget the stored language and go back to the picker. */
app.get("/translations/change", (c) => {
  c.header("Set-Cookie", `${LANG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`)
  return c.redirect("/translations?changed=1", 302)
})

/*
 * The all-languages view. Read-only by construction: feedback is always cast
 * against one language, so there is nothing to vote on here.
 *
 * Registered before /translations/:lang so "all" is not read as a language.
 */
app.get("/translations/all", (c) =>
  c.html(<ComparePage terms={compareTermList()} activeLang={navLang(c)} url={pageUrl(c)} />)
)

app.get("/translations/all/:termId", async (c) => {
  const term = resolveTerm(c.req.param("termId"))
  if (!term) return c.notFound()

  const master = getTerms()
  const key = Object.keys(master).find((k) => master[k].id === term.id)
  if (!key) return c.notFound()

  // All 24 files. The same load /languages already does, and they are cached
  // in module scope after the first request.
  const files = await Promise.all(SUPPORTED_LANGUAGES.map(loadTranslations))

  const present = new Set<ContextId>()
  const rows: CompareRow[] = SUPPORTED_LANGUAGES.map((code, i) => {
    const entry = files[i][key]
    const values: CompareRow["values"] = {}

    let pluralCount: number | undefined

    for (const id of entry ? applicableContexts(entry) : []) {
      present.add(id)
      if (id === "plurals") {
        const forms = pluralForms(entry)
        pluralCount = forms.length
        // Distinct only: many languages repeat the same string across
        // categories, and listing it five times reads as a rendering bug.
        values[id] = [...new Set(forms)].join(", ")
      } else {
        values[id] = slotValue(entry, id)
      }
    }

    return { code, values, pluralCount }
  })

  // Canonical order, not the order languages happened to fill them in.
  const contexts = CONTEXT_TYPES.map((t) => t.id).filter((id) => present.has(id))

  return c.html(
    <ComparePage
      terms={compareTermList()}
      selected={term}
      rows={rows}
      contexts={contexts}
      activeLang={navLang(c)}
      url={pageUrl(c)}
    />
  )
})

/** Every populated CLDR plural form, categories included, in file order. */
function pluralForms(entry: TranslationEntry): string[] {
  return Object.values(entry.plurals ?? {}).filter(Boolean) as string[]
}

/** Every master term, for the compare picker -- not filtered by language. */
function compareTermList(): TermListItem[] {
  return sortedTerms().map((t) => ({
    key: t.key,
    id: t.id,
    term: t.term,
    progress: "none" as const,
  }))
}

app.get("/translations/:lang", async (c) => {
  const lang = c.req.param("lang")
  if (!getLanguageMeta(lang)) return c.notFound()

  const terms = await buildTermList(lang)
  rememberLanguage(c, lang)
  return c.html(<TranslatePage lang={lang} terms={terms} url={pageUrl(c)} />)
})

app.get("/translations/:lang/:termId", async (c) => {
  const lang = c.req.param("lang")
  if (!getLanguageMeta(lang)) return c.notFound()

  const term = resolveTerm(c.req.param("termId"))
  if (!term) return c.notFound()

  // Translation files are keyed by canonical term name, never by the id slug.
  const master = getTerms()
  const key = Object.keys(master).find((k) => master[k].id === term.id)
  if (!key) return c.notFound()

  const translations = await loadTranslations(lang)
  const terms = await buildTermList(lang)

  rememberLanguage(c, lang)

  const index = terms.findIndex((t) => t.key === key)
  const prevTermId = index > 0 ? terms[index - 1].id : undefined
  const nextTermId = index >= 0 && index < terms.length - 1 ? terms[index + 1].id : undefined

  return c.html(
    <TranslatePage
      lang={lang}
      terms={terms}
      selected={{ key, term, translation: translations[key] }}
      prevTermId={prevTermId}
      nextTermId={nextTermId}
      url={pageUrl(c)}
    />
  )
})

// ------------------------------------------------------ legacy redirects

/*
 * /languages and /translate were the shape before /translations.
 *
 * 301 rather than 302: the old paths are gone for good, and the site has been
 * deployed under them -- a permanent redirect is what tells a crawler to move
 * its index across rather than keep both. Registered after the real routes so
 * they can never shadow one.
 */
type Params = Record<string, string | undefined>

const MOVED: Array<[string, (p: Params) => string]> = [
  ["/languages", () => "/translations"],
  ["/translate", () => "/translations/all"],
  ["/translate/change", () => "/translations/change"],
  ["/translate/all", () => "/translations/all"],
  ["/translate/all/:termId", (p) => `/translations/all/${p.termId}`],
  ["/translate/:lang", (p) => `/translations/${p.lang}`],
  ["/translate/:lang/:termId", (p) => `/translations/${p.lang}/${p.termId}`],
]

for (const [from, to] of MOVED) {
  app.get(from, (c) => c.redirect(to(c.req.param() as Params) + new URL(c.req.url).search, 301))
}

// ------------------------------------------------------- crawler surface

/**
 * Everything is public, so nothing is disallowed.
 *
 * `/docs` is the Scalar reference, which is a client-rendered SPA -- crawlers
 * get an empty shell from it, so it is listed here but not in the sitemap.
 */
app.get("/robots.txt", (c) => {
  const { origin } = pageUrl(c)
  c.header("Cache-Control", "public, max-age=86400")
  return c.text(["User-agent: *", "Allow: /", "", `Sitemap: ${origin}/sitemap.xml`].join("\n"))
})

/**
 * Every page the site actually serves.
 *
 * That is 24 languages x 532 terms for /translate alone, which would be an
 * 13,000-URL sitemap of pages that are all near-duplicates of each other. So
 * the term-level URLs are listed for the style guide (one canonical page per
 * term, in English) and only the language index pages for /translations. The
 * per-term translation pages stay crawlable -- they are linked from those
 * indexes -- they are just not enumerated here.
 */
app.get("/sitemap.xml", (c) => {
  const { origin } = pageUrl(c)

  const urls = [
    { loc: "/", priority: "1.0" },
    { loc: "/style-guide", priority: "0.9" },
    { loc: "/translations", priority: "0.8" },
    { loc: "/translations/all", priority: "0.6" },
    { loc: "/contexts", priority: "0.6" },
    ...SUPPORTED_LANGUAGES.map((lang) => ({ loc: `/translations/${lang}`, priority: "0.7" })),
    ...sortedTerms().map((t) => ({ loc: `/style-guide/${t.id}`, priority: "0.5" })),
  ]

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${origin}${encodeURI(u.loc)}</loc><priority>${u.priority}</priority></url>`
    ),
    "</urlset>",
  ].join("\n")

  c.header("Content-Type", "application/xml; charset=utf-8")
  c.header("Cache-Control", "public, max-age=86400")
  return c.body(body)
})

// ------------------------------------------------------------------ 404

/**
 * Registered on the root app in `src/index.ts`, because Hono only ever calls
 * the top-level handler -- a `notFound` on this sub-app would never fire.
 *
 * API paths keep their JSON shape. Everything else gets the themed page, so a
 * mistyped term id lands somewhere with navigation rather than on bare text.
 */
export const notFoundHandler = (c: Parameters<Parameters<typeof app.notFound>[0]>[0]) => {
  const { pathname } = new URL(c.req.url)

  if (pathname.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404)
  }

  return c.html(
    <NotFoundPage
      path={pathname}
      activeLang={navLang(c)}
      url={pageUrl(c)}
      suggestions={suggestTerms(pathname)}
    />,
    404
  )
}

/**
 * Terms whose name overlaps the last path segment.
 *
 * Substring both ways rather than an edit distance: the common miss is a
 * partial or pluralized slug ("gas-fees" for "gas fee"), which prefix matching
 * catches and which a Levenshtein threshold tuned for typos would not.
 */
function suggestTerms(pathname: string): Array<{ id: string; term: string }> {
  const slug = pathname.split("/").filter(Boolean).pop()
  if (!slug) return []

  const query = decodeURIComponent(slug).replace(/-/g, " ").toLowerCase()
  if (query.length < 3) return []

  return Object.values(getTerms())
    .filter((t) => {
      const name = t.term.toLowerCase()
      return name.includes(query) || query.includes(name)
    })
    .slice(0, 5)
    .map((t) => ({ id: t.id, term: t.term }))
}

/**
 * The sidebar list for one language -- every term we have a translation for.
 *
 * Progress is uniformly "none" until votes exist (Phase 3). The shape is in
 * place so wiring it up later is a data change, not a template change.
 */
async function buildTermList(lang: string): Promise<TermListItem[]> {
  const translations = await loadTranslations(lang)

  return sortedTerms()
    .filter((t) => translations[t.key])
    .map((t) => ({ key: t.key, id: t.id, term: t.term, progress: "none" as const }))
}

export default app
