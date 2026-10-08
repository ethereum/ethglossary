/**
 * Landing page -- Figma frame 280:232 ("LP, Non-logged in user - Dark"),
 * the 2026 revision of 1:219.
 *
 * Type is transcribed from the frame rather than the named text styles, which
 * the landing page mostly does not use: h1 is Noto Serif Bold 72/80, section
 * headings are Serif Bold 64/72 at -0.64px tracking, the hero lede is Sans
 * Medium 24/32, and section body is Sans 18/26. The sections added in the
 * revision use Tailwind's own scale where a step matches.
 *
 * Two deliberate corrections against the Figma, which is boilerplate on this
 * point: it says "25 languages" and its grid lists Danish, Dutch, Finnish and
 * Cantonese, none of which exist in the data. Both come from the real list.
 *
 * The two demonstrations -- five terms in six languages, and one sentence
 * through /api/v1/filter -- are built from the glossary on every process
 * start (src/lib/landing-demo.ts), not transcribed, so they cannot drift.
 */

import { raw } from "hono/html"
import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import { Icon } from "../icon"
import { ExternalLink } from "../link"
import arrowRight from "lucide-static/icons/arrow-right.svg"
import bookType from "lucide-static/icons/book-type.svg"
import check from "lucide-static/icons/check.svg"
import info from "lucide-static/icons/info.svg"
import messageSquare from "lucide-static/icons/message-square.svg"
import users from "lucide-static/icons/users.svg"
import ethglossary from "../icons/ethglossary.svg"
import glyphMessageBubble from "../icons/glyph-message-bubble.svg"
import glyphPurpleRed from "../icons/glyph-purple-red.svg"
import ethereumOrg from "../icons/ethereum-org.svg"
import banklessAcademy from "../icons/bankless-academy.svg"
import efBlog from "../icons/ef-blog.svg"
import { listLanguages } from "../../lib/language-meta"
import { ETHEREUM_ORG_URL } from "../../lib/constants"
import type { DemoKind, LandingDemo } from "../../lib/landing-demo"
import type { TermRelay } from "../../lib/term-relay"
import LANDING_ISLAND from "../landing/island.js?island"

const CTA_PRIMARY =
  "inline-flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-body font-bold text-primary-foreground no-underline transition-[filter] hover:brightness-110 hover:no-underline"

/** Hero-only: fixed colors, because this sits on the artwork in both themes. */
const CTA_GHOST =
  "inline-flex items-center gap-2 rounded-full border-2 border-white bg-white/10 px-5 py-3 text-body font-bold text-white no-underline backdrop-blur-sm transition-colors hover:bg-white/20 hover:no-underline"

/** 40px, per the card CTAs in the Figma (18:315, 18:324). */
const CTA_OUTLINE_SM =
  "inline-flex h-10 items-center gap-2 self-start rounded-full border border-accent px-6 text-body font-bold text-accent no-underline transition-colors hover:bg-accent/10 hover:no-underline"

/** The panels of the pipeline and API sections: Figma's 28px-radius, 40px-padded cards. */
const PANEL = "min-w-0 rounded-[28px] bg-card p-6 sm:p-10"

/**
 * The speech-bubble mark beside each section heading. Lucide's message-square
 * rather than a hand-rolled border trick, so it matches the rest of the set.
 */
const Bubble = ({ tone }: { tone: string }) => (
  <Icon
    svg={messageSquare}
    class={`icon-stroke-4 mt-1 size-20 shrink-0 -scale-x-100 sm:size-24 lg:size-26 ${tone}`}
  />
)

/**
 * A numbered step marker: the same bubble with its ordinal centered inside.
 * The glyph's tail hangs off the bottom-left, so the digit is nudged up to sit
 * in the middle of the square rather than the middle of the box.
 */
const StepMark = ({ n, tone }: { n: string; tone: string }) => (
  <span class={`relative grid size-10 shrink-0 place-items-center sm:size-[53px] ${tone}`}>
    <Icon svg={messageSquare} class="icon-stroke-2 absolute inset-0 size-full" />
    <span class="relative -mt-1.5 text-h5/6 font-bold tabular-nums">{n}</span>
  </span>
)

