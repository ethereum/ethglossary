/**
 * Your account.
 *
 * What the site knows about you, which is deliberately little: the sign-in
 * method, an optional display name only you and the maintainers ever see, a
 * verified ENS name if a wallet has one, and a way to delete the account.
 * The name is edited in place: the pencil goes to `?edit=1`, which renders
 * the heading as a field, so there is no script and no second form section.
 * Plus what you have done here: how far you have got in each language, and
 * every suggestion and proposal you have made, with the maintainers' answer
 * once there is one.
 */

import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import type { SessionUser } from "../../auth/session"
import type { LanguageProgress, ProfileFeedback, ProfileProposal, ProfileSuggestion } from "../../feedback/profile"
import { CONTEXT_BY_ID } from "../../lib/context-types"
import { getLanguageMeta } from "../../lib/language-meta"
import { describeProposal, pluralValueLabel, proposalKindLabel } from "../feedback-labels"
import { Tick, WithdrawDialog, WithdrawToolbar, WITHDRAW_ISLAND } from "../withdraw"
import { GHOST, PRIMARY } from "../feedback-shared"
import { ACCOUNT_ISLAND } from "../account-island"
import { Icon } from "../icon"
import logOut from "lucide-static/icons/log-out.svg"
import pencil from "lucide-static/icons/pencil.svg"

/** What a person types to delete their account. The route checks it too. */
export const DELETE_PHRASE = "delete my account"

export interface AccountPageProps {
  user: SessionUser
  feedback?: ProfileFeedback
  /** Render the display name as a field, with Save. */
  editing?: boolean
  saved?: boolean
  /** The delete button was pressed once: show the confirmation field. */
  confirmingDelete?: boolean
  /** The delete form was submitted without the phrase. */
  deleteError?: boolean
  activeLang?: string
  url?: PageUrl
}

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  discord: "Discord",
  siwe: "Ethereum wallet",
  passkey: "Passkey",
}

const EYEBROW = "text-body font-bold text-foreground-subtle"
const NAME = "font-serif text-h3 font-medium text-foreground-strong"
const NAME_FIELD =
  "min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0.5 py-1 font-serif text-h3 font-medium text-foreground-strong placeholder:text-foreground-subtle focus:border-accent"
// The same box as the nav's theme toggle: a 32px square, soft corners, muted hover fill.
const CONFIRM_FIELD =
  "w-full max-w-sm rounded-sm border border-input bg-transparent px-3 py-2 font-mono text-body text-foreground placeholder:text-foreground-subtle focus:border-accent"
const ICON_BTN = "grid size-8 shrink-0 place-items-center rounded-md text-foreground no-underline hover:bg-muted"
const ITEM = "flex items-start justify-between gap-3 rounded-md bg-card px-4 py-3"
const TERM_LINK = "font-bold text-foreground-strong no-underline hover:underline"

// ------------------------------------------------------------ progress

const Progress = ({ rows }: { rows: LanguageProgress[] }) => (
  <section class="flex flex-col gap-3">
    <p class={EYEBROW}>Your reviews</p>
    {rows.length ? (
      <table class="w-full text-body">
        <thead>
          <tr class="text-left text-label-md text-foreground-subtle">
            <th class="py-2 font-bold">Language</th>
            <th class="py-2 text-right font-bold">Reviewed</th>
            <th class="py-2 text-right font-bold">In progress</th>
            <th class="py-2 text-right font-bold">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr class="border-t border-border-subtle">
              <td class="py-2">
                <a class={TERM_LINK} href={`/translations/${r.lang}`}>
                  {r.name}
                </a>
              </td>
              <td class="py-2 text-right tabular-nums text-teal">{r.full}</td>
              <td class="py-2 text-right tabular-nums text-foreground">{r.partial}</td>
              <td class="py-2 text-right tabular-nums text-foreground-muted">{r.total - r.full}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="text-body text-foreground-muted">
        You have not reviewed any translations yet. <a href="/translations">Pick a language</a> to start.
      </p>
    )}
    <p class="text-label-md/relaxed text-foreground-subtle">
      A term counts as <em>reviewed</em> once you have voted or suggested on every one of its contexts,
      and as <em>in progress</em> after the first. When a translation changes, that context is yours to
      look at again.
    </p>
  </section>
)

// ---------------------------------------------------------- the items

const STATUS_LABEL: Record<ProfileSuggestion["status"], [string, string]> = {
  open: ["", ""],
  accepted: ["Accepted", "text-teal"],
  declined: ["Declined", "text-rose"],
  withdrawn: ["Withdrawn by you", "text-foreground-subtle"],
}

const Status = ({ status }: { status: ProfileSuggestion["status"] }) =>
  status === "open" ? null : (
    <span class={`text-label-md font-bold ${STATUS_LABEL[status][1]}`}>{STATUS_LABEL[status][0]}</span>
  )

