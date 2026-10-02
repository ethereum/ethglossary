/**
 * Page shell: <html> through </html>, plus the nav and footer every page shares.
 *
 * The theme script is inlined in <head> deliberately -- it has to run before
 * first paint or the page flashes the wrong palette. Everything else that is
 * interactive lives in an island loaded at the end of <body>.
 */

import type { Child } from "hono/jsx"
import { raw } from "hono/html"
import { getContext } from "hono/context-storage"
import type { AppEnv, SessionUser } from "../auth/session"
import { Icon } from "./icon"
import { cssHref } from "../lib/assets"
import { ROW_LINK_ISLAND } from "./row-link"
import { TOOLTIP_ISLAND } from "./tooltip"
import { NAV_DRAWER_ISLAND } from "./nav-drawer"
import { ACCOUNT_MENU_ISLAND } from "./account-menu"
import chevronDown from "lucide-static/icons/chevron-down.svg"
import menu from "lucide-static/icons/menu.svg"
import moon from "lucide-static/icons/moon.svg"
import x from "lucide-static/icons/x.svg"
import sun from "lucide-static/icons/sun.svg"
import heart from "lucide-static/icons/heart.svg"
import discord from "./icons/discord.svg"
import ethglossary from "./icons/ethglossary.svg"
import farcaster from "./icons/farcaster.svg"
import github from "./icons/github.svg"
import xMark from "./icons/x.svg"
import { ExternalLink } from "./link"
import {
  ACCOUNTS_ENABLED,
  COMING_SOON_TITLE,
  DISCORD_URL,
  FARCASTER_URL,
  GITHUB_URL,
  OG_IMAGE,
  SITE_NAME,
  X_HANDLE,
  X_URL,
} from "../lib/constants"

export type NavKey = "translations" | "style-guide" | null

/**
 * How the wordmark is colored.
 *
 * "hero" pins it yellow because the landing-page nav sits over the hero
 * artwork, which is dark in both themes. Everywhere else it takes --color-accent,
 * which is the brand yellow on a dark ground and violet on a light one.
 */
export type BrandTone = "default" | "hero"

/**
 * Where this page lives, for the canonical link and the share card.
 *
 * Taken from the incoming request rather than a constant, because the site
 * has already lived on more than one host (a workers.dev preview, now
 * glossary.ethereum.org). A hardcoded origin would make every share card
 * point at the wrong host for one of them -- and at a stale one forever if
 * nobody remembered.
 */
export interface PageUrl {
  origin: string
  path: string
}

interface LayoutProps {
  title: string
  description: string
  /** Request origin and path. Omitted only where there is no request. */
  url?: PageUrl
  /** Absolute-from-root path to a page-specific share image. */
  ogImage?: string
  /** Keeps a page out of search results without hiding it from readers. */
  noIndex?: boolean
  nav?: NavKey
  /** Full-bleed pages (the landing page) opt out of the shell container. */
  bare?: boolean
  /** Extra island script for this page, appended after the shared one. */
  island?: string
  /** Wordmark color. Pages whose nav sits over the hero art pass "hero". */
  brand?: BrandTone
  /** Language code the visitor has chosen, shown on the Translate tab. */
  activeLang?: string
  children?: Child
}

