/**
 * The two structural flags about a term -- redundant with another, should be
 * split -- and the dialog shell proposals use. They are about the English
 * entry, not any translation, so both the translate page and the style
 * guide page carry them; the island snippet below posts them anchored to
 * the entry's hash, which the forms carry as data attributes.
 */

import { Icon } from "./icon"
import flag from "lucide-static/icons/flag.svg"
import x from "lucide-static/icons/x.svg"
import { gate } from "./gate"
import type { FeedbackMode } from "./gate"
import { DIALOG } from "./withdraw"
import { FIELD, GHOST, PRIMARY } from "./feedback-shared"

/** A modal with a title, an intro, a form and the submit/cancel pair. The form's `data-note` is where the island reports. */
export const ProposalDialog = ({
  id,
  formId,
  title,
  intro,
  children,
  submit,
  formAttrs = {},
}: {
  id: string
  formId: string
  title: string
  intro: string
  children?: unknown
  submit: string
  /** Extra attributes on the form, for what the island needs to read back (term id, hash). */
  formAttrs?: Record<string, string>
}) => (
  <dialog id={id} class={DIALOG} aria-labelledby={`${id}-title`}>
    <div class="flex flex-col gap-4 p-6">
      <div class="flex items-start justify-between gap-4">
        <h2 id={`${id}-title`} class="font-serif text-h4 font-medium text-foreground-strong">
          {title}
        </h2>
        <form method="dialog">
          <button type="submit" class="grid size-8 place-items-center rounded-md text-foreground hover:bg-muted" aria-label="Close">
            <Icon svg={x} class="size-5" />
          </button>
        </form>
      </div>
      <p class="text-body text-foreground-muted">{intro}</p>
      <form id={formId} class="flex flex-col gap-3" {...formAttrs}>
        {children as never}
        <p data-note role="alert" class="text-label-md text-rose" hidden></p>
        <div class="mt-2 flex items-center gap-3">
          <button type="submit" class={PRIMARY}>
            {submit}
          </button>
          <button type="button" class={GHOST} onclick={`document.getElementById('${id}').close()`}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  </dialog>
)

const FLAG = "text-accent hover:underline aria-disabled:cursor-not-allowed aria-disabled:no-underline"

/** "Something off about this term?" with the two flags, gated like every other control. */
export const TermFlags = ({ mode, signinHref }: { mode: FeedbackMode; signinHref: string }) => (
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-label-md text-foreground-subtle">
    <span class="inline-flex items-center gap-1.5">
      <Icon svg={flag} class="size-3.5" />
      Something off about this term?
    </span>
    <button type="button" class={FLAG} data-open-dialog="flag-redundant-dialog" {...gate(mode, signinHref, "flag a term")}>
      Redundant with another term
    </button>
    <button type="button" class={FLAG} data-open-dialog="flag-split-dialog" {...gate(mode, signinHref, "flag a term")}>
      Should be split in two
    </button>
  </div>
)

const LABEL = "flex flex-col gap-1 text-label-md text-foreground-subtle"

/** The two flag dialogs, rendered only in live mode. */
export const TermFlagDialogs = ({ term, termId, termHash }: { term: string; termId: string; termHash: string }) => {
  const anchor = { "data-term-id": termId, "data-term-hash": termHash }
  return (
    <>
      <ProposalDialog
        id="flag-redundant-dialog"
        formId="flag-redundant-form"
        title={`Is “${term}” redundant?`}
        intro="Name the term or terms this one duplicates. The maintainers will look at merging them."
        submit="Send flag"
        formAttrs={anchor}
      >
        <label class={LABEL}>
          Redundant with (one per line, or comma-separated)
          <textarea name="with" class={`${FIELD} min-h-16`} required maxlength={1000} placeholder="e.g. smart contract"></textarea>
        </label>
        <label class={LABEL}>
          Why (optional)
          <textarea name="reason" class={`${FIELD} min-h-16`} maxlength={1000}></textarea>
        </label>
      </ProposalDialog>

      <ProposalDialog
        id="flag-split-dialog"
        formId="flag-split-form"
        title={`Should “${term}” be split?`}
        intro="List the separate terms this entry should become, one per line."
        submit="Send flag"
        formAttrs={anchor}
      >
        <label class={LABEL}>
          Split into
          <textarea name="into" class={`${FIELD} min-h-20`} required maxlength={1000} placeholder={"gas (concept)\ngas limit"}></textarea>
        </label>
        <label class={LABEL}>
          Why (optional)
          <textarea name="reason" class={`${FIELD} min-h-16`} maxlength={1000}></textarea>
        </label>
      </ProposalDialog>
    </>
  )
}

/**
 * Paste inside an island IIFE after the shared prelude (`call`, `say`).
 * `proposalForm(id, build)` wires any proposal dialog: `build(data, form)`
 * returns the request body or throws a message for the form's note. The two
 * flags register themselves; the new-term form registers from its own page.
 */
export const TERM_FLAGS_ISLAND = `
  function formNote(f, text) { var n = f.querySelector("[data-note]"); if (n) { n.textContent = text; n.hidden = !text; } }
  function splitLines(text) { return String(text || "").split(/\\r?\\n|,/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function proposalForm(id, build) {
    var f = document.getElementById(id);
    if (!f) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var body;
      try { body = build(new FormData(f), f); } catch (err) { formNote(f, err.message); return; }
      var btn = f.querySelector('button[type="submit"]');
      btn.setAttribute("aria-busy", "true");
      call("POST", "/api/v1/feedback/proposals", body)
        .then(function () {
          f.reset(); formNote(f, "");
          var dlg = f.closest("dialog"); if (dlg) dlg.close();
          say("Thanks. Your proposal is with the maintainers.", "ok");
          setTimeout(function () { location.reload(); }, 800);
        })
        .catch(function (err) { if (err.message !== "signed out" && err.message !== "stale") formNote(f, err.message); })
        .finally(function () { btn.removeAttribute("aria-busy"); });
    });
  }
  proposalForm("flag-redundant-form", function (d, f) {
    var others = splitLines(d.get("with"));
    if (!others.length) throw new Error("Name at least one other term.");
    var reason = String(d.get("reason") || "").trim();
    return { kind: "redundant", termId: f.getAttribute("data-term-id"), hash: f.getAttribute("data-term-hash"), payload: { with: others }, reason: reason || undefined };
  });
  proposalForm("flag-split-form", function (d, f) {
    var into = splitLines(d.get("into")).map(function (t) { return { term: t }; });
    if (into.length < 2) throw new Error("Give at least two terms, one per line.");
    var reason = String(d.get("reason") || "").trim();
    return { kind: "split", termId: f.getAttribute("data-term-id"), hash: f.getAttribute("data-term-hash"), payload: { into: into }, reason: reason || undefined };
  });
`
