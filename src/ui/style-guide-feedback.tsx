/**
 * Feedback on the English entry, for /style-guide/:termId: a thumb on the
 * definition, and "Suggest changes", which opens every reviewable field
 * prefilled. On save the island compares each field with what was shown and
 * sends one proposal per field that changed, so the maintainers' export
 * reads as separate, reviewable items -- the same proposals the API has
 * always accepted; this is the form that was missing.
 */

import { Icon } from "./icon"
import squarePen from "lucide-static/icons/square-pen.svg"
import thumbsDown from "lucide-static/icons/thumbs-down.svg"
import thumbsUp from "lucide-static/icons/thumbs-up.svg"
import x from "lucide-static/icons/x.svg"
import type { GlossaryTerm } from "../lib/glossary-data"
import { definitionToText } from "../lib/sanitize"
import type { Proposal, Tally } from "../feedback/store"
import { gate } from "./gate"
import type { FeedbackMode } from "./gate"
import { describeProposal, proposalKindLabel } from "./feedback-labels"
import { DIALOG, Tick, WithdrawToolbar } from "./withdraw"
import info from "lucide-static/icons/info.svg"
import { CASING_MEANING, CATEGORY_MEANING, SCRIPT_RULE_MEANING } from "./term-meta"
import { FIELD, GHOST, ISLAND_HELPERS, PRIMARY, VOTE } from "./feedback-shared"
import { TERM_FLAGS_ISLAND } from "./term-flags"

export interface StyleGuideFeedback {
  mode: FeedbackMode
  signinHref: string
  /** Hash of the whole English entry; what metadata proposals are anchored to. */
  termHash: string
  /** The definition's own hash and tallies, or null when the term has no definition. */
  definition: { hash: string; tally: Tally; mine: "up" | "down" | null } | null
  /** The reader's own open proposals about this term. */
  myProposals: Proposal[]
  /** Every topical category in the data, for the category select. */
  categories: string[]
}

export const OFF_STYLE_GUIDE_FEEDBACK: StyleGuideFeedback = {
  mode: "off",
  signinHref: "/signin",
  termHash: "",
  definition: null,
  myProposals: [],
  categories: [],
}

const LABEL = "flex flex-col gap-1 text-label-md text-foreground-subtle"

/*
 * Inside a modal the click-to-explain popover cannot be used: the dialog's
 * top layer covers it and the page behind is inert. So the info icon is a
 * <details> summary that unfolds the explanation in place, which also means
 * it works with no script and reads in order for a screen reader.
 */
const Explain = ({ label, children }: { label: string; children?: unknown }) => (
  <details class="group inline">
    <summary
      class="inline-grid size-5 cursor-pointer list-none place-items-center rounded-full align-text-bottom text-foreground-subtle hover:text-foreground-strong [&::-webkit-details-marker]:hidden"
      aria-label={label}
    >
      <Icon svg={info} class="size-3.5" />
    </summary>
    <div class="mt-1 rounded-md bg-muted px-3 py-2 text-tiny/relaxed text-foreground-muted">{children as never}</div>
  </details>
)

const HINT = "text-tiny text-foreground-subtle"

/** Up and down on the definition. Counts are public; the buttons gate like every other control. */
export const DefinitionVotes = ({ feedback }: { feedback: StyleGuideFeedback }) => {
  const { mode, signinHref, definition } = feedback
  const counts = mode === "off" || !definition
  const button = (direction: "up" | "down", svg: string, label: string) => (
    <button
      class={`${VOTE} ${direction === "up" ? "aria-pressed:text-teal" : "aria-pressed:text-rose"}`}
      type="button"
      aria-pressed={definition?.mine === direction ? "true" : "false"}
      aria-label={`${label} this definition`}
      data-vote={direction}
      {...gate(mode, signinHref, "vote")}
    >
      <Icon svg={svg} class="size-4.5" />
      <span data-count="">{counts ? "–" : String(direction === "up" ? definition.tally.up : definition.tally.down)}</span>
    </button>
  )
  return (
    <span class="flex items-center gap-1" data-field="definition" data-hash={definition?.hash ?? ""}>
      {button("up", thumbsUp, "Approve")}
      {button("down", thumbsDown, "Disapprove of")}
    </span>
  )
}

