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
    case "definition":
      return "Definition"
    case "note":
      return "Note"
    case "alias":
      return "Also known as"
    case "references":
      return "Further reading"
    case "avoid":
      return "Forms to avoid"
    case "casing":
      return "Casing"
    case "category":
      return "Category"
    case "script_rule":
      return "Script rule"
    default:
      return `${kind} change`
  }
}

/** "Add: a, b. Remove: c." for the list-shaped metadata kinds. */
function addRemove(add: string[], remove: string[]): string {
  const parts: string[] = []
  if (add.length) parts.push(`Add: ${add.join(", ")}`)
  if (remove.length) parts.push(`Remove: ${remove.join(", ")}`)
  return parts.join(". ")
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
  if (p.kind === "definition") return String(payload.definition ?? "")
  if (p.kind === "note") return payload.note === null ? "Remove the note" : String(payload.note ?? "")
  if (p.kind === "script_rule") return String(payload.script_rule ?? "")
  if (p.kind === "casing") return `Write it ${String(payload.casing ?? "")}`
  if (p.kind === "category") return String(payload.category ?? "")
  if (p.kind === "alias") {
    const add = ((payload.add as Array<{ term: string }> | undefined) ?? []).map((a) => a.term)
    return addRemove(add, (payload.remove as string[] | undefined) ?? [])
  }
  if (p.kind === "references") {
    const add = ((payload.add as Array<{ label: string; url: string }> | undefined) ?? []).map((r) => `${r.label} (${r.url})`)
    return addRemove(add, (payload.remove as string[] | undefined) ?? [])
  }
  if (p.kind === "avoid") {
    return addRemove((payload.add as string[] | undefined) ?? [], (payload.remove as string[] | undefined) ?? [])
  }
  return JSON.stringify(payload)
}
