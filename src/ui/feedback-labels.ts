/**
 * How a person's own feedback reads back to them, shared by the term page
 * (what you said about this term) and the account page (everything you
 * have said). Labels only; nothing here touches the store.
 */

import type { Proposal } from "../feedback/store"

/** `one=x|other=y` as it is stored, back into "one x · other y" for reading. */
export function pluralValueLabel(value: string): string {
  return value
    .split("|")
    .map((pair) => pair.replace("=", " "))
    .join(" · ")
}

export function proposalKindLabel(kind: Proposal["kind"]): string {
  switch (kind) {
    case "new_term":
      return "New term"
    case "redundant":
      return "Flagged as redundant"
    case "split":
      return "Flagged for a split"
    default:
      return `${kind} change`
  }
}

export function describeProposal(p: Pick<Proposal, "kind" | "payload">): string {
  const payload = p.payload as Record<string, unknown>
  if (p.kind === "new_term") return String(payload.term ?? "")
  if (p.kind === "redundant") {
    const others = (payload.with as Array<{ term: string }> | undefined) ?? []
    return `Duplicates ${others.map((o) => `“${o.term}”`).join(", ")}`
  }
  if (p.kind === "split") {
    const into = (payload.into as Array<{ term: string }> | undefined) ?? []
    return `Into ${into.map((o) => `“${o.term}”`).join(", ")}`
  }
  return JSON.stringify(payload)
}