export const SuggestChangesButton = ({ feedback }: { feedback: StyleGuideFeedback }) => (
  <button
    type="button"
    class="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent px-4 py-2 text-label-md font-bold text-accent hover:bg-accent/10 aria-disabled:cursor-not-allowed"
    data-open-dialog="suggest-changes-dialog"
    {...gate(feedback.mode, feedback.signinHref, "suggest changes")}
  >
    <Icon svg={squarePen} class="size-4" />
    Suggest changes
  </button>
)

const aliasTerm = (a: string | { term: string }): string => (typeof a === "string" ? a : a.term)

/**
 * Every reviewable field, prefilled. `data-current` carries the same values
 * the fields were filled from, so the island can tell what changed without
 * re-deriving it from the markup.
 */
export const SuggestChangesDialog = ({ term, feedback }: { term: GlossaryTerm; feedback: StyleGuideFeedback }) => {
  const current = {
    definition: definitionToText(term.definition).trim(),
    note: term.note ?? "",
    aliases: (term.aliases ?? []).map(aliasTerm),
    references: term.references ?? [],
    avoid: term.avoid ?? [],
    casing: term.casing,
    category: term.category,
    script_rule: term.script_rule ?? "",
  }
  // The v1 policy's values, plus the term's own if it still carries a legacy one, so the prefill is honest.
  const scriptRules = [...Object.keys(SCRIPT_RULE_MEANING).filter((k) => k !== "hybrid" && k !== "context_dependent")]
  if (current.script_rule && !scriptRules.includes(current.script_rule)) scriptRules.push(current.script_rule)
  const id = "suggest-changes-dialog"
  return (
    <dialog id={id} class={DIALOG} aria-labelledby={`${id}-title`}>
      <div class="flex flex-col gap-4 p-6">
        <div class="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} class="font-serif text-h4 font-medium text-foreground-strong">
            Suggest changes to &ldquo;{term.term}&rdquo;
          </h2>
          <form method="dialog">
            <button type="submit" class="grid size-8 place-items-center rounded-md text-foreground hover:bg-muted" aria-label="Close">
              <Icon svg={x} class="size-5" />
            </button>
          </form>
        </div>
        <p class="text-body text-foreground-muted">
          Edit what should be different and leave the rest. Each field you change becomes its own
          suggestion for the maintainers; nothing changes on the site until they act on it.
        </p>
        <form id="suggest-changes-form" class="flex flex-col gap-4" data-current={JSON.stringify(current)}>
          <label class={LABEL}>
            Definition
            <textarea name="definition" class={`${FIELD} min-h-28`} maxlength={2000}>
              {current.definition}
            </textarea>
            <span class={HINT}>Plain text. Links belong under Further reading.</span>
          </label>
          <label class={LABEL}>
            Note
            <textarea name="note" class={`${FIELD} min-h-16`} maxlength={1000}>
              {current.note}
            </textarea>
            {current.note ? <span class={HINT}>Clear the field to propose removing the note.</span> : null}
          </label>
          <label class={LABEL}>
            Also known as
            <textarea name="aliases" class={`${FIELD} min-h-16`} placeholder="One per line">
              {current.aliases.join("\n")}
            </textarea>
          </label>
          <label class={LABEL}>
            Further reading
            <textarea name="references" class={`${FIELD} min-h-16`} placeholder={"Label | https://example.org/page\nOne per line"}>
              {current.references.map((r) => `${r.label} | ${r.url}`).join("\n")}
            </textarea>
            <span class={HINT}>https links only. A line without a label uses the address as its label.</span>
          </label>
          <label class={LABEL}>
            Forms to avoid
            <textarea name="avoid" class={`${FIELD} min-h-16`} placeholder="One per line">
              {current.avoid.join("\n")}
            </textarea>
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class={LABEL}>
              <span>
                Script rule <Explain label="What the script rule options mean">
                  <dl class="flex flex-col gap-2">
                    {scriptRules.map((k) => (
                      <div>
                        <dt class="font-bold text-foreground-strong">{k}</dt>
                        <dd>{SCRIPT_RULE_MEANING[k]}</dd>
                      </div>
                    ))}
                  </dl>
                </Explain>
              </span>
              <select name="script_rule" class={FIELD}>
                {scriptRules.map((v) => (
                  <option value={v} selected={v === current.script_rule}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label class={LABEL}>
              <span>
                Casing <Explain label="What the casing options mean">
                  <dl class="flex flex-col gap-2">
                    {Object.entries(CASING_MEANING).map(([k, v]) => (
                      <div>
                        <dt class="font-bold text-foreground-strong">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Explain>
              </span>
              <select name="casing" class={FIELD}>
                {["standard", "proper", "uppercase", "fixed"].map((v) => (
                  <option value={v} selected={v === current.casing}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label class={LABEL}>
              <span>
                Category <Explain label="What the category is for">
                  {CATEGORY_MEANING} Pick the closest; the maintainers can refine it.
                </Explain>
              </span>
              <select name="category" class={FIELD}>
                {feedback.categories.map((v) => (
                  <option value={v} selected={v === current.category}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label class={LABEL}>
            Why (optional)
            <textarea name="reason" class={`${FIELD} min-h-16`} maxlength={1000}></textarea>
          </label>
          <p data-note role="alert" class="text-label-md text-rose" hidden></p>
          <div class="mt-2 flex items-center gap-3">
            <button type="submit" class={PRIMARY}>
              Send suggestions
            </button>
            <button type="button" class={GHOST} onclick={`document.getElementById('${id}').close()`}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}

/** The reader's own open proposals about this term, with Withdraw. Nobody else's. */
export const OpenFeedback = ({ feedback }: { feedback: StyleGuideFeedback }) =>
  feedback.mode === "live" && feedback.myProposals.length ? (
    <div class="flex flex-col gap-3">
      <p class="text-body font-bold text-foreground-subtle">Your open feedback on this term</p>
      {feedback.myProposals.length > 1 ? <WithdrawToolbar /> : null}
      <ul class="flex flex-col gap-2">
        {feedback.myProposals.map((p) => (
          <li class="flex items-start justify-between gap-3 rounded-md bg-card px-4 py-3">
            <Tick value={`proposals:${p.id}`} label={`the ${proposalKindLabel(p.kind).toLowerCase()} suggestion`} />
            <span class="min-w-0 flex-1">
              <span class="block text-tiny uppercase tracking-wider text-foreground-subtle">{proposalKindLabel(p.kind)}</span>
              <span class="text-body text-foreground-strong">{describeProposal(p)}</span>
              {p.reason ? <span class="block text-label-md text-foreground-muted">{p.reason}</span> : null}
            </span>
            <button type="button" class={GHOST} data-withdraw="proposals" data-id={p.id}>
              Withdraw
            </button>
          </li>
        ))}
      </ul>
      <a class="self-start text-label-md text-accent" href="/account">
        Everything you have suggested, on your account page
      </a>
    </div>
  ) : null

export const STYLE_GUIDE_FEEDBACK_ISLAND = `
(function () {
  var root = document.querySelector("[data-sg-feedback]");
  if (!root || root.getAttribute("data-sg-feedback") !== "live") return;
  var termId = root.getAttribute("data-term-id");
  var termHash = root.getAttribute("data-term-hash");
  var signin = root.getAttribute("data-signin");
  var status = document.getElementById("feedback-status");

  ${ISLAND_HELPERS}
  ${TERM_FLAGS_ISLAND}

  // ------------------------------------------------- definition votes
  function paint(t) {
    var row = root.querySelector('[data-field="' + t.field + '"]'); if (!row) return;
    var up = row.querySelector('[data-vote="up"]'), down = row.querySelector('[data-vote="down"]');
    up.querySelector("[data-count]").textContent = String(t.up); down.querySelector("[data-count]").textContent = String(t.down);
    up.setAttribute("aria-pressed", t.mine === "up" ? "true" : "false"); down.setAttribute("aria-pressed", t.mine === "down" ? "true" : "false");
  }
  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-vote]"); if (!btn || !root.contains(btn)) return;
    var row = btn.closest("[data-field]"); var pressed = btn.getAttribute("aria-pressed") === "true";
    call("PUT", "/api/v1/feedback/style-guide/" + encodeURIComponent(termId) + "/votes", { votes: [{ field: row.getAttribute("data-field"), hash: row.getAttribute("data-hash"), direction: pressed ? "none" : btn.getAttribute("data-vote") }] })
      .then(function (json) { (json.tallies || []).forEach(paint); }).catch(quiet);
  });

  // ------------------------------------------- one proposal per changed field
  var f = document.getElementById("suggest-changes-form");
  if (!f) return;
  function setNote(text) { var n = f.querySelector("[data-note]"); n.textContent = text; n.hidden = !text; }
  function lines(v) {
    var seen = {};
    return String(v || "").split(/\\r?\\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { if (!s || seen[s]) return false; seen[s] = true; return true; });
  }
  function diff(before, after) {
    return { add: after.filter(function (x) { return before.indexOf(x) < 0; }), remove: before.filter(function (x) { return after.indexOf(x) < 0; }) };
  }
  function parseRef(line) {
    var i = line.indexOf("|"); var label = i < 0 ? "" : line.slice(0, i).trim(); var url = (i < 0 ? line : line.slice(i + 1)).trim();
    if (url.indexOf("https://") !== 0) throw new Error("Further reading links must start with https:// -- check \\u201c" + line + "\\u201d.");
    return { label: label || url, url: url };
  }
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var cur = JSON.parse(f.getAttribute("data-current")); var d = new FormData(f);
    var reason = String(d.get("reason") || "").trim() || undefined;
    var out = [];
    try {
      var def = String(d.get("definition") || "").trim();
      if (def && def !== cur.definition) out.push({ kind: "definition", payload: { definition: def } });
      var note = String(d.get("note") || "").trim();
      if (note !== cur.note && (note || cur.note)) out.push({ kind: "note", payload: { note: note || null } });
      var al = diff(cur.aliases, lines(d.get("aliases")));
      if (al.add.length || al.remove.length) out.push({ kind: "alias", payload: { add: al.add.map(function (t) { return { term: t }; }), remove: al.remove } });
      var av = diff(cur.avoid, lines(d.get("avoid")));
      if (av.add.length || av.remove.length) out.push({ kind: "avoid", payload: { add: av.add, remove: av.remove } });
      // References compare label and address together, so renaming a link is a change too (remove the old, add the new).
      var refs = lines(d.get("references")).map(parseRef);
      var refKey = function (r) { return r.label + "|" + r.url; };
      var curKeys = cur.references.map(refKey), newKeys = refs.map(refKey);
      var addRefs = refs.filter(function (r) { return curKeys.indexOf(refKey(r)) < 0; });
      var removeRefs = cur.references.filter(function (r) { return newKeys.indexOf(refKey(r)) < 0; }).map(function (r) { return r.url; });
      if (addRefs.length || removeRefs.length) out.push({ kind: "references", payload: { add: addRefs, remove: removeRefs } });
      var casing = d.get("casing"); if (casing && casing !== cur.casing) out.push({ kind: "casing", payload: { casing: casing } });
      var category = d.get("category"); if (category && category !== cur.category) out.push({ kind: "category", payload: { category: category } });
      var rule = d.get("script_rule"); if (rule && rule !== cur.script_rule) out.push({ kind: "script_rule", payload: { script_rule: rule } });
    } catch (err) { setNote(err.message); return; }
    if (!out.length) { setNote("Nothing changed."); return; }
    var btn = f.querySelector('button[type="submit"]'); btn.setAttribute("aria-busy", "true"); setNote("");
    // One request, one transaction: all of it lands or none does, so a retry never duplicates.
    call("POST", "/api/v1/feedback/proposals/batch", { proposals: out.map(function (item) { return Object.assign({ termId: termId, hash: termHash, reason: reason }, item); }) })
      .then(function () {
        f.closest("dialog").close();
        say(out.length === 1 ? "Thanks. Your suggestion is with the maintainers." : "Thanks. Your " + out.length + " suggestions are with the maintainers.", "ok");
        setTimeout(function () { location.reload(); }, 800);
      })
      .catch(function (err) { if (err.message !== "stale" && err.message !== "signed out") setNote(err.message); })
      .finally(function () { btn.removeAttribute("aria-busy"); });
  });
})();
`
