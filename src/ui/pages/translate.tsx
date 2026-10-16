/**
 * Translate view -- Figma frames 21:704 and 28:2320 (a slot row).
 *
 * Three columns: term list, term detail with one votable row per applicable
 * context, and the versions rail.
 *
 * Type follows the named Figma styles: the term title is Header-2-Medium
 * (Serif 500 32/40), eyebrow labels are Body-lg-bold (Sans 700 16/24) in
 * #909090, a slot term is Label-xl (Serif 400 20/20), a context label is
 * Label-md (Sans 400 14/14), and vote counts are Label-lg (Sans 400 16/16).
 *
 * Feedback has three modes, decided by the route from the database and the
 * session and passed in as `feedback.mode`:
 *
 *   off     no database (or accounts not yet enabled): every control is
 *           rendered live and labelled "coming soon", counts show a dash
 *   signin  database, no session: counts are real, every control explains
 *           itself with a "Sign in" popover that comes back to this page
 *   live    signed in: the feedback island wires the controls to the API
 *
 * Nothing a reader submits changes what this page shows for anyone else.
 * Suggestions and proposals are visible to their author and the maintainers
 * only; the counts are the one public signal.
 */

import { raw } from "hono/html"
import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import { Icon } from "../icon"
import { describeProposal, pluralValueLabel, proposalKindLabel } from "../feedback-labels"
import { DIALOG, Tick, WithdrawDialog, WithdrawToolbar, WITHDRAW_ISLAND } from "../withdraw"
import { gate } from "../gate"
import { ProposalDialog, TermFlagDialogs, TermFlags } from "../term-flags"
import { FIELD, GHOST, PRIMARY } from "../feedback-shared"
import type { FeedbackMode } from "../gate"
import arrowLeft from "lucide-static/icons/arrow-left.svg"
import arrowRight from "lucide-static/icons/arrow-right.svg"
import badgeCheck from "lucide-static/icons/badge-check.svg"
import circleAlert from "lucide-static/icons/circle-alert.svg"
import info from "lucide-static/icons/info.svg"
import squarePen from "lucide-static/icons/square-pen.svg"
import thumbsDown from "lucide-static/icons/thumbs-down.svg"
import thumbsUp from "lucide-static/icons/thumbs-up.svg"
import { TERM_FILTER_ISLAND } from "../islands"
import { FEEDBACK_ISLAND } from "../feedback"
import { CONTEXT_BY_ID, applicableContexts } from "../../lib/context-types"
import type { ContextId } from "../../lib/context-types"
import { sanitizeDefinition } from "../../lib/sanitize"
import { getLanguageMeta } from "../../lib/language-meta"
import type { GlossaryTerm, TranslationEntry } from "../../lib/glossary-data"
import type { HistoryEntry, Proposal, Suggestion, Tally } from "../../feedback/store"

export type ProgressState = "none" | "partial" | "full"

export interface TermListItem {
  key: string
  id: string
  term: string
  progress: ProgressState
}

export type { FeedbackMode }

export interface SlotFeedback {
  hash: string
  tally: Tally
  mine: "up" | "down" | null
}

export interface FeedbackState {
  mode: FeedbackMode
  /** Where "Sign in" comes back to. */
  signinHref: string
  /** Hash of the English entry as rendered; anchors the flags. */
  termHash: string
  /** By context, for every applicable slot. */
  slots: Record<string, SlotFeedback>
  mySuggestions: Suggestion[]
  myProposals: Proposal[]
  /** Newest first. Empty when nothing has changed since history began. */
  history: HistoryEntry[]
  /** The day history began, shown as the baseline under the entries. Null before the first index. */
  historySince: string | null
  /** False when there is no database to read history from. */
  historyAvailable: boolean
}

interface TranslatePageProps {
  lang: string
  terms: TermListItem[]
  selected?: {
    key: string
    term: GlossaryTerm
    translation?: TranslationEntry
  }
  prevTermId?: string
  nextTermId?: string
  feedback?: FeedbackState
  url?: PageUrl
}

