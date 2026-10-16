/**
 * The account menu in the nav is a <details>, so opening it, closing it and
 * the keyboard toggle are the browser's. What a plain <details> never does is
 * close when the reader clicks somewhere else or presses Escape, which is
 * what makes a disclosure feel like a menu. That is all this adds. Shipped
 * only to signed-in pages, the only ones that render the menu.
 */

export const ACCOUNT_MENU_ISLAND = `
(function () {
  var menu = document.getElementById("account-menu");
  if (!menu) return;
  document.addEventListener("click", function (e) {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
})();
`
