/**
 * Landing page -- Figma frame 1:219 ("LP, Non-logged in user").
 *
 * Type is transcribed from the frame rather than the named text styles, which
 * the landing page mostly does not use: h1 is Noto Serif Bold 72/80, section
 * headings are Serif Bold 64/72 at -0.64px tracking, the hero lede is Sans
 * Medium 24/32, and section body is Sans 18/26.
 *
 * Two deliberate corrections against the Figma, which is boilerplate on this
 * point: it says "25 languages" and its grid lists Danish, Dutch, Finnish and
 * Cantonese, none of which exist in the data. Both come from the real list.
 */

import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import { Icon } from "../icon"
import arrowRight from "lucide-static/icons/arrow-right.svg"
import bookType from "lucide-static/icons/book-type.svg"
import messageSquare from "lucide-static/icons/message-square.svg"
import users from "lucide-static/icons/users.svg"
import ethglossary from "../icons/ethglossary.svg"
import glyphMessageBubble from "../icons/glyph-message-bubble.svg"
import glyphPurpleRed from "../icons/glyph-purple-red.svg"
import { listLanguages } from "../../lib/language-meta"

const CTA_PRIMARY =
  "inline-flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-body font-bold text-primary-foreground no-underline transition-[filter] hover:brightness-110 hover:no-underline"

/** Hero-only: fixed colors, because this sits on the artwork in both themes. */
const CTA_GHOST =
  "inline-flex items-center gap-2 rounded-full border-2 border-white bg-white/10 px-5 py-3 text-body font-bold text-white no-underline backdrop-blur-sm transition-colors hover:bg-white/20 hover:no-underline"

/** 40px, per the card CTAs in the Figma (18:315, 18:324). */
const CTA_OUTLINE_SM =
  "inline-flex h-10 items-center gap-2 self-start rounded-full border border-accent px-6 text-body font-bold text-accent no-underline transition-colors hover:bg-accent/10 hover:no-underline"

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

