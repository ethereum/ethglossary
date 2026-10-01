/**
 * The account page's own behaviour: the delete button stays inert until the
 * confirmation phrase is typed exactly. The field's `pattern` already has the
 * browser refuse a wrong submit; this makes the state visible as you type.
 * Without script the button is simply enabled and the browser check holds.
 */

export const ACCOUNT_ISLAND = `
(function () {
  var input = document.getElementById("delete-confirm");
  var btn = document.getElementById("delete-submit");
  if (!input || !btn) return;
  function sync() { btn.disabled = !input.validity.valid; }
  input.addEventListener("input", sync);
  sync();
})();
`
