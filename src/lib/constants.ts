/**
 * Canonical external URLs and shared UI constants.
 *
 * Anything that appears in more than one place, or that would need changing
 * if the project moved, belongs here rather than inline in a template.
 */

/** Where the translation community coordinates. */
export const DISCORD_URL = "https://ethereum.org/discord"

/** Source repository. */
export const GITHUB_URL = "https://github.com/ethereum/ethglossary"

/*
 * Social accounts.
 *
 * ETHGlossary has none of its own and should not grow any -- it is part of the
 * ethereum.org effort, so these are ethereum.org's, copied from that site's
 * own footer. Keep them in sync with it rather than inventing new ones.
 */
export const X_URL = "https://x.com/ethdotorg"
export const FARCASTER_URL = "https://farcaster.xyz/ethdotorg"

/** Handle for the `twitter:site` card attribution. */
export const X_HANDLE = "@ethdotorg"

/**
 * Share card. 1200x630, regenerated from the landing-page hero by
 * `scripts/build-og.sh`. Relative -- the origin is taken from the request, so
 * this works on whichever host the site is served from.
 */
export const OG_IMAGE = "/img/og.jpg"

/** Shown on share cards and in search results for pages with nothing better. */
export const SITE_NAME = "ETHGlossary"
export const SITE_DESCRIPTION =
  "Canonical Ethereum terminology in 24 languages -- an open style guide and translation reference for the Ethereum community."


/** Cookie holding the reviewer's last chosen language. */
export const LANG_COOKIE = "ethglossary-lang"

/** One year, in seconds. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Whether the accounts system is live.
 *
 * Sign-in, votes and suggestions all depend on a database and OAuth that ship
 * in a later phase. Until then every control that would need an account is
 * rendered disabled and labelled, rather than hidden -- a reviewer should be
 * able to see what the page will do, and understand why they cannot do it yet.
 *
 * Flip this to true when the auth phase lands.
 */
export const ACCOUNTS_ENABLED = false

/**
 * Tooltip for the controls ACCOUNTS_ENABLED gates.
 *
 * A hover string rather than text inside the button: the control should still
 * look like itself, so the page reads as the finished thing it will be.
 */
export const COMING_SOON_TITLE = "Coming soon -- this needs an account, which ships in a later phase"
