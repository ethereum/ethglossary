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
/** Exported at 1200x630, the size every share card is laid out at; the tags state that size. */
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
 * Whether the accounts system is live for visitors.
 *
 * Sign-in is built and reachable at /signin, but the nav does not link to it
 * and every vote and suggestion control stays disabled and labelled until
 * there is something a signed-in person can do. Flip this in the PR that
 * ships votes and suggestions, and the whole surface appears at once.
 */
export const ACCOUNTS_ENABLED = true

/**
 * Tooltip for the controls ACCOUNTS_ENABLED gates.
 *
 * A hover string rather than text inside the button: the control should still
 * look like itself, so the page reads as the finished thing it will be.
 */
export const COMING_SOON_TITLE = "Coming soon -- this needs an account, which ships in a later phase"
