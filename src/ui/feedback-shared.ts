/**
 * What the feedback surfaces share: the control classes, so a button on the
 * account page is the same button as on a term page, and the island prelude
 * (`say`, `call`, dialog openers) pasted into each page's inline script.
 */

export const PRIMARY =
  "inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-label-md font-bold text-primary-foreground transition-[filter] hover:brightness-110 aria-busy:cursor-progress aria-busy:opacity-60"
export const GHOST =
  "shrink-0 rounded-full px-4 py-2 text-label-md text-foreground-subtle hover:text-foreground-strong aria-busy:cursor-progress aria-busy:opacity-60"
export const DANGER =
  "rounded-full border border-rose px-5 py-2 text-label-md font-bold text-rose hover:bg-rose/10 aria-busy:cursor-progress aria-busy:opacity-60"
export const FIELD =
  "w-full rounded-sm border border-input bg-transparent px-3 py-2 text-body text-foreground placeholder:text-foreground-subtle focus:border-accent"
export const VOTE =
  "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-label-lg tabular-nums text-foreground-subtle transition-colors hover:bg-muted hover:text-foreground-strong aria-disabled:cursor-not-allowed"

/**
 * Paste inside an island's IIFE after `status` (the role=status element or
 * null) and `signin` (where a 401 sends the reader) are defined.
 *
 * `call()` speaks the feedback API: same-origin JSON; 401 means the session
 * ended, so the reader goes to sign in and back; 409 means the glossary
 * changed under them, so the page says so and reloads. Every other failure
 * throws with the server's one-line `error`. `quiet()` is the catch for
 * those: it reports anything that is not already being handled.
 */
export const ISLAND_HELPERS = `
  function say(text, tone) {
    if (!status) return;
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("text-rose", tone === "error");
    status.classList.toggle("text-teal", tone === "ok");
  }
  async function call(method, path, body) {
    var res = await fetch(path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { location.assign(signin); throw new Error("signed out"); }
    if (res.status === 409) {
      say("This changed since the page loaded. Reloading\\u2026", "error");
      setTimeout(function () { location.reload(); }, 1500);
      throw new Error("stale");
    }
    var json = res.status === 204 ? {} : await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Request failed (" + res.status + ").");
    return json;
  }
  function quiet(err) { if (err.message !== "stale" && err.message !== "signed out") say(err.message, "error"); }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open-dialog]");
    if (!opener) return;
    var dlg = document.getElementById(opener.getAttribute("data-open-dialog"));
    if (dlg && dlg.showModal) { e.preventDefault(); dlg.showModal(); }
  });
`
