/**
 * Who may act. Every feedback control is rendered in one of three states:
 * `off` is the inert "coming soon" state the site has always shown; `signin`
 * keeps the control looking live and answers a click with a popover that
 * links to sign-in; `live` adds nothing and lets the island take the click.
 */

import { COMING_SOON_TITLE } from "../lib/constants"

export type FeedbackMode = "off" | "signin" | "live"

/** The attributes that make a control explain itself when it cannot act. */
export function gate(mode: FeedbackMode, signinHref: string, verb: string): Record<string, string> {
  if (mode === "live") return {}
  if (mode === "signin") {
    return { "data-tip": `Sign in to ${verb}`, "data-tip-href": signinHref }
  }
  return { "aria-disabled": "true", "data-tip": COMING_SOON_TITLE }
}
