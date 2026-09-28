/**
 * Sign in.
 *
 * One button per available method. Which methods appear depends on what the
 * server has credentials for; SIWE is always there because it needs none.
 * Nothing on this page collects a password or an email, because the site
 * never stores either.
 */

import { Layout } from "../layout"
import type { PageUrl } from "../layout"
import { Icon } from "../icon"
import discord from "../icons/discord.svg"
import github from "../icons/github.svg"
import wallet from "lucide-static/icons/wallet.svg"
import { SIWE_ISLAND } from "../siwe"
import type { OAuthProviderId } from "../../auth/config"

export interface SignInPageProps {
  providers: Array<{ id: OAuthProviderId; label: string }>
  /** Same-origin path to return to. Already validated. */
  next: string | null
  error?: string
  activeLang?: string
  url?: PageUrl
}

const BUTTON =
  "inline-flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-body font-bold text-foreground-strong no-underline transition-colors hover:bg-muted hover:no-underline aria-busy:cursor-progress aria-busy:opacity-60"

const ICONS: Record<OAuthProviderId, string> = { github, discord }

export const SignInPage = ({ providers, next, error, activeLang, url }: SignInPageProps) => {
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : ""

  return (
    <Layout
      title="Sign in -- ETHGlossary"
      description="Sign in to vote on translations and suggest improvements."
      activeLang={activeLang}
      url={url}
      noIndex
      island={SIWE_ISLAND}
    >
      <div class="mx-auto flex w-full max-w-md flex-col gap-8 py-16">
        <div class="flex flex-col gap-3">
          <p class="text-body font-bold text-foreground-subtle">Account</p>
          <h1 class="font-serif text-h3 font-medium text-foreground-strong">Sign in</h1>
          <p class="text-body text-foreground-muted">
            An account lets you vote on translations and suggest better ones. We keep only the
            identifier your provider gives us &mdash; no email, no password.
          </p>
        </div>

        {error ? (
          <p role="alert" class="rounded-md border border-rose/40 bg-rose/10 px-4 py-3 text-body text-foreground">
            {error}
          </p>
        ) : null}

        <div class="flex flex-col gap-3">
          {providers.map((p) => (
            <a class={BUTTON} href={`/auth/${p.id}${nextQuery}`} rel="nofollow">
              <Icon svg={ICONS[p.id]} class="size-5" />
              Continue with {p.label}
            </a>
          ))}
          <button type="button" class={BUTTON} data-siwe data-next={next ?? ""}>
            <Icon svg={wallet} class="size-5" />
            Sign in with Ethereum
          </button>
          <p data-siwe-status class="text-label-md text-foreground-muted" hidden></p>
        </div>

        <p class="text-tiny text-foreground-subtle">
          Signing in with Ethereum asks your wallet to sign a message. It never sends a
          transaction and costs nothing.
        </p>
      </div>
    </Layout>
  )
}