const Note = ({ note }: { note: string | null }) =>
  note ? <span class="text-label-md text-foreground-muted">Maintainers: {note}</span> : null

/** Withdrawn items can be re-submitted; the route reopens the same row while its subject is still live. */
const Resubmit = ({ kind, id }: { kind: "suggestions" | "proposals"; id: string }) => (
  <button type="button" class={GHOST} data-reopen={kind} data-id={id}>
    Re-submit
  </button>
)

const SuggestionItem = ({ s }: { s: ProfileSuggestion }) => {
  const dir = getLanguageMeta(s.lang)?.dir ?? "ltr"
  return (
    <li class={ITEM}>
      {s.status === "open" ? <Tick value={`suggestions:${s.id}`} label={`the suggestion ${s.value}`} /> : null}
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-label-md text-foreground-subtle">
          {s.language} &middot; {CONTEXT_BY_ID[s.context]?.label ?? s.context}
          {s.status === "open" && !s.current ? " · the translation has changed since" : ""}
          {" · "}
          {s.createdAt}
        </span>
        <span class="text-body">
          {s.term ? (
            <a class={TERM_LINK} href={`/translations/${s.lang}/${s.term.id}`}>
              {s.term.term}
            </a>
          ) : (
            <span class="text-foreground-muted">a term that has since been removed</span>
          )}
        </span>
        <span class="font-serif text-label-xl text-foreground-strong" lang={s.lang} dir={dir}>
          {s.context === "plurals" ? pluralValueLabel(s.value) : s.value}
        </span>
        {s.reason ? <span class="text-label-md text-foreground-muted">{s.reason}</span> : null}
        <Status status={s.status} />
        <Note note={s.resolutionNote} />
      </span>
      {s.status === "open" ? (
        <button type="button" class={GHOST} data-withdraw="suggestions" data-id={s.id}>
          Withdraw
        </button>
      ) : s.status === "withdrawn" ? (
        <Resubmit kind="suggestions" id={s.id} />
      ) : null}
    </li>
  )
}

const ProposalItem = ({ p }: { p: ProfileProposal }) => (
  <li class={ITEM}>
    {p.status === "open" ? <Tick value={`proposals:${p.id}`} label={`the proposal ${describeProposal(p)}`} /> : null}
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-label-md text-foreground-subtle">
        {proposalKindLabel(p.kind)}
        {p.language ? ` · ${p.language}` : ""}
        {" · "}
        {p.createdAt}
      </span>
      {p.term ? (
        <span class="text-body">
          <a class={TERM_LINK} href={p.lang ? `/translations/${p.lang}/${p.term.id}` : `/style-guide/${p.term.id}`}>
            {p.term.term}
          </a>
        </span>
      ) : null}
      <span class="text-body text-foreground-strong">{describeProposal(p)}</span>
      {p.reason ? <span class="text-label-md text-foreground-muted">{p.reason}</span> : null}
      <Status status={p.status} />
      <Note note={p.resolutionNote} />
    </span>
    {p.status === "open" ? (
      <button type="button" class={GHOST} data-withdraw="proposals" data-id={p.id}>
        Withdraw
      </button>
    ) : p.status === "withdrawn" ? (
      <Resubmit kind="proposals" id={p.id} />
    ) : null}
  </li>
)

const Feedback = ({ feedback }: { feedback: ProfileFeedback }) => {
  const openS = feedback.suggestions.filter((s) => s.status === "open")
  const openP = feedback.proposals.filter((p) => p.status === "open")
  const doneS = feedback.suggestions.filter((s) => s.status !== "open")
  const doneP = feedback.proposals.filter((p) => p.status !== "open")
  return (
    <>
      <Progress rows={feedback.progress} />

      <section class="flex flex-col gap-3">
        <p class={EYEBROW}>Your open feedback</p>
        {openS.length || openP.length ? (
          <>
            <WithdrawToolbar />
            <ul class="flex flex-col gap-2">
              {openS.map((s) => (
                <SuggestionItem s={s} />
              ))}
              {openP.map((p) => (
                <ProposalItem p={p} />
              ))}
            </ul>
            <WithdrawDialog signinHref="/signin?next=%2Faccount" />
          </>
        ) : (
          <p class="text-body text-foreground-muted">
            Nothing waiting on the maintainers. Suggestions and proposals you make on a term's page
            appear here until they are reviewed.
          </p>
        )}
        <p id="account-status" role="status" class="text-label-md text-rose" hidden></p>
      </section>

      {doneS.length || doneP.length ? (
        <details class="flex flex-col gap-3">
          <summary class={`${EYEBROW} cursor-pointer`}>Closed feedback ({doneS.length + doneP.length})</summary>
          <p id="closed-status" role="status" class="pt-3 text-label-md text-rose" hidden></p>
          <ul class="flex flex-col gap-2 pt-3">
            {doneS.map((s) => (
              <SuggestionItem s={s} />
            ))}
            {doneP.map((p) => (
              <ProposalItem p={p} />
            ))}
          </ul>
        </details>
      ) : null}

      <hr class="border-border-subtle" />
    </>
  )
}

