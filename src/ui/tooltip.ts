/**
 * Click-to-explain popovers.
 *
 * Two things need one, for the same reason: a native `title` only appears on
 * hover, so on a touch device it never appears at all -- which is exactly
 * where someone taps a vote button, or a context's info icon, and gets
 * nothing back.
 *
 *  - Account-gated controls. They are NOT `disabled`, because a disabled
 *    element fires no click event and so cannot explain itself. They carry
 *    `aria-disabled="true"` (announced the same way) plus `readonly` on the
 *    fields, and this listener swallows the interaction and shows the reason.
 *  - Context info icons, which additionally offer a link onward to /contexts.
 *
 * Attributes: `data-tip` is the text, and `data-tip-title` an optional bold
 * first line above it (the chips use it for the value being explained).
 * `data-tip-href` makes it a link: with
 * `data-tip-link` the popover is the text plus a separately labelled link
 * ("More about Prose"); without it the text itself is the link ("Sign in to
 * vote"). A popover with a link stays until dismissed and takes focus, so the
 * link is reachable; one without fades out on its own.
 *
 * The popover is appended to <body> rather than rendered beside its trigger:
 * the slot rows clip to their rounded corners and the compare table scrolls
 * horizontally, so an absolutely positioned sibling would be cut off in both.
 */

export const TOOLTIP_ISLAND = `
(function () {
  if (!document.querySelector("[data-tip]")) return;

  var tip = document.createElement("div");
  tip.className = "tip";
  tip.id = "tip-popover";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);

  var open = null;
  var hideTimer = 0;

  function hide(refocus) {
    window.clearTimeout(hideTimer);
    if (!open) return;
    var trigger = open;
    open = null;
    tip.hidden = true;
    trigger.removeAttribute("aria-describedby");
    if (trigger.hasAttribute("aria-expanded")) {
      trigger.setAttribute("aria-expanded", "false");
    }
    if (refocus && trigger.focus) trigger.focus();
  }

  function place(trigger) {
    var r = trigger.getBoundingClientRect();
    var t = tip.getBoundingClientRect();
    // Below by default. These triggers sit on the bottom edge of the thing
    // they annotate -- a context label under its translation, a column header
    // over its column -- so opening upward covers the value being explained.
    var top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 8 && r.top - t.height - 8 > 8) {
      top = r.top - t.height - 8;
    }
    var left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    tip.style.top = top + window.scrollY + "px";
    tip.style.left = left + window.scrollX + "px";
  }

  function show(trigger) {
    var href = trigger.getAttribute("data-tip-href");
    var label = trigger.getAttribute("data-tip-link");
    var link = null;
    if (href) {
      link = document.createElement("a");
      link.href = href;
      link.className = "tip-link";
    }
    if (href && !label) {
      // One link that is the whole message.
      link.textContent = trigger.getAttribute("data-tip") || "";
      tip.replaceChildren(link);
    } else {
      var text = document.createElement("span");
      text.textContent = trigger.getAttribute("data-tip") || "";
      var title = trigger.getAttribute("data-tip-title");
      if (title) {
        var head = document.createElement("strong");
        head.className = "block font-bold text-foreground-strong";
        head.textContent = title;
        tip.replaceChildren(head, text);
      } else {
        tip.replaceChildren(text);
      }
      if (link) { link.textContent = label; tip.appendChild(link); }
    }

    tip.hidden = false;
    place(trigger);

    trigger.setAttribute("aria-describedby", tip.id);
    if (trigger.hasAttribute("aria-expanded")) {
      trigger.setAttribute("aria-expanded", "true");
    }
    open = trigger;

    window.clearTimeout(hideTimer);
    if (href) {
      // Focus the link, or Tab from the trigger would skip past the popover
      // to whatever follows it in the page.
      link.focus();
    } else {
      hideTimer = window.setTimeout(hide, 4000);
    }
  }

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-tip]");
    if (!trigger) {
      if (!tip.contains(e.target)) hide();
      return;
    }
    e.preventDefault();
    // A second click on the same trigger closes it.
    if (open === trigger) hide(true);
    else {
      hide();
      show(trigger);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hide(true);
      return;
    }
    // How a keyboard user "clicks" a readonly field, which fires no click.
    if (e.key === "Enter" || e.key === " ") {
      var trigger = e.target.closest && e.target.closest("[data-tip]");
      if (trigger && trigger.tagName !== "BUTTON" && trigger.tagName !== "A") {
        e.preventDefault();
        show(trigger);
      }
    }
  });

  window.addEventListener("scroll", function () { hide(); }, { passive: true });
  window.addEventListener("resize", function () { hide(); });
})();
`
