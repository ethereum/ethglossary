/**
 * The account page's own behaviour. Re-submitting a withdrawn item is one
 * POST and a reload. The delete button stays inert until the confirmation
 * phrase is typed exactly; the field's `pattern` already has the browser
 * refuse a wrong submit, this makes the state visible as you type, and
 * without script the button is simply enabled and the browser check holds.
 */

export const ACCOUNT_ISLAND = `
(function () {
  // Re-submitting a withdrawn item: the route reopens it, or says why not.
  var closed = document.getElementById("closed-status");
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-reopen]");
    if (!btn) return;
    btn.setAttribute("aria-busy", "true");
    fetch("/api/v1/feedback/" + btn.getAttribute("data-reopen") + "/" + btn.getAttribute("data-id") + "/reopen", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}"
    })
      .then(function (res) {
        if (res.status === 401) { location.assign("/signin?next=%2Faccount"); return; }
        if (res.status === 409) throw new Error("What this was about has changed since you withdrew it. Open the term and suggest it afresh.");
        if (!res.ok) throw new Error("Could not re-submit that (" + res.status + ").");
        location.reload();
      })
      .catch(function (err) {
        btn.removeAttribute("aria-busy");
        if (closed) { closed.textContent = err.message; closed.hidden = false; }
      });
  });

  // The delete button stays inert until the phrase is typed exactly.
  var input = document.getElementById("delete-confirm");
  var submit = document.getElementById("delete-submit");
  if (!input || !submit) return;
  function sync() { submit.disabled = !input.validity.valid; }
  input.addEventListener("input", sync);
  sync();
})();
`