/** What each card's verdict means, for the info mark beside it. */
const KIND: Record<DemoKind, { label: string; tip: string }> = {
  kept: {
    label: "Kept in English",
    tip: "The English word is used as is. Borrowed terms like staking and rollup are often better recognised than any translation.",
  },
  transliterated: {
    label: "Transliterated",
    tip: "The English word is spelled out by sound in the language's own script, so it reads naturally while still pointing at the English term.",
  },
  translated: {
    label: "Translated",
    tip: "A native word or phrase with the same meaning stands in for the English term.",
  },
}

/**
 * Which demo panel shows for which radio. Spelled out rather than built from
 * the index, because Tailwind finds class names by scanning source text and
 * cannot see through a template literal.
 */
const PANEL_SHOW = [
  'group-has-[[data-demo="0"]:checked]/demo:grid',
  'group-has-[[data-demo="1"]:checked]/demo:grid',
  'group-has-[[data-demo="2"]:checked]/demo:grid',
  'group-has-[[data-demo="3"]:checked]/demo:grid',
  'group-has-[[data-demo="4"]:checked]/demo:grid',
]

/**
 * JSON with a little colour: keys violet, strings teal, numbers and literals
 * bold, punctuation muted, every pair clearing 4.5:1 on the card in both
 * themes. A tokenizer over JSON.stringify's output rather than a highlighter
 * dependency; the grammar is six token kinds.
 */
const Json = ({ text }: { text: string }) => {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g
  const out: unknown[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      out.push(<span class={m[2] ? "text-violet" : "text-teal"}>{m[1]}</span>)
      if (m[2]) out.push(<span class="text-foreground-subtle">{m[2]}</span>)
    } else if (m[3] !== undefined) out.push(<span class="font-bold text-foreground-strong">{m[3]}</span>)
    else if (m[4] !== undefined) out.push(<span class="font-bold text-foreground-strong">{m[4]}</span>)
    else out.push(<span class="text-foreground-subtle">{m[5]}</span>)
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out as never}</>
}

/** The EthUX audit: extra wallet clicks per hundred when the wallet speaks the reader's language. */
const WALLET_LIFT: Array<[string, number]> = [
  ["Traditional Chinese", 38],
  ["Indonesian", 24],
  ["Arabic", 21],
  ["Japanese", 20],
  ["Ukrainian", 19],
]