// ------------------------------------------------------------- the page

export const AccountPage = ({
  user,
  feedback,
  editing,
  saved,
  confirmingDelete,
  deleteError,
  activeLang,
  url,
}: AccountPageProps) => (
  <Layout
    title="Your account -- ETHGlossary"
    description="Your ETHGlossary account."
    activeLang={activeLang}
    url={url}
    noIndex
    island={(feedback ? WITHDRAW_ISLAND : "") + ACCOUNT_ISLAND}
  >
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-10 py-16">
      <div class="flex flex-col gap-3">
        <p class={EYEBROW}>Account</p>
        {editing ? (
          <form method="post" action="/account" class="flex flex-wrap items-center gap-3">
            <label class="sr-only" for="display-name">
              Display name
            </label>
            <input
              id="display-name"
              name="display_name"
              class={NAME_FIELD}
              value={user.displayName ?? ""}
              maxlength={64}
              autocomplete="nickname"
              placeholder="Display name"
              autofocus
            />
            <button type="submit" class={PRIMARY}>
              Save
            </button>
            <a class={GHOST} href="/account">
              Cancel
            </a>
          </form>
        ) : (
          <div class="flex items-center">
            <h1 class={`${NAME} me-1 min-w-0 truncate`}>{user.displayName ?? "Your account"}</h1>
            <a class={ICON_BTN} href="/account?edit=1" aria-label="Edit display name" title="Edit display name">
              <Icon svg={pencil} class="size-4.5" />
            </a>
            {saved ? (
              <span role="status" class="ms-2 text-label-md text-teal">
                Saved
              </span>
            ) : null}
            <form method="post" action="/auth/signout" class="ms-auto shrink-0">
              <button
                type="submit"
                class="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-label-md text-foreground hover:bg-muted"
              >
                Sign out
                <Icon svg={logOut} class="size-4.5" />
              </button>
            </form>
          </div>
        )}
        <p class="text-body text-foreground-muted">
          Signed in with {PROVIDER_LABEL[user.provider] ?? user.provider}
          {user.ensName ? (
            <>
              {" "}as <span class="font-mono text-label-md text-foreground-strong">{user.ensName}</span>
            </>
          ) : null}
          . Member since {user.createdAt.toISOString().slice(0, 10)}.
        </p>
        <p class="text-label-md/relaxed text-foreground-subtle">
          Your display name is visible only to you and the glossary maintainers. It never appears to
          other visitors, and it does not need to be unique.
        </p>
      </div>

      {feedback ? <Feedback feedback={feedback} /> : null}

      {/*
        Deliberate by construction, in two steps. The first press only reveals
        the confirmation (`?delete=confirm`, server-rendered); the second needs
        the phrase typed exactly: `pattern` has the browser refuse anything
        else, the island keeps the button inert until it matches, and the
        route checks again. A stray click or a replayed form deletes nothing.
      */}
      <form method="post" action="/account/delete" id="delete-account" class="flex flex-col gap-3">
        <p class={EYEBROW}>Delete account</p>
        <p class="text-body text-foreground-muted">
          Removes your sign-in and your display name. Feedback you have already given stays,
          without any link to you. This cannot be undone: if you sign in again later with the
          same GitHub, Discord or wallet, you start as a new account, and nothing you
          contributed before can be connected to it.
        </p>
        {confirmingDelete ? (
          <>
            <label class="text-label-md text-foreground-subtle" for="delete-confirm">
              Type <span class="font-mono text-foreground-strong">{DELETE_PHRASE}</span> to confirm
            </label>
            <input
              id="delete-confirm"
              name="confirm"
              class={CONFIRM_FIELD}
              required
              pattern={DELETE_PHRASE}
              title={`Type exactly: ${DELETE_PHRASE}`}
              autocomplete="off"
              spellcheck={false}
              placeholder={DELETE_PHRASE}
              autofocus
            />
            {deleteError ? (
              <p role="alert" class="text-label-md text-rose">
                The phrase did not match. Type it exactly as shown to delete the account.
              </p>
            ) : null}
            <button
              type="submit"
              id="delete-submit"
              class="self-start rounded-full border border-rose bg-rose px-5 py-2.5 text-label-md font-bold text-background transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-foreground-subtle disabled:hover:brightness-100"
            >
              Confirm account deletion
            </button>
          </>
        ) : (
          <a
            class="self-start rounded-full border border-rose px-5 py-2.5 text-label-md font-bold text-rose no-underline hover:bg-rose/10 hover:no-underline"
            href="/account?delete=confirm#delete-account"
          >
            Delete my account
          </a>
        )}
      </form>
    </div>
  </Layout>
)
