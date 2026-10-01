/**
 * Withdrawing feedback, shared by the term page and the account page.
 *
 * Nothing is withdrawn on a single click: the island collects what was asked
 * for (one item's button, or the ticked boxes on the account page) and opens
 * the <dialog> to confirm, with the count filled in. A `<form method="dialog">`
 * is the cancel, so Escape, the backdrop and the button all behave alike.
 * On confirm, one DELETE per item, then a reload so the page shows what the
 * server now holds.
 */

/*
 * Geometry stated outright rather than inherited from the UA's dialog:modal
 * rules: fixed, filling the viewport, margin auto on a fit-content box, so it
 * is centred with at least 1rem around it on a phone whichever way it was
 * opened, and it scrolls inside itself when taller than the screen.
 */
export const DIALOG =
  "fixed inset-0 z-50 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"

const GHOST = "rounded-full px-4 py-2 text-label-md text-foreground-subtle hover:text-foreground-strong"
const DANGER =
  "rounded-full border border-rose px-5 py-2 text-label-md font-bold text-rose hover:bg-rose/10 aria-busy:cursor-progress aria-busy:opacity-60"

export const WithdrawDialog = ({ signinHref }: { signinHref: string }) => (
  <dialog id="withdraw-dialog" class={DIALOG} aria-labelledby="withdraw-dialog-title" data-signin={signinHref}>
    <div class="flex flex-col gap-4 p-6">
      <h2 id="withdraw-dialog-title" class="font-serif text-h4 text-foreground-strong">
        Withdraw <span id="withdraw-count">this item</span>?
      </h2>
      <p class="text-body text-foreground-muted">
        It is left out of the maintainers&rsquo; review and stays on your account page, marked
        withdrawn. Making the same suggestion again later reopens it.
      </p>
      <div class="flex justify-end gap-2">
        <form method="dialog">
          <button type="submit" class={GHOST}>
            Cancel
          </button>
        </form>
        <button type="button" id="withdraw-confirm" class={DANGER}>
          Withdraw
        </button>
      </div>
    </div>
  </dialog>
)

export const WITHDRAW_ISLAND = `
(function () {
  var dlg = document.getElementById("withdraw-dialog");
  if (!dlg) return;
  var count = document.getElementById("withdraw-count");
  var confirmBtn = document.getElementById("withdraw-confirm");
  var selectAll = document.getElementById("withdraw-all");
  var selected = document.getElementById("withdraw-selected");
  var status = document.getElementById("account-status") || document.getElementById("feedback-status");
  var pending = [];

  function say(text) {
    if (!status) return;
    status.textContent = text; status.hidden = false; status.classList.add("text-rose");
  }
  function boxes() { return Array.prototype.slice.call(document.querySelectorAll('input[name="withdraw"]')); }
  function ticked() { return boxes().filter(function (b) { return b.checked; }); }
  function paintSelection() {
    var n = ticked().length, all = boxes().length;
    if (selected) selected.textContent = n ? "Withdraw selected (" + n + ")" : "Withdraw selected";
    if (selectAll) { selectAll.checked = all > 0 && n === all; selectAll.indeterminate = n > 0 && n < all; }
  }

  function ask(items) {
    if (!items.length) { say("Tick what you want to withdraw first."); return; }
    pending = items;
    if (count) count.textContent = items.length === 1 ? "this item" : "these " + items.length + " items";
    if (dlg.showModal) dlg.showModal(); else go();
  }

  function go() {
    confirmBtn.setAttribute("aria-busy", "true");
    Promise.all(pending.map(function (item) {
      var p = item.split(":");
      return fetch("/api/v1/feedback/" + p[0] + "/" + p[1], { method: "DELETE", credentials: "same-origin" })
        .then(function (res) {
          if (res.status === 401) throw new Error("signed out");
          if (!res.ok && res.status !== 404) throw new Error("Could not withdraw that (" + res.status + ").");
        });
    }))
      .then(function () { location.reload(); })
      .catch(function (err) {
        if (err.message === "signed out") { location.assign(dlg.getAttribute("data-signin") || "/signin"); return; }
        dlg.close(); confirmBtn.removeAttribute("aria-busy"); say(err.message);
      });
  }

  document.addEventListener("click", function (e) {
    var one = e.target.closest("[data-withdraw]");
    if (one) { ask([one.getAttribute("data-withdraw") + ":" + one.getAttribute("data-id")]); return; }
    if (selected && e.target === selected) ask(ticked().map(function (b) { return b.value; }));
  });
  document.addEventListener("change", function (e) {
    if (e.target === selectAll) boxes().forEach(function (b) { b.checked = selectAll.checked; });
    if (e.target === selectAll || e.target.name === "withdraw") paintSelection();
  });
  confirmBtn.addEventListener("click", go);
  paintSelection();
})();
`