/** Body-lg-bold in the Figma's label grey. */
const EYEBROW = "text-body font-bold text-foreground-subtle"

/**
 * The Figma draws two states: an outline mark with secondary text, and a
 * filled mark with accent/green text. "partial" interpolates between them --
 * green mark, secondary text -- for a term reviewed in some contexts but not
 * all. See docs/context-types.md for how coverage is computed.
 */
const PROGRESS_TONE: Record<ProgressState, { icon: string; text: string }> = {
  none: { icon: "text-foreground-subtle", text: "text-foreground" },
  partial: { icon: "text-teal", text: "text-foreground" },
  full: { icon: "text-teal", text: "text-teal" },
}

const OFF: FeedbackState = {
  mode: "off",
  signinHref: "/signin",
  termHash: "",
  slots: {},
  mySuggestions: [],
  myProposals: [],
  history: [],
  historySince: null,
  historyAvailable: false,
}

const SlotRow = ({
  context,
  value,
  plurals,
  lang,
  dir,
  confidence,
  slot,
  suggested,
  mode,
  signinHref,
}: {
  context: ContextId
  value: string
  plurals?: Array<[string, string]>
  lang: string
  dir: "ltr" | "rtl"
  /** Set only where it is worth flagging -- see `lowConfidence` below. */
  confidence?: "medium" | "low"
  slot?: SlotFeedback
  /** Whether the reader has an open suggestion on this slot; counts as covered like a vote does. */
  suggested?: boolean
  mode: FeedbackMode
  signinHref: string
}) => {
  const meta = CONTEXT_BY_ID[context]
  const counts = mode === "off" || !slot
  const voteButton = (direction: "up" | "down", svg: string, label: string) => (
    <button
      class={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-label-lg tabular-nums text-foreground-subtle transition-colors hover:bg-muted hover:text-foreground-strong aria-disabled:cursor-not-allowed ${
        direction === "up" ? "aria-pressed:text-teal" : "aria-pressed:text-rose"
      }`}
      type="button"
      aria-pressed={slot?.mine === direction ? "true" : "false"}
      aria-label={`${label} the ${meta.label} translation`}
      data-vote={direction}
      {...gate(mode, signinHref, "vote")}
    >
      <Icon svg={svg} class="size-4.5" />
      <span data-count="">{counts ? "\u2013" : String(direction === "up" ? slot.tally.up : slot.tally.down)}</span>
    </button>
  )

  return (
    <li
      class="overflow-hidden rounded-card border border-border bg-card"
      data-slot={context}
      data-hash={slot?.hash ?? ""}
      data-suggested={suggested ? "true" : undefined}
    >
      <div class="flex items-center justify-between gap-4 px-4 py-3">
        {plurals ? (
          <span
            class="flex min-w-0 flex-wrap items-baseline gap-x-4.5 gap-y-1.5 font-serif text-label-xl text-foreground-strong"
            lang={lang}
            dir={dir}
          >
            {plurals.map(([form, term]) => (
              <span class="inline-flex items-baseline gap-1.5">
                <span class="font-sans text-tiny uppercase tracking-wider text-foreground-subtle">
                  {form}
                </span>
                {term}
              </span>
            ))}
          </span>
        ) : (
          <span
            class="min-w-0 break-words font-serif text-label-xl text-foreground-strong"
            lang={lang}
            dir={dir}
          >
            {value}
          </span>
        )}

        <span class="flex shrink-0 items-center gap-4">
          {voteButton("up", thumbsUp, "Vote up")}
          {voteButton("down", thumbsDown, "Vote down")}
          <button
            class="grid size-6 place-items-center rounded-md text-foreground-subtle transition-colors hover:bg-muted hover:text-foreground-strong aria-disabled:cursor-not-allowed"
            type="button"
            aria-label={`Suggest a different ${meta.label} translation`}
                  data-action="suggest"
            {...gate(mode, signinHref, "suggest a translation")}
          >
            <Icon svg={squarePen} class="size-5" />
          </button>
        </span>
      </div>

      <div class="flex items-center justify-between gap-3 bg-secondary px-4 py-2">
        <span class="inline-flex items-center gap-1.5 text-label-md text-foreground">
          {meta.label}
          {/*
            A button, not a link to /contexts. Tapping the icon should answer
            the question where you are -- a `title` never fires on touch, and
            navigating away loses the term you were reviewing. The link out
            lives inside the popover for when the one line is not enough.
          */}
          <button
            type="button"
            class="grid place-items-center rounded-full text-foreground-muted opacity-75 hover:opacity-100"
            aria-label={`What does ${meta.label} mean?`}
            aria-expanded="false"
            data-tip={meta.summary}
            data-tip-href={`/contexts#${context}`}
            data-tip-link={`More about ${meta.label}`}
          >
            <Icon svg={info} class="size-3.5" />
          </button>
          {/*
            After the info icon, which belongs to the label it explains.
            Only ever shown when confidence is not "high" -- a badge on every
            row would be wallpaper. This one marks a term that wants a native
            speaker's eye, which is the whole reason the field is recorded.
          */}
          {confidence ? (
            <span class="inline-block whitespace-nowrap rounded-full bg-rose/15 px-2 py-0.5 text-tiny text-rose">
              {confidence} confidence
            </span>
          ) : null}
        </span>
      </div>
    </li>
  )
}

/**
 * The rail reads as versions, newest first: one block per deploy that
 * changed the term, numbered down to v1, which is the day the indexer first
 * recorded the glossary. Entries come in by day, so a day is a version.
 */
function groupVersions(history: HistoryEntry[]): Array<{ date: string; changes: HistoryEntry[] }> {
  const out: Array<{ date: string; changes: HistoryEntry[] }> = []
  for (const h of history) {
    const last = out[out.length - 1]
    if (last && last.date === h.date) last.changes.push(h)
    else out.push({ date: h.date, changes: [h] })
  }
  return out
}

/** One line of the Versions rail. */
function describeChange(h: HistoryEntry): string {
  const label = h.context ? CONTEXT_BY_ID[h.context as ContextId]?.label ?? h.context : ""
  switch (h.kind) {
    case "slot_changed":
      return `${label} updated`
    case "slot_added":
      return `${label} added`
    case "slot_removed":
      return `${label} removed`
    case "term_renamed":
      return `Renamed from “${h.old_value}” to “${h.new_value}”`
    case "term_changed":
      return "English entry updated"
    case "term_added":
      return "Term added"
    case "term_removed":
      return "Term removed"
    default:
      return h.kind
  }
}


/**
 * A proposal form in a <dialog>. The browser supplies the focus trap, the
 * backdrop and Escape; the close button is a `<form method="dialog">` and
 * needs no script. Rendered only in live mode: there is no point shipping a
 * form the reader cannot submit.
 */
export const TranslatePage = ({
  lang,
  terms,
  selected,
  prevTermId,
  nextTermId,
  feedback = OFF,
  url,
}: TranslatePageProps) => {
  const meta = getLanguageMeta(lang)
  const dir = meta?.dir ?? "ltr"
  const { mode, signinHref } = feedback
  const slots: Array<{
    context: ContextId
    value: string
    plurals?: Array<[string, string]>
  }> = []

  /*
   * Confidence is recorded per entry, not per slot, and prose is the form the
   * others are derived from -- so the flag rides on the prose row rather than
   * being repeated six times.
   */
  const conf = selected?.translation?.confidence
  const lowConfidence = conf === "medium" || conf === "low" ? conf : undefined

  if (selected?.translation) {
    const entry = selected.translation
    for (const context of applicableContexts(entry)) {
      if (context === "plurals") {
        // Render the CLDR categories as labelled forms, not a flat string.
        const forms = Object.entries(entry.plurals ?? {}).filter(
          (pair): pair is [string, string] => Boolean(pair[1])
        )
        if (forms.length) {
          slots.push({ context, value: forms[0][1], plurals: forms })
        }
        continue
      }
      const value = entry.contexts?.[context]?.term
      if (value) slots.push({ context, value })
    }
  }

  const languageName = meta?.name ?? lang
  /** The plural forms of the selected term in this language, in file order, for the suggestion fields. */
  const pluralForms: Array<[string, string]> = slots.find((s) => s.context === "plurals")?.plurals ?? []

  return (
    <Layout
      title={
        selected
          ? `${selected.term.term} in ${languageName} -- ETHGlossary`
          : `Translate to ${languageName} -- ETHGlossary`
      }
      description={`Review and improve the ${languageName} translation of Ethereum terminology.`}
      nav="translations"
      activeLang={lang}
      url={url}
      island={TERM_FILTER_ISLAND + FEEDBACK_ISLAND + WITHDRAW_ISLAND}
    >
      {/*
        Two stages, not one.

        The term list earns its place beside the content well before there is
        room for the versions rail as well: at `lg` the three-column form
        would leave the detail column about 270px wide, which is narrower than
        a slot row needs. So `lg` puts the list on the left and drops Versions
        below the detail; `xl` promotes Versions back to its own rail.
      */}
      <div class="grid items-start gap-8 pt-8 pb-16 lg:grid-cols-[278px_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[278px_minmax(0,1fr)_278px]">
        {/* ---------- Column 1: language, then term list ---------- */}
        {/*
          On a phone the list is capped at a few rows (the whole column stacks
          above the term, and a tall list pushes the term itself below the
          fold and is awkward to scroll past); tablets get 60vh.

          At lg the column sticks and the list flexes to whatever is left, so
          it is as tall as the screen allows however many terms the language
          has. The cap is the viewport less the nav (4rem), the grid's top
          padding (2rem) and 1rem of breathing room, so at the top of the page
          "Suggest new term" sits just above the fold.
        */}
        <div class="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-7rem)]">
          {/*
            Which language you are reviewing, and how to leave it. Without this
            the page gives no sign of the choice the cookie is making on your
            behalf, and no way to undo it.
          */}
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0">
              <span class="block text-tiny text-foreground-subtle">Reviewing</span>
              <span class="font-serif text-h4 font-bold text-foreground-strong" lang={lang} dir={dir}>
                {meta?.endonym ?? lang}
              </span>{" "}
              <span class="text-label-sm text-foreground-subtle">{meta?.name}</span>
            </span>
            <a class="shrink-0 text-label-md text-accent" href="/translations/change">
              Change
            </a>
          </div>

          {/* Figma 21:854: a black wash, square corners, no border, 24px pad. */}
          <aside class="bg-sidebar p-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <h2 class="text-body font-bold text-foreground-strong">Terms</h2>
            <div class="pt-3">
              <input
                type="search"
                id="term-search"
                class="w-full rounded-sm border border-input bg-transparent p-2 text-tiny/6 text-foreground placeholder:text-foreground-muted focus:border-accent"
                placeholder="Search terms..."
                autocomplete="off"
                aria-label="Search terms"
              />
            </div>
            <ul
              id="term-list"
              class="flex max-h-36 flex-col gap-1 overflow-y-auto pt-5 pb-6 sm:max-h-[min(60vh,32rem)] lg:min-h-0 lg:max-h-none lg:flex-1"
            >
              {terms.map((t) => (
                <li>
                  <a
                    class={`flex items-center gap-2 px-3 py-2 text-body no-underline hover:bg-muted hover:text-foreground-strong hover:no-underline ${
                      selected?.key === t.key
                        ? "border-b border-foreground-strong bg-muted font-bold text-foreground-strong"
                        : PROGRESS_TONE[t.progress].text
                    }`}
                    href={`/translations/${lang}/${t.id}`}
                    aria-current={selected?.key === t.key ? "true" : undefined}
                    data-term={t.term.toLowerCase()}
                  >
                    <Icon
                      svg={badgeCheck}
                      class={`size-4 ${PROGRESS_TONE[t.progress].icon}`}
                    />
                    <span class="min-w-0 flex-1">{t.term}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p class="border-t border-border-subtle pt-2.5 text-tiny text-foreground-subtle">
              <span id="term-count">{terms.length}</span> terms
            </p>
            {/*
              A term missing from the glossary is the other half of this page's
              job, and there is nowhere else to report it. Gated like every
              other control that needs an account.
            */}
            <button
              type="button"
              class="mt-4 w-full rounded-full border border-accent px-4 py-2 text-label-md font-bold text-accent hover:bg-accent/10 aria-disabled:cursor-not-allowed"
              data-open-dialog="new-term-dialog"
              {...gate(mode, signinHref, "propose a term")}
            >
              Suggest new term
            </button>
          </aside>
        </div>

        {/* ---------- Column 2: detail ---------- */}
        <div
          class="flex min-w-0 flex-col gap-10"
          data-feedback={mode}
          data-lang={lang}
          data-term-id={selected?.term.id ?? ""}
          data-term-hash={feedback.termHash}
          data-signin={signinHref}
        >
          {!selected ? (
            <div class="flex flex-col gap-4">
              <p class={EYEBROW}>Get started</p>
              <h1 class="font-serif text-h3 font-medium text-foreground-strong">Pick a term to review</h1>
              <p class="max-w-prose text-body text-foreground-muted">
                Every term carries a separate translation for each context it appears in.
                Choose one from the list and vote on the forms that read correctly to a
                native speaker &mdash; or suggest better ones.
              </p>
              <a
                class="inline-flex items-center gap-1.5 self-start text-label-md text-accent"
                href="/contexts"
              >
                What do prose, tag and UI mean?
                <Icon svg={arrowRight} class="size-4" />
              </a>
            </div>
          ) : (
            <>
              <div class="flex flex-col gap-4">
                <p class={EYEBROW}>Term</p>
                <h1 class="font-serif text-h3 font-medium text-foreground-strong">
                  {selected.term.term}
                </h1>
              </div>

              {selected.term.definition ? (
                <div class="flex flex-col gap-3">
                  <p class={EYEBROW}>Definition</p>
                  <div class="rounded-md bg-card px-4 py-4">
                    {/* Definitions carry curated markup -- links, lists, emphasis. */}
                    <div class="definition-html text-body">
                      {raw(sanitizeDefinition(selected.term.definition))}
                    </div>
                    <a
                      class="mt-2 inline-block font-serif text-label-md text-accent"
                      href={`/style-guide/${selected.term.id}`}
                    >
                      More in style guide
                    </a>
                  </div>
                  {/*
                    The two structural flags. They are about the term, not a
                    translation, so they sit with the definition rather than
                    among the slot rows.
                  */}
                  <TermFlags mode={mode} signinHref={signinHref} />
                </div>
              ) : null}

              <hr class="border-border-subtle" />

              <div class="flex flex-col gap-3">
                <h2 class="text-h4 font-bold text-foreground-strong">Suggested translation</h2>
                <p class="max-w-prose text-body text-foreground-muted">
                  <strong class="font-bold text-foreground-strong">
                    Cast your vote on the terms below
                  </strong>{" "}
                  to help the community select the best translation for each context.
                </p>

                <p id="feedback-status" role="status" aria-live="polite" class="text-label-md text-foreground-muted" hidden></p>

                {slots.length === 0 ? (
                  <p class="text-body text-foreground-muted">
                    No {languageName} translation is recorded for this term yet.
                  </p>
                ) : (
                  <>
                    <div class="flex justify-end">
                      <button
                        id="thumbs-up-all"
                        class="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-label-md font-bold text-accent hover:bg-accent/10 aria-disabled:cursor-not-allowed"
                        type="button"
                        {...gate(mode, signinHref, "vote")}
                      >
                        Thumbs up all
                        <Icon svg={thumbsUp} class="size-4" />
                      </button>
                    </div>

                    <ul class="flex flex-col gap-4">
                      {slots.map((s) => (
                        <SlotRow
                          context={s.context}
                          value={s.value}
                          plurals={s.plurals}
                          lang={lang}
                          dir={dir}
                          confidence={s.context === "prose" ? lowConfidence : undefined}
                          slot={feedback.slots[s.context]}
                          suggested={feedback.mySuggestions.some((m) => m.context === s.context)}
                          mode={mode}
                          signinHref={signinHref}
                        />
                      ))}
                    </ul>
                  </>
                )}

                {mode === "off" ? (
                  <p class="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-tiny text-foreground-subtle">
                    <Icon svg={circleAlert} class="mt-0.5 size-3.75 shrink-0" />
                    <span>
                      <b class="text-foreground">Coming soon:</b> voting and suggestions need an
                      account, which ships in a later phase. Everything shown here is live
                      glossary data.
                    </span>
                  </p>
                ) : null}

                {/*
                  Next is the action -- it is how a reviewer works through the
                  list, so it is the button. Previous is a way back, not a way
                  forward, so it stays a plain link. `justify-between` with an
                  empty span keeps Next on the right at the start of the list,
                  where there is no Previous to push it there.
                */}
                {prevTermId || nextTermId ? (
                  <div class="flex items-center justify-between gap-4 pt-2">
                    {prevTermId ? (
                      <a
                        class="inline-flex items-center gap-1.5 text-label-md text-accent"
                        href={`/translations/${lang}/${prevTermId}`}
                      >
                        <Icon svg={arrowLeft} class="size-4" />
                        Previous term
                      </a>
                    ) : (
                      <span />
                    )}
                    {nextTermId ? (
                      <a
                        class="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-label-md font-bold text-primary-foreground no-underline transition-[filter] hover:brightness-110 hover:no-underline"
                        href={`/translations/${lang}/${nextTermId}`}
                        id="next-term"
                      >
                        Next term
                        <Icon svg={arrowRight} class="size-4 arrow-nudge" />
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <hr class="border-border-subtle" />

              {/* ---------- Suggest a different translation ---------- */}
              <form id="suggest-form" class="flex flex-col gap-2">
                <p class="text-body text-foreground-muted">
                  Into <strong class="font-bold text-foreground-strong">{languageName}</strong>
                  {slots.length > 1 ? (
                    <>
                      {", for the "}
                      <select
                        id="suggest-context"
                        class="rounded-sm border border-input bg-transparent px-2 py-1 text-label-md text-foreground focus:border-accent"
                        aria-label="Which context this suggestion is for"
                      >
                        {slots.map((s) => (
                          <option value={s.context}>{CONTEXT_BY_ID[s.context].label}</option>
                        ))}
                      </select>
                      {" context"}
                    </>
                  ) : slots.length === 1 ? (
                    <input type="hidden" id="suggest-context" value={slots[0].context} />
                  ) : null}
                </p>
                <label class="sr-only" for="suggest-term">
                  Your suggested translation
                </label>
                <input
                  id="suggest-term"
                  class="w-full border-0 border-b border-border bg-transparent px-0.5 py-2.5 font-serif text-h3 text-foreground-strong placeholder:text-foreground-subtle focus:border-accent aria-disabled:cursor-not-allowed"
                  placeholder="Suggest a different translation"
                  maxlength={200}
                  autocomplete="off"
                  lang={lang}
                  dir={dir}
                  readonly={mode !== "live"}
                  {...gate(mode, signinHref, "suggest a translation")}
                />
                {/*
                  Plurals are several forms, not one string: one field per CLDR
                  category the language marks for this term. Shown by the island
                  in place of the single field when the plurals context is
                  chosen; the island joins them the way slotValue() does.
                */}
                {pluralForms.length ? (
                  <div id="suggest-plurals" class="flex flex-col gap-2 pt-1" hidden>
                    {pluralForms.map(([form, current]) => (
                      <label class="flex items-baseline gap-3">
                        <span class="w-12 shrink-0 font-sans text-tiny uppercase tracking-wider text-foreground-subtle">
                          {form}
                        </span>
                        <input
                          class="min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0.5 py-2 font-serif text-label-xl text-foreground-strong placeholder:text-foreground-subtle focus:border-accent"
                          data-plural-form={form}
                          placeholder={current}
                          maxlength={100}
                          autocomplete="off"
                          lang={lang}
                          dir={dir}
                          readonly={mode !== "live"}
                        />
                      </label>
                    ))}
                    <p class="text-tiny text-foreground-subtle">
                      Leave a form empty to keep the current one.
                    </p>
                  </div>
                ) : null}
                <label class="sr-only" for="suggest-reason">
                  Why is this better?
                </label>
                <textarea
                  id="suggest-reason"
                  class="min-h-11 w-full resize-y border-0 border-b border-border bg-transparent px-0.5 py-2.5 text-body text-foreground placeholder:text-foreground-subtle focus:border-accent aria-disabled:cursor-not-allowed"
                  placeholder="Explain your reasoning (optional)"
                  maxlength={1000}
                  readonly={mode !== "live"}
                  {...gate(mode, signinHref, "suggest a translation")}
                />
                <button
                  class="mt-3 inline-flex items-center gap-2 self-start rounded-full bg-primary px-5 py-3 text-body font-bold text-primary-foreground transition-[filter] hover:brightness-110 aria-busy:cursor-progress aria-busy:opacity-60 aria-disabled:cursor-not-allowed"
                  type={mode === "live" ? "submit" : "button"}
                  {...gate(mode, signinHref, "suggest a translation")}
                >
                  Suggest translation
                </button>
                <p class="mt-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-tiny text-foreground-subtle">
                  <Icon svg={info} class="size-3.75 mt-0.5 shrink-0" />
                  Suggestions go to the glossary maintainers, who review them alongside
                  everyone else&rsquo;s. They are not shown to other visitors until approved.
                </p>
              </form>

              {/* ---------- Your open feedback on this term ---------- */}
              {mode === "live" && (feedback.mySuggestions.length || feedback.myProposals.length) ? (
                <div class="flex flex-col gap-3">
                  <p class={EYEBROW}>Your open feedback on this term</p>
                  {feedback.mySuggestions.length + feedback.myProposals.length > 1 ? <WithdrawToolbar /> : null}
                  <ul class="flex flex-col gap-2">
                    {feedback.mySuggestions.map((s) => (
                      <li class="flex items-start justify-between gap-3 rounded-md bg-card px-4 py-3">
                        <Tick value={`suggestions:${s.id}`} label={`the suggestion ${s.value}`} />
                        <span class="min-w-0 flex-1">
                          <span class="block text-tiny uppercase tracking-wider text-foreground-subtle">
                            {CONTEXT_BY_ID[s.context]?.label ?? s.context}
                            {feedback.slots[s.context]?.hash !== s.hash ? " · the translation has changed since" : ""}
                          </span>
                          <span class="font-serif text-label-xl text-foreground-strong" lang={lang} dir={dir}>
                            {s.context === "plurals" ? pluralValueLabel(s.value) : s.value}
                          </span>
                          {s.reason ? <span class="block text-label-md text-foreground-muted">{s.reason}</span> : null}
                        </span>
                        <button type="button" class={GHOST} data-withdraw="suggestions" data-id={s.id}>
                          Withdraw
                        </button>
                      </li>
                    ))}
                    {feedback.myProposals.map((p) => (
                      <li class="flex items-start justify-between gap-3 rounded-md bg-card px-4 py-3">
                        <Tick value={`proposals:${p.id}`} label={`the ${proposalKindLabel(p.kind).toLowerCase()} flag`} />
                        <span class="min-w-0 flex-1">
                          <span class="block text-tiny uppercase tracking-wider text-foreground-subtle">
                            {proposalKindLabel(p.kind)}
                          </span>
                          <span class="text-body text-foreground-strong">{describeProposal(p)}</span>
                          {p.reason ? <span class="block text-label-md text-foreground-muted">{p.reason}</span> : null}
                        </span>
                        <button type="button" class={GHOST} data-withdraw="proposals" data-id={p.id}>
                          Withdraw
                        </button>
                      </li>
                    ))}
                  </ul>
                  <a class="self-start text-label-md text-accent" href="/account">
                    Everything you have suggested, on your account page
                  </a>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---------- Versions: under the detail at lg, own rail at xl ---------- */}
        <aside class="flex flex-col gap-3 lg:col-start-2 xl:col-start-3 xl:row-start-1">
          <h2 class="border-b border-border pb-2.5 text-body font-bold text-foreground-strong">Versions</h2>
          {!feedback.historyAvailable ? (
            <p class="text-tiny/relaxed text-foreground-subtle">
              Change history starts once the first build indexes the deployed glossary. Each
              entry will record which context changed, and in which release.
            </p>
          ) : !selected ? (
            <p class="text-tiny/relaxed text-foreground-subtle">Pick a term to see what has changed about it.</p>
          ) : (
            <ol class="flex flex-col gap-3">
              {groupVersions(feedback.history).map((v, i, all) => (
                <li class="flex flex-col gap-1">
                  <span class="flex items-baseline gap-2 text-label-md">
                    <span class="w-7 shrink-0 font-mono text-foreground-subtle">v{all.length + 1 - i}</span>
                    <time datetime={v.date} class="tabular-nums text-foreground-strong">
                      {v.date}
                    </time>
                  </span>
                  <ul class="flex flex-col gap-1 ps-9">
                    {v.changes.map((h) => (
                      <li class="flex flex-col gap-0.5 text-label-md">
                        <span class="text-foreground">{describeChange(h)}</span>
                        {h.kind === "slot_changed" && h.old_value && h.new_value ? (
                          <span class="text-tiny text-foreground-muted" lang={lang} dir={dir}>
                            <s>{h.old_value}</s> {"→"} {h.new_value}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {feedback.historySince ? (
                <li class="flex items-baseline gap-2 text-label-md">
                  <span class="w-7 shrink-0 font-mono text-foreground-subtle">v1</span>
                  <time datetime={feedback.historySince} class="tabular-nums text-foreground-strong">
                    {feedback.historySince}
                  </time>
                  <span class="text-foreground-subtle">First recorded</span>
                </li>
              ) : (
                <li class="text-label-md text-foreground-subtle">Nothing recorded yet.</li>
              )}
            </ol>
          )}
        </aside>
      </div>

      {/* ---------- Proposal dialogs, live mode only ---------- */}
      {mode === "live" ? (
        <>
          <ProposalDialog
            id="new-term-dialog"
            formId="new-term-form"
            title="Suggest a new term"
            intro="A term you think belongs in the glossary. The maintainers review every proposal; if they add it, all 24 languages are drafted from it."
            submit="Send proposal"
          >
            <label class="flex flex-col gap-1 text-label-md text-foreground-subtle">
              English term
              <input name="term" class={FIELD} required maxlength={120} autocomplete="off" />
            </label>
            <label class="flex flex-col gap-1 text-label-md text-foreground-subtle">
              What it means (optional)
              <textarea name="definition" class={`${FIELD} min-h-20`} maxlength={2000}></textarea>
            </label>
            <label class="flex flex-col gap-1 text-label-md text-foreground-subtle">
              How you would say it in {languageName} (optional)
              <input name="translation" class={FIELD} maxlength={200} lang={lang} dir={dir} autocomplete="off" />
            </label>
            <label class="flex flex-col gap-1 text-label-md text-foreground-subtle">
              Where you came across it, or why it matters (optional)
              <textarea name="reason" class={`${FIELD} min-h-16`} maxlength={1000}></textarea>
            </label>
          </ProposalDialog>

          <TermFlagDialogs term={selected?.term.term ?? ""} termId={selected?.term.id ?? ""} termHash={feedback.termHash} />

          <WithdrawDialog signinHref={feedback.signinHref} />
        </>
      ) : null}
    </Layout>
  )
}

