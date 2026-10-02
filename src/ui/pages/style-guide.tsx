/**
 * English style guide -- the authoritative "how do I write this term?" view.
 *
 * Renders the master term list with casing, avoid forms and aliases. This is
 * the surface content authors use; translators use /translate instead.
 */

import { raw } from "hono/html"
import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import { Icon } from "../icon"
import arrowRight from "lucide-static/icons/arrow-right.svg"
import info from "lucide-static/icons/info.svg"
import { sanitizeDefinition, definitionToText } from "../../lib/sanitize"
import { TERM_FILTER_ISLAND } from "../islands"
import { CONTEXT_BY_ID } from "../../lib/context-types"
import { ExternalLink } from "../link"
import { listLanguages } from "../../lib/language-meta"
import type { GlossaryTerm } from "../../lib/glossary-data"
import {
  DefinitionVotes,
  OFF_STYLE_GUIDE_FEEDBACK,
  OpenFeedback,
  STYLE_GUIDE_FEEDBACK_ISLAND,
  SuggestChangesButton,
  SuggestChangesDialog,
} from "../style-guide-feedback"
import type { StyleGuideFeedback } from "../style-guide-feedback"
import { WithdrawDialog, WITHDRAW_ISLAND } from "../withdraw"
import { TermFlagDialogs, TermFlags } from "../term-flags"
import { CATEGORY_MEANING, casingMeaning, scriptRuleMeaning } from "../term-meta"

const aliasText = (a: string | { term: string; status: string }): string =>
  typeof a === "string" ? a : a.term

const CELL = "border-b border-border-subtle px-3.5 py-2.5 text-left align-top"

/*
 * Whole-row link. A row holding exactly one link makes the entire row the
 * target; `data-row-link` is what src/ui/row-link.ts looks for. `group` is
 * how the link picks up the row's hover, since the pointer is no longer
 * literally over it.
 */
const HEAD = `${CELL} whitespace-nowrap bg-card text-tiny font-bold text-foreground-subtle`
const ROW = "group cursor-pointer hover:bg-card"
const ROW_LINK = "no-underline group-hover:underline"
/*
 * Pills. `whitespace-nowrap` because a chip that wraps stops reading as one
 * token -- "accounts-keys" broke across two lines in the Category column and
 * looked like two tags.
 */
const CHIP_BASE = "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-tiny"
const CHIP = `${CHIP_BASE} bg-muted text-foreground-subtle`
const CHIP_AVOID = `${CHIP_BASE} bg-rose/15 text-rose`
const CHIP_ACTIVE = `${CHIP_BASE} bg-teal/15 text-teal`

/*
 * A metadata chip that says what it is and explains itself on click: "Casing
 * fixed" rather than a bare "fixed", with the meaning in the popover. A
 * button, so it is reachable and announces as expandable.
 */
const MetaChip = ({ kind, value, tip }: { kind: string; value: string; tip: string }) => (
  <button
    type="button"
    class={`${CHIP} inline-flex cursor-pointer items-center gap-1 hover:bg-muted/70 hover:text-foreground`}
    data-tip-title={value}
    data-tip={tip}
    aria-expanded="false"
    aria-label={`${kind} ${value}: what does this mean?`}
  >
    <span class="opacity-70">{kind}</span>
    <span class="font-bold">{value}</span>
    <Icon svg={info} class="size-4 opacity-70" />
  </button>
)

