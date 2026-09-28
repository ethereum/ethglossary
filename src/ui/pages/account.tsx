/**
 * Your account.
 *
 * What the site knows about you, which is deliberately little: the sign-in
 * method, an optional display name only you and the maintainers ever see, a
 * verified ENS name if a wallet has one, and a way to delete the account.
 */

import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import type { SessionUser } from "../../auth/session"

export interface AccountPageProps {
  user: SessionUser
  saved?: boolean
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
const FIELD =
  "w-full rounded-sm border border-input bg-transparent px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-accent"
const PRIMARY =
  "inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-label-md font-bold text-primary-foreground transition-[filter] hover:brightness-110"

export const AccountPage = ({ user, saved, activeLang, url }: AccountPageProps) => (
  <Layout
    title="Your account -- ETHGlossary"
    description="Your ETHGlossary account."
    activeLang={activeLang}
    url={url}
    noIndex
  >
    <div class="mx-auto flex w-full max-w-md flex-col gap-10 py-16">
      <div class="flex flex-col gap-3">
        <p class={EYEBROW}>Account</p>
        <h1 class="font-serif text-h3 font-medium text-foreground-strong">
          {user.displayName ?? "Your account"}
        </h1>
        <p class="text-body text-foreground-muted">
          Signed in with {PROVIDER_LABEL[user.provider] ?? user.provider}
          {user.ensName ? (
            <>
              {" "}as <span class="font-mono text-label-md text-foreground-strong">{user.ensName}</span>
            </>
          ) : null}
          . Member since {user.createdAt.toISOString().slice(0, 10)}.
        </p>
      </div>

      <form method="post" action="/account" class="flex flex-col gap-3">
        <label class={EYEBROW} for="display-name">
          Display name
        </label>
        <input
          id="display-name"
          name="display_name"
          class={FIELD}
          value={user.displayName ?? ""}
          maxlength={64}
          autocomplete="nickname"
          placeholder="Optional"
        />
        <p class="text-tiny text-foreground-subtle">
          Shown only to you and to the glossary maintainers. It is never displayed to other
          visitors, and it does not need to be unique.
        </p>
        <div class="flex items-center gap-4">
          <button type="submit" class={PRIMARY}>
            Save
          </button>
          {saved ? (
            <span role="status" class="text-label-md text-teal">
              Saved
            </span>
          ) : null}
        </div>
      </form>

      <form method="post" action="/auth/signout">
        <button type="submit" class="text-label-md text-accent">
          Sign out
        </button>
      </form>

      <hr class="border-border-subtle" />

      <form
        method="post"
        action="/account/delete"
        class="flex flex-col gap-3"
        onsubmit="return confirm('Delete your account? Your sign-in is removed and your feedback becomes anonymous. This cannot be undone.')"
      >
        <p class={EYEBROW}>Delete account</p>
        <p class="text-body text-foreground-muted">
          Removes your sign-in and your display name. Feedback you have already given stays,
          without any link to you. You can sign up again later as a new account.
        </p>
        <button
          type="submit"
          class="self-start rounded-full border border-rose px-5 py-2.5 text-label-md font-bold text-rose hover:bg-rose/10"
        >
          Delete my account
        </button>
      </form>
    </div>
  </Layout>
)