/**
 * Runs before paint. The default is the OS setting, applied by CSS alone when
 * <html> carries no data-theme. A stored preference exists only while it
 * disagrees with the OS: one that matches is dropped, so a reader who toggles
 * back (or whose OS comes round to their choice) follows the system again
 * instead of being pinned to a value they never meant to keep. Wrapped in
 * try/catch because storage throws outright in some privacy modes.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var os = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    var t = localStorage.getItem("ethglossary-theme");
    if (t === os) {
      localStorage.removeItem("ethglossary-theme");
      t = null;
    }
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    }
    // Keep the toggle's label honest before first paint. Server-rendered it
    // assumes dark; correct it when the resolved theme is actually light.
    if ((t || os) === "light") {
      document.addEventListener("DOMContentLoaded", function () {
        var b = document.getElementById("theme-toggle");
        if (b) b.setAttribute("aria-label", "Switch to dark theme");
      });
    }
  } catch (e) {}
})();
`

const TOGGLE_SCRIPT = `
(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  var root = document.documentElement;
  var mq = window.matchMedia("(prefers-color-scheme: light)");
  function resolved() {
    return root.getAttribute("data-theme") || (mq.matches ? "light" : "dark");
  }
  function label() {
    btn.setAttribute("aria-label", resolved() === "light" ? "Switch to dark theme" : "Switch to light theme");
  }
  btn.addEventListener("click", function () {
    var next = resolved() === "light" ? "dark" : "light";
    var os = mq.matches ? "light" : "dark";
    // Choosing what the OS already says is choosing to follow the OS.
    if (next === os) {
      root.removeAttribute("data-theme");
      try { localStorage.removeItem("ethglossary-theme"); } catch (e) {}
    } else {
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("ethglossary-theme", next); } catch (e) {}
    }
    label();
  });
  // CSS follows an OS switch on its own while unstamped; the label must too.
  mq.addEventListener("change", label);
})();
`

/*
 * Two tabs, not three.
 *
 * Picking a language and reviewing one used to be separate destinations
 * ("Languages" and "Translate"), which split one task across two tabs and
 * left the reader guessing which was which. They are now one section --
 * /translations is the picker, /translations/:lang is the work.
 */
const NAV_ITEMS: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "translations", href: "/translations", label: "Translations" },
  { key: "style-guide", href: "/style-guide", label: "Style guide" },
]

/**
 * Where the Translations tab goes.
 *
 * Straight into the chosen language once there is one, because that is the
 * only place a reader can actually contribute. With no language chosen it
 * lands on the picker.
 */
const navHref = (item: (typeof NAV_ITEMS)[number], activeLang?: string) =>
  item.key === "translations" && activeLang ? `/translations/${activeLang}` : item.href

/**
 * Who is signed in, if anyone, read from the request context so no page has
 * to thread it through. Null outside a request (never the case in practice)
 * and for visitors without a session.
 */
export function currentUser(): SessionUser | null {
  try {
    return getContext<AppEnv>().var.user ?? null
  } catch {
    return null
  }
}

/** Whether sign-in is possible at all right now, as the session middleware determined. */
function accountsAvailable(): boolean {
  try {
    return getContext<AppEnv>().var.accountsAvailable === true
  } catch {
    return false
  }
}

/**
 * The sign-in control.
 *
 * Until ACCOUNTS_ENABLED flips, the nav is exactly what it was before accounts
 * existed: the inert "coming soon" button, for everyone, whatever the
 * database says. /signin and /account still answer by URL, so the sign-in
 * flows can be verified in production before there is anything for a
 * signed-in person to do. After the flip, three states. Signed in: the
 * display name, which discloses Profile and Sign out -- a <details> in the
 * bar, plain rows in the drawer where there is room. Signed out with
 * accounts available: a link to /signin that returns to the current page.
 * No database: the inert button again.
 */
