/**
 * The two things every page render needs from the request: where it is, and
 * which language the reader last chose. Shared by the viewer and the account
 * routes so there is one definition of each.
 */

import type { Context } from "hono"
import type { PageUrl } from "../ui/layout"
import { languageFromCookie } from "./negotiate-language"
import { requestOrigin } from "./request-origin"

/**
 * Origin and path for the canonical link and share card.
 *
 * Read off the request every time rather than stored in a constant -- the
 * site has answered on more than one host, and a share card has to name
 * whichever host the visitor actually reached. The scheme comes from the
 * proxy's forwarded header; see src/lib/request-origin.ts. Query strings are
 * dropped: ?category= is a filter, not a separate page.
 */
export const pageUrl = (c: Context): PageUrl => ({
  origin: requestOrigin(c.req),
  path: new URL(c.req.url).pathname,
})

/** The language on the nav's Translations tab, if one has been chosen. */
export const navLang = (c: Context): string | undefined => languageFromCookie(c.req.header("Cookie"))