export const HomePage = ({ activeLang, url }: { activeLang?: string; url?: PageUrl }) => {
  const languages = listLanguages()

  return (
    <Layout
      title="ETHGlossary: Ethereum terms, style guide and translations"
      description="Community-reviewed Ethereum terminology in 24 languages, with an English style guide and a simple API."
      bare
      brand="hero"
      activeLang={activeLang}
      url={url}
    >
      {/* ---------- Hero: frame 1:390, 1440x640 ---------- */}
      <header class="relative overflow-hidden border-b border-border-subtle bg-slate-900">
        {/*
          The artwork sits at 60% over a fixed dark ground rather than having
          that opacity baked into the file, so the hero reads identically in
          both themes and the source PNG stays untouched.
        */}
        <img
          src="/img/ethglossary-hero.png"
          alt=""
          class="absolute inset-0 size-full object-cover object-right opacity-60"
          width="1440"
          height="640"
          fetchpriority="high"
        />
        <div class="dot-grid-fixed absolute inset-0" aria-hidden="true" />

        {/* pt clears the nav, which floats over this section. */}
        <div class="wrap relative flex flex-col justify-center gap-4 pt-32 pb-24 drop-shadow-hero md:min-h-[640px]">
          {/*
            Fixed white/yellow rather than theme tokens: this copy always sits
            on the hero artwork, which is dark in both themes.
          */}
          <h1 class="font-serif text-h1 font-bold text-white">
            A shared language for <span class="block text-primary">Ethereum</span>
          </h1>
          <p class="max-w-3xl font-medium text-lede text-white">
            ETHGlossary gives apps and the wider ecosystem community-reviewed Ethereum
            terminology. Ready to use in {languages.length} languages through a simple API.
          </p>
          <div class="mt-8 flex flex-wrap gap-4">
            {/*
              A browse action, not a sign-up. Contributing needs an account
              that does not exist yet, so the hero sends a first-time visitor
              to the thing itself rather than to a control that can only
              apologise.
            */}
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

      {/*
        The three bubble sections share one vertical wash, edge -> mid -> edge,
        and carry no rules between them. Per the Figma.
      */}
      <div class="bg-linear-to-b from-background via-background-sunken to-background">
      {/* ---------- What is ETHGlossary ---------- */}
      <section class="wrap relative py-12 md:py-16">
        <div class="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          {/*
            Figma 1:225 contains the heading AND the body, both inset past the
            bubble -- so the paragraphs align with the h2, not the section edge.
          */}
          <div class="flex items-start gap-8">
            <Bubble tone="text-rose" />
            <div class="flex flex-col gap-8">
              <h2 class="max-w-md font-serif text-h2 font-bold text-foreground-strong">
                What is ETHGlossary?
              </h2>
              <div class="flex max-w-xl flex-col gap-6 text-body-lg text-foreground-muted">
              <p class="font-medium">Ethereum is global. Its language should be too.</p>
              <p class="font-medium">
                ETHGlossary is an open, multilingual glossary for Ethereum: a shared place
                to{" "}
                <strong class="font-bold text-foreground-strong">
                  define concepts, review translations, and make the best available
                  language reusable
                </strong>{" "}
                across the ecosystem.
              </p>
                <p>
                  Used and optimized for years by{" "}
                  <strong class="font-bold text-foreground-strong">ethereum.org</strong>.
                </p>
              </div>
            </div>
          </div>

          <div class="flex justify-center">
            {/*
              302px image inside two concentric rings: the first 1rem beyond
              the image radius, the second another 0.5rem beyond that.
            */}
            {/*
              The rings sit outside the image box, so the container has to
              leave room for them or the outer one clears a narrow viewport.
              Figma 1:232/1:233: +21.5px then +7px on a 302px image.
            */}
            <div class="relative grid aspect-square w-[calc(100%-3.5rem)] max-w-[302px] shrink-0 place-items-center">
              <span
                class="absolute -inset-5 rounded-full border border-accent"
                aria-hidden="true"
              />
              <span
                class="absolute -inset-7 rounded-full border border-accent"
                aria-hidden="true"
              />
              <img
                src="/img/globe-dining-room.png"
                alt=""
                width="302"
                height="302"
                loading="lazy"
                class="size-full rounded-full object-cover"
              />
            </div>

          </div>
        </div>

        {/* Floats past the section edge on the right, between this and the next. */}
        <Icon svg={glyphMessageBubble} class="h-[251px] pointer-events-none absolute right-0 -bottom-24 hidden opacity-25 xl:block" />
      </section>

      {/* ---------- How to get started ---------- */}
      <section class="wrap relative py-12 md:py-16">
        {/*
          Straddles the boundary into "How it works", so it sits between that
          section's bubble and this one's. Non-space-occupying, bleeding off
          the left edge.
        */}
        <Icon
          svg={glyphPurpleRed}
          class="pointer-events-none absolute -bottom-64 -left-24 hidden h-[491px] opacity-25 xl:block"
        />
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

      {/* ---------- How it works ---------- */}
      <section class="wrap py-12 md:py-16">
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
      </section>
      </div>

      {/* ---------- Language grid ---------- */}
      <section class="relative overflow-hidden border-y border-border-subtle bg-card py-16 md:py-32">
        <div class="dot-grid absolute inset-0" aria-hidden="true" />
        <div class="wrap relative">
          <h2 class="mb-8 text-center font-serif text-h2-sm font-bold text-foreground-strong">
            Translation languages
          </h2>
          <div class="mx-auto grid max-w-[980px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {languages.map((l) => (
              <a
                class="flex flex-col gap-0.5 rounded-xl border border-border bg-background/50 p-4 no-underline transition-colors hover:border-teal hover:no-underline"
                href={`/translations/${l.code}`}
              >
                <span class="flex flex-wrap items-end gap-2">
                  <span class="font-serif text-h4 font-bold text-foreground-strong" lang={l.code} dir={l.dir}>
                    {l.endonym}
                  </span>
                  <span class="font-serif text-label-sm text-foreground-muted">{l.name}</span>
                </span>
                <span class="truncate text-tiny text-foreground-subtle">{l.regions}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Closing ---------- */}
      <section class="relative overflow-hidden bg-linear-to-b from-plum-800 via-plum-900 to-plum-950 text-white">
        <div class="wrap relative flex items-center gap-12 py-20">
          <div class="flex flex-col gap-8">
            <h2 class="max-w-4xl font-serif text-h2 font-bold">
              Translation needs more than fluent text
            </h2>
            <p class="max-w-xl text-body-lg text-white/85">
              Machine translation produces text that looks right, but if you don&rsquo;t
              have a native speaker on the team then nobody can actually tell if it is
              correct.
            </p>
            <p class="max-w-xl text-body-lg text-white/85">
              ETHGlossary adds the Ethereum-specific context that helps translators and
              products use terms consistently, clearly, and with confidence.
            </p>
          </div>

          <Icon svg={ethglossary} class="h-45 ml-auto hidden shrink-0 opacity-15 lg:block" />
        </div>
      </section>
    </Layout>
  )
}