export const SignInControl = ({
  block,
  path,
  brand = "default",
}: { block?: boolean; path?: string; brand?: BrandTone } = {}) => {
  const user = currentUser()
  // On the hero the nav floats over artwork that is dark in both themes, so
  // the name is a fixed white like the theme toggle beside it. The menu that
  // drops from it is a themed panel and keeps the page's colours.
  const hero = brand === "hero"
  const pill = `whitespace-nowrap rounded-full bg-primary px-4 py-2 text-label-md font-bold text-primary-foreground ${
    block ? "w-full" : ""
  }`

  if (!ACCOUNTS_ENABLED) {
    return (
      <button type="button" class={`cursor-not-allowed ${pill}`} aria-disabled="true" data-tip={COMING_SOON_TITLE}>
        Sign in
      </button>
    )
  }

  if (user) {
    const name = user.displayName ?? "Account"
    // Sign-out returns to the page it was clicked on; the route falls back to home.
    const signOut = (cls: string) => (
      <form method="post" action="/auth/signout">
        {path ? <input type="hidden" name="next" value={path} /> : null}
        <button type="submit" class={cls}>
          Sign out
        </button>
      </form>
    )
    if (block) {
      const row = "rounded-md px-3 py-3 text-body text-foreground hover:bg-muted"
      return (
        <div class="flex flex-col border-t border-border-subtle pt-3">
          <p class="truncate px-3 py-2 text-label-md font-bold text-foreground-strong">{name}</p>
          <a class={`${row} no-underline hover:no-underline`} href="/account">
            Profile
          </a>
          {signOut(`${row} w-full text-left`)}
        </div>
      )
    }
    const item = "rounded-md px-3 py-2 text-label-md leading-6 text-foreground hover:bg-muted hover:text-foreground-strong"
    return (
      <details class="group relative" id="account-menu">
        <summary
          class={`flex list-none items-center gap-1 text-label-md leading-6 font-bold hover:underline [&::-webkit-details-marker]:hidden ${
            hero ? "text-white" : "text-foreground-strong"
          }`}
          aria-label={`Account menu for ${name}`}
        >
          <span class="max-w-48 truncate">{name}</span>
          <Icon svg={chevronDown} class="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div class="absolute end-0 top-full z-50 mt-2 flex min-w-40 flex-col rounded-card border border-border bg-background p-1 shadow-xl">
          <a class={`${item} no-underline hover:no-underline`} href="/account">
            Profile
          </a>
          {signOut(`${item} w-full text-left`)}
        </div>
      </details>
    )
  }

  if (!accountsAvailable()) {
    return (
      <button type="button" class={`cursor-not-allowed ${pill}`} aria-disabled="true" data-tip={COMING_SOON_TITLE}>
        Sign in
      </button>
    )
  }

  const next = path && path !== "/signin" ? `?next=${encodeURIComponent(path)}` : ""
  return (
    <a
      class={`inline-block text-center ${pill} no-underline transition-[filter] hover:brightness-110 hover:no-underline`}
      href={`/signin${next}`}
    >
      Sign in
    </a>
  )
}