export const StyleGuidePage = ({
  terms,
  categories,
  activeCategory,
  activeLang,
  url,
}: {
  terms: Array<GlossaryTerm & { key: string }>
  categories: string[]
  activeCategory?: string
  activeLang?: string
  url?: PageUrl
}) => (
  <Layout
    title="Style guide -- ETHGlossary"
    description="Canonical English spelling, casing and usage for Ethereum terminology."
    nav="style-guide"
    activeLang={activeLang}
    url={url}
    island={TERM_FILTER_ISLAND}
  >
    <div class="flex max-w-prose flex-col gap-3 pt-10 pb-5">
      <p class="text-body font-bold text-foreground-subtle">English</p>
      <h1 class="font-serif text-h3 font-medium text-foreground-strong">Style guide</h1>
      <p class="text-body text-foreground-muted">
        The canonical written form of {terms.length} Ethereum terms &mdash; how each one is
        spelled and capitalized, which forms to avoid, and what it means.
      </p>
    </div>

    {/*
      Filters the rendered table, same as the translate sidebar. Not its own
      route: there is nothing to fetch, every term is already on the page.
    */}
    <div class="mb-4 max-w-sm">
      <label class="sr-only" for="term-search">
        Filter terms
      </label>
      <input
        type="search"
        id="term-search"
        class="w-full rounded-sm border border-input bg-transparent p-2 text-tiny/6 text-foreground placeholder:text-foreground-muted focus:border-accent"
        placeholder="Filter terms..."
        autocomplete="off"
      />
    </div>

    <div class="mb-5 flex flex-wrap gap-2">
      <a
        class={`no-underline ${!activeCategory ? CHIP_ACTIVE : CHIP}`}
        href="/style-guide"
      >
        All
      </a>
      {categories.map((c) => (
        <a
          class={`no-underline ${activeCategory === c ? CHIP_ACTIVE : CHIP}`}
          href={`/style-guide?category=${encodeURIComponent(c)}`}
        >
          {c}
        </a>
      ))}
    </div>

    <div class="overflow-x-auto rounded-card border border-border-subtle">
      <table class="w-full border-collapse text-label-md">
        <thead>
          <tr>
            {["Term", "Category", "Casing", "Avoid", "Also known as"].map((h) => (
              <th
                scope="col"
                class={`${HEAD} sticky top-0`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody id="term-list">
          {terms.map((t) => (
            <tr class={ROW} data-row-link>
              <td class={CELL}>
                <a
                  class={`${ROW_LINK} font-bold text-foreground-strong`}
                  href={`/style-guide/${t.id}`}
                  data-term={t.term.toLowerCase()}
                >
                  {t.term}
                </a>
              </td>
              <td class={CELL}>
                <span class={CHIP}>{t.category}</span>
              </td>
              <td class={`${CELL} whitespace-nowrap`}>{t.casing}</td>
              <td class={CELL}>
                <span class="flex flex-wrap gap-1">
                  {(t.avoid ?? []).slice(0, 3).map((a) => (
                    <span class={CHIP_AVOID}>{a}</span>
                  ))}
                </span>
              </td>
              <td class={`${CELL} text-foreground-subtle`}>
                {(t.aliases ?? []).slice(0, 3).map(aliasText).filter(Boolean).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <p class="mt-2.5 mb-14 text-tiny text-foreground-subtle">
      <span id="term-count">{terms.length}</span> terms
    </p>
  </Layout>
)

export const TermDetailPage = ({
  term,
  translations = [],
  feedback = OFF_STYLE_GUIDE_FEEDBACK,
  activeLang,
  url,
}: {
  term: GlossaryTerm
  /** The prose form in every language, in the order languages are listed. */
  translations?: Array<{ code: string; prose: string | null }>
  feedback?: StyleGuideFeedback
  activeLang?: string
  url?: PageUrl
}) => (
  <Layout
    title={`${term.term} -- ETHGlossary style guide`}
    description={definitionToText(term.definition).slice(0, 155) || term.term}
    nav="style-guide"
    activeLang={activeLang}
    url={url}
    island={feedback.mode === "live" ? STYLE_GUIDE_FEEDBACK_ISLAND + WITHDRAW_ISLAND : undefined}
  >
    <div
      class="flex max-w-prose flex-col gap-8 pt-10 pb-14"
      data-sg-feedback={feedback.mode}
      data-term-id={term.id}
      data-term-hash={feedback.termHash}
      data-signin={feedback.signinHref}
    >
      <div class="flex flex-col gap-3">
        <p class="text-body font-bold text-foreground-subtle">
          <a class="no-underline hover:underline" href="/style-guide">
            Style guide
          </a>
        </p>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h1 class="font-serif text-h3 font-medium text-foreground-strong">{term.term}</h1>
          <SuggestChangesButton feedback={feedback} />
        </div>
        <div class="flex flex-wrap gap-2">
          <MetaChip kind="Category" value={term.category} tip={CATEGORY_MEANING} />
          <MetaChip kind="Casing" value={term.casing} tip={casingMeaning(term.casing)} />
          {term.script_rule ? <MetaChip kind="Script" value={term.script_rule} tip={scriptRuleMeaning(term.script_rule)} /> : null}
        </div>
      </div>

      {term.definition ? (
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-4">
            <p class="text-body font-bold text-foreground-subtle">Definition</p>
            <DefinitionVotes feedback={feedback} />
          </div>
          <div class="definition-html rounded-md bg-card px-4 py-4 text-body">
            {raw(sanitizeDefinition(term.definition))}
          </div>
        </div>
      ) : null}
      <TermFlags mode={feedback.mode} signinHref={feedback.signinHref} />
      {/* Where the islands report: outside the definition block, so a term without one still shows its messages. */}
      <p id="feedback-status" role="status" class="text-label-md" hidden></p>

      {/*
        Directly under the definition, because that is what these came out of.
        Definitions used to carry the links inline; they now hold prose only,
        and anything worth reading further sits here as its own section.
      */}
      {term.references?.length ? (
        <div class="flex flex-col gap-3">
          <p class="text-body font-bold text-foreground-subtle">Further reading</p>
          <ul class="flex flex-col gap-2">
            {term.references.map((r) => (
              <li>
                <ExternalLink
                  class="inline-flex items-baseline gap-1.5 text-body text-accent no-underline hover:underline"
                  href={r.url}
                >
                  {r.label}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {term.avoid?.length ? (
        <div class="flex flex-col gap-3">
          <p class="text-body font-bold text-foreground-subtle">Forms to avoid</p>
          <div class="flex flex-wrap gap-2">
            {term.avoid.map((a) => (
              <span class={CHIP_AVOID}>{a}</span>
            ))}
          </div>
        </div>
      ) : null}

      {term.aliases?.length ? (
        <div class="flex flex-col gap-3">
          <p class="text-body font-bold text-foreground-subtle">Also known as</p>
          <div class="flex flex-wrap gap-2">
            {term.aliases.map((a) => (
              <span class={CHIP}>{aliasText(a)}</span>
            ))}
          </div>
        </div>
      ) : null}

      {term.note ? (
        <div class="flex flex-col gap-3">
          <p class="text-body font-bold text-foreground-subtle">Note</p>
          <p class="text-body text-foreground-muted">{term.note}</p>
        </div>
      ) : null}

      <OpenFeedback feedback={feedback} />

      {/*
        Every language, not one. This page is the English reference, so the
        useful next question is "what did everyone else do with it?" -- and
        the answer used to be a link into Spanish, which was hardcoded.

        Prose only: it is the form the other five are derived from, and six
        columns would not fit beside a prose-width column of definitions.
        The full grid is one link away.
      */}
      <div class="flex flex-col gap-3">
        <p class="text-body font-bold text-foreground-subtle">Translations</p>
        <div class="overflow-x-auto rounded-card border border-border-subtle">
          <table class="w-full border-collapse text-label-md">
            <caption class="sr-only">
              The prose translation of {term.term} in each supported language
            </caption>
            <thead>
              <tr>
                <th scope="col" class={HEAD}>
                  Language
                </th>
                <th scope="col" class={HEAD}>
                  {/* Same affordance as the compare grid: the column header
                      explains the slot it holds, and links on to /contexts. */}
                  <span class="inline-flex items-center gap-1">
                    {CONTEXT_BY_ID.prose.label}
                    <button
                      type="button"
                      class="grid place-items-center rounded-full opacity-75 hover:opacity-100"
                      aria-label={`What does ${CONTEXT_BY_ID.prose.label} mean?`}
                      aria-expanded="false"
                      data-tip={CONTEXT_BY_ID.prose.summary}
                      data-tip-href="/contexts#prose"
                      data-tip-link={`More about ${CONTEXT_BY_ID.prose.label}`}
                    >
                      <Icon svg={info} class="size-3.5" />
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listLanguages().map((l) => {
                const prose = translations.find((t) => t.code === l.code)?.prose
                return (
                  <tr class={ROW} data-row-link>
                    <th scope="row" class={`${CELL} whitespace-nowrap font-normal`}>
                      <a class={ROW_LINK} href={`/translations/${l.code}/${term.id}`}>
                        <span class="font-bold text-foreground-strong" lang={l.code} dir={l.dir}>
                          {l.endonym}
                        </span>{" "}
                        <span class="text-foreground-subtle">{l.name}</span>
                      </a>
                    </th>
                    <td
                      class={`${CELL} ${prose ? "text-foreground" : "text-foreground-subtle"}`}
                      lang={prose ? l.code : undefined}
                      dir={prose ? l.dir : undefined}
                    >
                      {prose ?? "--"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <a
          class="inline-flex items-center gap-1.5 self-start text-label-md text-accent"
          href={`/translations/all/${term.id}`}
        >
          Compare every context, not just prose
          <Icon svg={arrowRight} class="size-4" />
        </a>
      </div>

      {feedback.mode === "live" ? (
        <>
          <SuggestChangesDialog term={term} feedback={feedback} />
          <TermFlagDialogs term={term.term} termId={term.id} termHash={feedback.termHash} />
          <WithdrawDialog signinHref={feedback.signinHref} />
        </>
      ) : null}
    </div>
  </Layout>
)