export const HomePage = ({
  demo,
  relay,
  activeLang,
  url,
}: {
  demo: LandingDemo
  relay: TermRelay
  activeLang?: string
  url?: PageUrl
}) => {
  const languages = listLanguages()
  const rawJson = JSON.stringify(
    { language: demo.filter.language, matchedTerms: demo.filter.results.length, terms: demo.filter.results },
    null,
    2
  )

  return (
    <Layout
      title="ETHGlossary: Ethereum terms, style guide and translations"
      description="Community-reviewed Ethereum terminology in 24 languages, with an English style guide and a simple API."
      bare
      brand="hero"
      island={LANDING_ISLAND}
      activeLang={activeLang}
      url={url}
    >
      {/* ---------- Hero: frame 280:234, 1440x640 ---------- */}
      <header class="relative overflow-hidden border-b border-border-subtle bg-linear-to-r from-plum-950 to-slate-900">
        {/*
          The community hall (src/ui/landing/community.js) paints into this
          box once the page has loaded and fades it in. Until then, and wherever
          WebGL2 is missing, the header's own gradient (with a violet bloom on
          the right, clear of the copy) is the hero. The island
          dims the scene under the copy itself, and draws the site's dot grid
          behind the hall rather than over it, so there is no CSS overlay here.
        */}
        <div
          class="absolute inset-0 bg-radial-[at_75%_55%] from-violet-400/20 to-transparent to-40%"
          aria-hidden="true"
        />
        <div
          id="hero-scene"
          class="absolute inset-0 opacity-0 transition-opacity duration-1000"
          aria-hidden="true"
        />
        <script type="application/json" id="relay-data">
          {raw(JSON.stringify(relay).replace(/</g, "\\u003c"))}
        </script>

        {/* pt clears the nav, which floats over this section. */}
        <div class="wrap relative flex flex-col justify-center gap-4 pt-32 pb-24 drop-shadow-hero md:min-h-[640px]">
          {/*
            Fixed white/yellow rather than theme tokens: this copy always sits
            on the hero artwork, which is dark in both themes.
          */}
          <h1 class="max-w-4xl font-serif text-h1 font-bold text-balance text-white">
            A shared language for <span class="text-primary">localizing Ethereum</span>
          </h1>
          <p class="max-w-3xl font-medium text-lede text-white">
            ETHGlossary provides community-reviewed Ethereum terminology. Ready to use in{" "}
            {languages.length} languages, verified by native speakers.
          </p>
          <div class="mt-8 flex flex-wrap gap-4">
            <a class={CTA_PRIMARY} href="/style-guide">
              View glossary
            </a>
            <a class={CTA_GHOST} href="/docs">
              Explore the API
              <Icon svg={arrowRight} class="size-4.5" />
            </a>
          </div>
        </div>
      </header>

      {/* ---------- Already in use by: frame 285:7881 ---------- */}
      {/*
        The marks are the partners' own SVGs with their white set to
        currentColor, so the wordmarks follow the theme while the coloured
        emblems stay as drawn.
      */}
      <section class="wrap flex flex-col items-center gap-6 py-10 md:py-12" aria-labelledby="in-use-by">
        <h2 id="in-use-by" class="text-base font-bold text-foreground-subtle">
          Already in use by
        </h2>
        <ul class="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 text-foreground-strong md:gap-x-20">
          {[
            { svg: ethereumOrg, href: ETHEREUM_ORG_URL, label: "ethereum.org" },
            { svg: banklessAcademy, href: "https://app.banklessacademy.com", label: "Bankless Academy" },
            { svg: efBlog, href: "https://blog.ethereum.org", label: "Ethereum Foundation Blog" },
          ].map((p) => (
            <li>
              <ExternalLink
                class="block opacity-90 transition-opacity hover:opacity-100"
                href={p.href}
                hideArrow
                aria-label={p.label}
              >
                <Icon svg={p.svg} class="h-9 md:h-10" />
              </ExternalLink>
            </li>
          ))}
        </ul>
      </section>

      {/*
        The two bubble sections share one vertical wash, edge -> mid -> edge,
        and carry no rules between them. Per the Figma.
      */}
      <div class="bg-linear-to-b from-background via-background-sunken to-background">
      {/* ---------- Dictionary and a style guide: frame 280:3253 ---------- */}
      <section class="wrap relative isolate py-12 md:py-16">
        <div class="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          {/*
            Figma 280:3254 contains the heading AND the body, both inset past
            the bubble -- so the paragraphs align with the h2, not the section
            edge.
          */}
          <div class="flex flex-col gap-8">
            <div class="flex items-start gap-8">
              <Bubble tone="text-rose" />
              <h2 class="max-w-md font-serif text-h2 font-bold text-foreground-strong">
                Dictionary and a style guide
              </h2>
            </div>
            <div class="lg:ps-34">
              <div class="flex max-w-xl flex-col gap-6">
                <p class="text-xl font-bold text-pretty text-foreground-muted">
                  The more projects use the same terminology and explanations, the easier
                  Ethereum becomes to navigate.
                </p>
                <ul class="flex flex-col gap-4 text-xl text-foreground-muted">
                  {[
                    "Canonical terms and clear definitions",
                    "Casing rules, preferred forms and terms to avoid",
                    "Translations with the right form for prose, headings, tags and buttons",
                    "A ruling on when to translate, transliterate or keep the English",
                    "API that finds the terms in your text and returns translations",
                  ].map((item) => (
                    <li class="flex items-start gap-2">
                      <Icon svg={check} class="mt-0.5 size-6 shrink-0 text-violet" />
                      <span class="text-pretty">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div class="relative isolate flex justify-center">
            {/* Decorative, at the right edge, its centre on the globe's bottom edge, behind the rings. */}
            <Icon
              svg={glyphMessageBubble}
              class="pointer-events-none absolute top-full -right-12 -z-10 hidden h-[251px] -translate-y-1/2 opacity-25 xl:block"
            />
            {/*
              The globe (src/ui/landing/globe.js) in the Figma's 302px
              image slot, drawn an eighth larger than it, with a daytime Earth
              in light mode. The canvas overhangs the slot so the atmosphere
              has room: 4rem a side from md, and only as far as the slot's own
              margin below that, so a phone never scrolls sideways.
            */}
            <div class="relative aspect-square w-[calc(100%-3.5rem)] max-w-[302px] shrink-0">
              <div
                data-globe="inset"
                data-lights="/img/earth-night-2016.webp"
                data-relief="/img/earth-relief.webp"
                data-day="/img/earth-day.webp"
                class="absolute -inset-7 touch-pan-y opacity-0 transition-opacity duration-1000 md:-inset-16"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        {/* ---------- Confidence in translations: frame 334:9563 ---------- */}
        {/*
          Five terms as tabs, six languages each. The tabs are radio buttons,
          so the browser owns the selection, the arrow keys, and the focus
          ring; the panels switch with :has() and no script.
        */}
        <div class="group/demo relative isolate mt-16 flex flex-col gap-8 md:mt-20 lg:ps-34 lg:pe-16">
          {/* Decorative, bleeding off the left edge beside the tabs and the first row of cards, behind them. */}
          <Icon
            svg={glyphPurpleRed}
            class="pointer-events-none absolute -top-8 -left-24 -z-10 hidden h-[491px] opacity-25 xl:block"
          />
          <div class="flex flex-col gap-4">
            <h3 class="font-serif text-4xl font-bold tracking-tight text-foreground-strong md:text-5xl">
              Confidence in translations
            </h3>
            <p class="max-w-3xl text-xl text-pretty text-foreground-muted">
              Projects don&rsquo;t need to decide how every crypto term should be translated.
              ETHGlossary does that for you, helping the ecosystem stay consistent.
            </p>
          </div>

          <fieldset class="flex flex-wrap gap-2">
            <legend class="sr-only">Pick a term to see it in six languages</legend>
            {demo.terms.map((t, i) => (
              <label class="cursor-pointer rounded-full px-5 py-2 text-base font-bold text-foreground-muted transition-colors hover:bg-muted has-checked:bg-card has-checked:text-foreground-strong has-focus-visible:outline-2 has-focus-visible:outline-accent">
                <input type="radio" name="demo-term" value={t.key} class="sr-only" data-demo={String(i)} checked={i === 0} />
                {t.term}
              </label>
            ))}
          </fieldset>

          {demo.terms.map((t, i) => (
            <ul class={`hidden gap-4 sm:grid-cols-2 md:grid-cols-3 ${PANEL_SHOW[i] ?? ""}`}>
              {t.cards.map((card) => (
                <li class="flex flex-col gap-6 rounded-[28px] bg-card p-8 lg:p-10">
                  <span class="text-base text-foreground-subtle">{card.name}</span>
                  <span
                    class="font-serif text-3xl font-bold tracking-tight text-balance text-foreground-strong xl:text-4xl"
                    lang={card.lang}
                    dir={card.dir}
                  >
                    {card.value}
                  </span>
                  <span class="mt-auto inline-flex items-center gap-1.5 text-base font-bold text-teal">
                    {KIND[card.kind].label}
                    <button
                      type="button"
                      class="grid place-items-center rounded-full opacity-75 hover:opacity-100"
                      aria-label={`What does ${KIND[card.kind].label} mean?`}
                      aria-expanded="false"
                      data-tip={KIND[card.kind].tip}
                    >
                      <Icon svg={info} class="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>

      </section>

      {/* ---------- How to get started: frame 280:3268 ---------- */}
      <section class="wrap relative py-12 md:py-16">
        <div class="mb-16 flex items-start gap-8">
          <Bubble tone="text-violet" />
          <h2 class="max-w-md font-serif text-h2 font-bold text-foreground-strong">
            How to get started
          </h2>
        </div>

        {/* 556 + 32 gap + 556 in the Figma, inset 128 either side of the shell. */}
        <div class="mx-auto grid max-w-6xl gap-8 md:grid-cols-2">
          <article class="flex flex-col gap-8 rounded-card border-2 border-violet bg-background px-6 py-8 [&>a]:mt-auto">
            <Icon svg={users} class="icon-stroke-2 size-12 text-violet sm:size-16" />
            <div class="flex flex-col gap-2">
              <h3 class="text-h5/6 font-bold text-foreground-strong">Shape Ethereum&rsquo;s language</h3>
              <p class="text-body text-foreground-muted">
                Review terminology, propose better words, and help your language community
                decide how Ethereum should be understood.
              </p>
            </div>
            <a class={CTA_OUTLINE_SM} href="/translations/all">
              Translations
              <Icon svg={arrowRight} class="size-6" />
            </a>
          </article>

          <article class="flex flex-col gap-8 rounded-card border-2 border-teal bg-background px-6 py-8 [&>a]:mt-auto">
            <Icon svg={bookType} class="icon-stroke-2 size-12 text-teal sm:size-16" />
            <div class="flex flex-col gap-2">
              <h3 class="text-h5/6 font-bold text-foreground-strong">Get verified translations</h3>
              <p class="text-body text-foreground-muted">
                Use community-reviewed terminology in your wallet, dapp, docs, localization
                pipeline, or AI workflow.
              </p>
            </div>
            <a class={CTA_OUTLINE_SM} href="/docs">
              Documentation
              <Icon svg={arrowRight} class="size-6" />
            </a>
          </article>
        </div>
      </section>
      </div>

      {/* ---------- ETHGlossary + AI pipeline: frame 418:10041 ---------- */}
      {/*
        The Figma ground here is #0a1126; the sunken background role is the
        theme's nearest step and brings its own light-mode value.
      */}
      <section class="relative overflow-hidden border-y border-border-subtle bg-background-sunken py-16 md:py-24">
        <div class="dot-grid absolute inset-0" aria-hidden="true" />
        <div class="wrap relative flex flex-col items-center gap-10">
          <h2 class="text-center font-serif text-4xl font-bold tracking-tight text-foreground-strong md:text-5xl">
            ETHGlossary <span class="text-blue">+</span> AI pipeline
          </h2>
          <div class="grid w-full max-w-6xl gap-6 md:grid-cols-2 md:gap-8">
            <article class={`${PANEL} flex flex-col`}>
              <p class="font-serif text-8xl font-bold leading-none tracking-tighter text-blue md:text-[11rem] lg:text-[12.5rem]">
                78%
              </p>
              <p class="mt-6 max-w-md font-serif text-3xl font-bold text-balance text-foreground-strong">
                reduction in terminology drift with AI
              </p>
              <ul class="mt-4 flex list-disc flex-col gap-1 ps-6 text-lg text-foreground-muted">
                <li class="text-pretty">
                  <strong class="font-bold text-foreground-strong">With the glossary:</strong> AI
                  translations use the same terms consistently
                </li>
                <li class="text-pretty">
                  <strong class="font-bold text-foreground-strong">Without it:</strong> AI models
                  translate the same term differently across a site
                </li>
              </ul>
            </article>

            <figure class={`${PANEL} flex flex-col justify-between gap-10`}>
              <blockquote class="flex flex-col gap-6 text-2xl font-bold text-balance text-foreground-muted italic">
                <p>&ldquo;Even with AI, scaling to dozens of languages is hard.</p>
                <p>
                  ETHGlossary has been helpful because if you&rsquo;re not a native speaker
                  it&rsquo;s difficult to know which term is the correct one to use.&rdquo;
                </p>
              </blockquote>
              <figcaption class="text-foreground-strong">
                <ExternalLink
                  class="inline-block opacity-90 transition-opacity hover:opacity-100"
                  href="https://app.banklessacademy.com"
                  hideArrow
                  aria-label="Bankless Academy"
                >
                  <Icon svg={banklessAcademy} class="h-10" />
                </ExternalLink>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ---------- How it works + Supported languages: frames 280:3294, 418:14319 ---------- */}
      <section class="wrap bg-background py-12 md:py-16">
        <div class="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div class="flex items-start gap-8">
            <Bubble tone="text-blue" />
            <h2 class="max-w-xs font-serif text-h2 font-bold text-foreground-strong">How it works</h2>
          </div>

          <ol class="flex flex-col gap-8">
            {[
              {
                n: "1",
                tone: "text-violet",
                title: "AI suggests a translation",
                body: "We have tested a lot of models and found what works.",
              },
              {
                n: "2",
                tone: "text-teal",
                title: "The translator community reviews",
                body: "Native speakers and Ethereum contributors discuss terms, propose alternatives, and add the context machines miss.",
              },
              {
                n: "3",
                tone: "text-blue",
                title: "Anyone can use it",
                body: "Reviewed terminology becomes open infrastructure for translators, products, and AI through ETHGlossary's API.",
              },
            ].map((step) => (
              <li class="grid grid-cols-[40px_1fr] items-start gap-4 sm:grid-cols-[53px_1fr] sm:gap-6">
                <StepMark n={step.n} tone={step.tone} />
                <div class="flex flex-col gap-3">
                  <h3 class="font-serif text-h5 font-bold text-foreground-strong">{step.title}</h3>
                  <p class="text-body text-foreground-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/*
          The language list. One run of names that wraps on its own, four
          lines at desktop width; each name is the way into that language.
        */}
        <div class="mt-20 flex flex-col items-center gap-4 text-center md:mt-28">
          <h2 class="font-serif text-4xl font-bold tracking-tight text-foreground-strong">
            Supported languages
          </h2>
          <p class="max-w-xl text-xl text-pretty text-foreground-muted">
            One open foundation that native speakers improve over time.
          </p>
          <ul class="mt-8 flex max-w-5xl flex-wrap justify-center gap-x-8 gap-y-3 font-serif text-2xl text-pretty text-foreground-muted md:gap-x-10 md:text-3xl">
            {languages.map((l) => (
              <li>
                <a
                  class="no-underline transition-colors hover:text-foreground-strong hover:underline"
                  href={`/translations/${l.code}`}
                  lang={l.code}
                  dir={l.dir}
                  title={l.name}
                >
                  {l.endonym}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- Send your text: frame 450:18480 ---------- */}
      <section class="relative overflow-hidden border-y border-border-subtle bg-background-sunken py-16 md:py-24">
        <div class="dot-grid absolute inset-0" aria-hidden="true" />
        <div class="wrap relative flex flex-col items-center gap-8">
          <div class="flex max-w-3xl flex-col items-center gap-6 text-center">
            <h2 class="font-serif text-h2 font-bold text-balance text-foreground-strong">
              Send your text. Get its terms back.
            </h2>
            <p class="max-w-xl text-xl text-pretty text-foreground-muted">
              One call finds every glossary term in your copy and returns the translation to
              use, with a note for the translator.
            </p>
            {/*
              The sentence the demo sends, with the words the glossary knows
              in the stronger colour: those are what comes back.
            */}
            <p class="max-w-2xl font-serif text-2xl font-bold text-balance text-foreground-subtle md:text-3xl">
              &ldquo;
              {demo.filter.content.split(/(\s+)/).map((word) => {
                const bare = word.replace(/[^\p{L}]/gu, "").toLowerCase()
                const hit = demo.filter.results.some((r) => bare === r.english.toLowerCase() || bare.startsWith(r.english.toLowerCase()))
                return hit ? <span class="text-foreground-strong">{word}</span> : word
              })}
              &rdquo;
            </p>
          </div>

          <div class="grid w-full max-w-6xl gap-4 md:grid-cols-[2fr_3fr] md:items-start">
            <figure class={PANEL}>
              <figcaption class="text-base font-bold text-foreground-subtle">You send</figcaption>
              <pre class="mt-6 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                <span class="font-bold text-accent">POST</span> /api/v1/filter{"\n\n"}
                <Json text={JSON.stringify({ content: demo.filter.content, language: demo.filter.language }, null, 2)} />
              </pre>
            </figure>

            <figure class={PANEL}>
              <figcaption class="text-base font-bold text-foreground-subtle">You get back</figcaption>
              <ul class="mt-6 flex flex-col divide-y divide-border-subtle">
                {/*
                  English, arrow, translation on one line; the note under the
                  translation at sm and up, full width on a phone, where a
                  third column would squeeze it to a few words a line.
                */}
                {demo.filter.results.map((r) => (
                  <li class="grid grid-cols-[auto_1rem_1fr] items-baseline gap-x-3 gap-y-1 py-5 first:pt-0 sm:grid-cols-[minmax(5rem,7rem)_1rem_1fr] sm:gap-x-5">
                    <span class="font-serif text-2xl font-bold text-foreground-strong">{r.english}</span>
                    <Icon svg={arrowRight} class="size-4 self-center text-blue" />
                    <span class="font-serif text-2xl font-bold text-foreground-strong" lang={demo.filter.language}>
                      {r.translation}
                    </span>
                    {r.note ? (
                      <span class="col-span-full text-base text-pretty text-foreground-muted sm:col-span-1 sm:col-start-3">{r.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <details class="group/json mt-6">
                <summary class="inline-flex cursor-pointer list-none items-center gap-1.5 text-base font-bold text-accent [&::-webkit-details-marker]:hidden">
                  <span class="inline-block transition-transform group-open/json:rotate-90" aria-hidden="true">
                    &#9656;
                  </span>
                  Show the raw JSON
                </summary>
                <pre class="mt-4 max-h-96 overflow-auto font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                  <Json text={rawJson} />
                </pre>
                <a class="mt-4 inline-flex items-center gap-1.5 text-base font-bold text-accent" href="/docs#tag/filter">
                  Try it with your own text
                  <Icon svg={arrowRight} class="size-4" />
                </a>
              </details>
            </figure>
          </div>
        </div>
      </section>

      {/* ---------- Do readers prefer wallets in their language: frame 280:7679 ---------- */}
      <section class="relative overflow-hidden bg-linear-to-b from-plum-800 via-plum-900 to-plum-950 text-white">
        <div class="wrap relative flex flex-col gap-12 py-20 md:py-28">
          <h2 class="max-w-4xl font-serif text-h2 font-bold text-balance">
            Do readers prefer wallets in their language?
          </h2>
          <div class="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div class="flex flex-col gap-6 text-xl text-white/85 md:text-2xl">
              <p class="text-pretty">
                On ethereum.org, visitors in certain regions clearly prefer apps that speak
                their native language.
              </p>
              <p class="text-pretty">
                Translation is not universally a growth lever. But in the right market, it can
                shape which product gets chosen.
              </p>
              <p class="text-base text-white/85">
                <ExternalLink class="font-bold text-white underline" href="https://ethux.design/report/lost-in-translation.html" hideArrow>
                  Lost in Translation, EthUX
                </ExternalLink>{" "}
                &ndash; Audit of 6 months of ethereum.org wallet clicks
              </p>
            </div>

            {/*
              A bar per language, proportional to its lift, the longest
              filling the column. A list, so it reads in order without the
              bars.
            */}
            <ul class="flex flex-col gap-2 self-center" aria-label="Extra wallet clicks per hundred when the wallet is in the reader's language">
              {WALLET_LIFT.map(([name, lift]) => (
                <li class="flex flex-col gap-1">
                  <span class="text-base text-white/80">{name}</span>
                  <span class="flex items-center gap-3 pe-14">
                    <span
                      class="h-7 rounded-e bg-teal-400"
                      style={`width:${Math.round((lift / WALLET_LIFT[0][1]) * 100)}%`}
                      aria-hidden="true"
                    />
                    <span class="shrink-0 font-serif text-2xl font-bold tabular-nums">+{lift}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Icon svg={ethglossary} class="pointer-events-none absolute top-16 right-8 hidden h-45 opacity-15 xl:block" />
      </section>
    </Layout>
  )
}