export const Nav = ({
  active,
  brand = "default",
  activeLang,
  path,
}: {
  active: NavKey
  brand?: BrandTone
  activeLang?: string
  /** Current page, so "Sign in" can come back to it. */
  path?: string
}) => (
  <nav
    class={`z-20 h-16 ${
      brand === "hero"
        ? // Floats over the hero artwork rather than sitting above it. Not
          // sticky, so it simply scrolls away instead of becoming an
          // unreadable transparent bar over the page content.
          "absolute inset-x-0 top-0 bg-transparent"
        : "sticky top-0 border-b border-border-subtle bg-background"
    }`}
  >
    <div class="wrap flex h-full items-center gap-6">
      <a
        class={`flex shrink-0 items-center gap-2.5 text-h4 font-bold tracking-tight no-underline hover:no-underline ${
          brand === "hero" ? "text-primary" : "text-accent"
        }`}
        href="/"
      >
        <Icon svg={ethglossary} class="h-6.5" />
        {/*
          Inline flow rather than another flex child, so <sub> keeps its
          vertical-align -- a flex item's vertical-align is ignored, and the
          mark would sit on the baseline like an ordinary word.
        */}
        <span>
          ETHGlossary
          {/*
            A fixed white tint on the hero, not --color-foreground-subtle:
            the LP nav floats over artwork that is dark in both themes, so a
            themed grey would resolve to the light-mode one on a light page
            and vanish into the picture.
          */}
          <sub
            class={`ms-1 text-tiny font-bold uppercase tracking-widest ${
              brand === "hero" ? "text-white/60" : "text-foreground-subtle"
            }`}
          >
            Beta
          </sub>
        </span>
      </a>

      {/*
        Tabs are not part of the landing page -- it has its own CTAs, and the
        Figma's LP nav carries the wordmark and sign-in only.
      */}
      {brand === "hero" ? null : (
        <ul class="mx-auto hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <li>
              <a
                class={`block px-3.5 py-1.5 text-label-md transition-colors hover:no-underline ${
                  active === item.key
                    ? // A tab, not a pill: the hover surface, rounded on top
                      // only at 4px, sitting on a 1px accent rule.
                      "rounded-t-sm border-b border-accent bg-muted font-bold text-accent"
                    : "rounded-md text-foreground-subtle hover:bg-muted hover:text-foreground-strong"
                }`}
                href={navHref(item, activeLang)}
                aria-current={active === item.key ? "page" : undefined}
              >
                {item.label}
                {/*
                  The Translate tab carries the chosen language, so the choice
                  the cookie is making is visible from anywhere on the site.
                */}
                {item.key === "translations" && activeLang ? (
                  <span class="ml-1 font-normal opacity-70">({activeLang})</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div class="ml-auto flex items-center gap-3">
        {/* Hidden below md, where it lives in the drawer instead. */}
        <span class="hidden md:block">
          <SignInControl path={path} brand={brand} />
        </span>
        <button
          id="theme-toggle"
          /*
            Body text colour, the same as the hamburger it sits beside -- two
            adjacent icon buttons doing the same kind of job should not be
            two different colours. On the hero it is a fixed white, because
            that nav floats over artwork that is dark in both themes.
          */
          class={`grid size-8 place-items-center rounded-md ${
            brand === "hero"
              ? "text-white hover:bg-white/10"
              : "text-foreground hover:bg-muted"
          }`}
          type="button"
          aria-label="Switch to light theme"
        >
          <Icon svg={sun} class="hidden size-4.5 light-theme:inline-flex" />
          <Icon svg={moon} class="inline-flex size-4.5 light-theme:hidden" />
        </button>

        {/* Hamburger sits right of the theme toggle, and only below md. */}
        <button
          id="nav-toggle"
          type="button"
          class={`grid size-8 place-items-center rounded-md md:hidden ${
            brand === "hero"
              ? "text-white hover:bg-white/10"
              : "text-foreground hover:bg-muted"
          }`}
          aria-expanded="false"
          aria-controls="nav-drawer"
          aria-label="Open menu"
        >
          <Icon svg={menu} class="size-6" />
        </button>
      </div>
    </div>

    {/*
      A real <dialog>, opened with showModal().

      The browser then owns the parts that are easy to get subtly wrong: the
      focus trap, inerting the page behind, Escape to close, returning focus
      to whatever opened it, and the backdrop element. The script below is
      only what the platform does not give us -- the toggle, closing on a
      link, and the breakpoint reset.

      UA styles centre a dialog and cap its size, so the reset classes here
      are load-bearing: m-0/ms-auto pins it right, max-h-none/max-w-none
      undoes the cap, border-0/p-0 undoes the chrome.
    */}
    <dialog
      id="nav-drawer"
      aria-label="Menu"
      class="nav-drawer m-0 ms-auto h-dvh max-h-none w-[min(20rem,85vw)] max-w-none border-0 bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm md:hidden"
    >
      <div class="flex h-full flex-col gap-2 p-6">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-label-md font-bold text-foreground-subtle">Menu</span>
          {/* formmethod="dialog" closes the dialog with no script at all. */}
          <form method="dialog">
            <button
              type="submit"
              class="grid size-8 place-items-center rounded-md text-foreground hover:bg-muted"
              aria-label="Close menu"
            >
              <Icon svg={x} class="size-6" />
            </button>
          </form>
        </div>

        {NAV_ITEMS.map((item) => (
          <a
            class={`rounded-md px-3 py-3 text-body no-underline hover:bg-muted hover:no-underline ${
              active === item.key ? "bg-muted font-bold text-accent" : "text-foreground"
            }`}
            href={navHref(item, activeLang)}
            aria-current={active === item.key ? "page" : undefined}
          >
            {item.label}
            {item.key === "translations" && activeLang ? (
              <span class="ml-1 font-normal opacity-70">({activeLang})</span>
            ) : null}
          </a>
        ))}

        <div class="mt-4">
          <SignInControl block path={path} />
        </div>
      </div>
    </dialog>
  </nav>
)

/*
 * Sizes differ because the marks do not fill their viewBox equally -- the
 * Discord and GitHub glyphs sit inside padding the X and Farcaster ones do
 * not, so a single class would make the latter two look oversized.
 */
const SOCIALS = [
  { svg: discord, href: DISCORD_URL, label: "ETHGlossary on Discord", size: "size-8" },
  { svg: github, href: GITHUB_URL, label: "ETHGlossary on GitHub", size: "size-7" },
  { svg: xMark, href: X_URL, label: "ethereum.org on X", size: "size-6" },
  { svg: farcaster, href: FARCASTER_URL, label: "ethereum.org on Farcaster", size: "size-6" },
]

export const Footer = () => (
  <footer class="bg-plum-700 text-white">
    {/*
      Figma 18:357: a centred column -- socials first, tagline below in Noto
      Serif, not the left/right row this used to be.
    */}
    <div class="wrap flex flex-col items-center gap-8 pt-12 pb-8">
      <div class="flex flex-wrap items-center justify-center gap-6">
        <a class="text-label-sm text-white/80 hover:text-white" href="/docs">
          API docs
        </a>
        {/*
          Discord and GitHub are ETHGlossary's own. X and Farcaster are
          ethereum.org's -- this project has no accounts of its own, so it
          points at the same ones that site's footer does.
        */}
        {SOCIALS.map((social) => (
          <ExternalLink
            class="grid place-items-center text-white/80 hover:text-white"
            href={social.href}
            aria-label={social.label}
            hideArrow
          >
            <Icon svg={social.svg} class={social.size} />
          </ExternalLink>
        ))}
      </div>
      <p class="text-center font-serif text-label-sm text-white">
        An open-source project, made with{" "}
        <Icon svg={heart} class="heartbeat inline-flex size-4 align-text-bottom text-rose" aria-hidden="true" />
        <span class="sr-only">love</span> for the Ethereum community. MPL-2.0.
      </p>
    </div>
  </footer>
)

export const Layout = ({
  title,
  description,
  url,
  ogImage,
  noIndex,
  nav = null,
  bare,
  island,
  brand = "default",
  activeLang,
  children,
}: LayoutProps) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="color-scheme" content="dark light" />
      {noIndex ? <meta name="robots" content="noindex, follow" /> : null}
      {url ? <link rel="canonical" href={url.origin + url.path} /> : null}

      {/*
        Share card. og:image has to be absolute -- every crawler rejects a
        relative one -- which is the whole reason `url` is threaded down here.
      */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:locale" content="en_US" />
      {url ? <meta property="og:url" content={url.origin + url.path} /> : null}
      {url ? <meta property="og:image" content={url.origin + (ogImage ?? OG_IMAGE)} /> : null}
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta
        property="og:image:alt"
        content="An illustrated Ethereum cityscape at dusk, the ETHGlossary hero artwork"
      />
      <meta name="twitter:card" content="summary_large_image" />
      {/* ETHGlossary has no accounts of its own; attribution goes to ethereum.org. */}
      <meta name="twitter:site" content={X_HANDLE} />
      <meta name="twitter:creator" content={X_HANDLE} />

      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/favicon.svg" />
      <link rel="stylesheet" href={cssHref()} />
      <link
        rel="preload"
        href="/fonts/noto-sans-latin-400-normal.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/noto-serif-latin-700-normal.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <script>{raw(THEME_SCRIPT)}</script>
    </head>
    {/*
      Column so a short page (a 404, an empty search) still puts the footer at
      the bottom of the viewport rather than floating it mid-screen.
    */}
    <body class="flex min-h-dvh flex-col">
      <Nav active={nav} brand={brand} activeLang={activeLang} path={url?.path} />
      {/*
        Always a <main>; `bare` only controls whether it carries the shell
        container. Without this the landing page has no main landmark at all.
      */}
      <main class={`flex-1 ${bare ? "" : "wrap"}`}>{children}</main>
      <Footer />
      <script>{raw(TOGGLE_SCRIPT)}</script>
      <script>{raw(TOOLTIP_ISLAND)}</script>
      <script>{raw(ROW_LINK_ISLAND)}</script>
      <script>{raw(NAV_DRAWER_ISLAND)}</script>
      {currentUser() ? <script>{raw(ACCOUNT_MENU_ISLAND)}</script> : null}
      {island ? <script>{raw(island)}</script> : null}
    </body>
  </html>
)
