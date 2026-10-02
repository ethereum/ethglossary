/**
 * Feedback island for the translate view: votes, suggestions, the new-term
 * form and the two flags. Vanilla, and bound only when the page says
 * feedback is live (`[data-feedback="live"]`); signed-out pages leave the
 * controls to the tooltip island, which explains and links to sign-in.
 *
 * Every write goes to /api/v1/feedback as same-origin JSON. A 401 means the
 * session ended, so the page sends the reader to sign in and back. A 409
 * means the glossary changed under them; the page says so and reloads, so
 * the next click is about what is actually live.
 */

import { ISLAND_HELPERS } from "./feedback-shared"

export const FEEDBACK_ISLAND = `
(function () {
  var root = document.querySelector("[data-feedback]");
  if (!root || root.getAttribute("data-feedback") !== "live") return;

  var lang = root.getAttribute("data-lang");
  var termId = root.getAttribute("data-term-id");
  var signin = root.getAttribute("data-signin");
  var base = "/api/v1/feedback/translations/" + encodeURIComponent(lang) + "/" + encodeURIComponent(termId);
  var status = document.getElementById("feedback-status");

  ${ISLAND_HELPERS}

  // ---------------------------------------------------------------- votes

  function rows() { return Array.prototype.slice.call(root.querySelectorAll("[data-slot]")); }

  function paint(t) {
    var row = root.querySelector('[data-slot="' + t.context + '"]');
    if (!row) return;
    var up = row.querySelector('[data-vote="up"]');
    var down = row.querySelector('[data-vote="down"]');
    up.querySelector("[data-count]").textContent = String(t.up);
    down.querySelector("[data-count]").textContent = String(t.down);
    up.setAttribute("aria-pressed", t.mine === "up" ? "true" : "false");
    down.setAttribute("aria-pressed", t.mine === "down" ? "true" : "false");
  }

  // The mark beside this term in the list. Green the moment any slot is
  // covered, so the reader sees the term counted without leaving it.
  var mark = document.querySelector('#term-list a[aria-current="true"] .icon');
  function repaintProgress() {
    if (!mark) return;
    var covered = rows().filter(function (r) {
      return r.querySelector('[data-vote][aria-pressed="true"]') || r.getAttribute("data-suggested") === "true";
    }).length;
    mark.classList.toggle("text-teal", covered > 0);
    mark.classList.toggle("text-foreground-subtle", covered === 0);
  }

  async function vote(items) {
    var json = await call("PUT", base + "/votes", { votes: items });
    (json.tallies || []).forEach(paint);
    repaintProgress();
  }

  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-vote]");
    if (!btn || !root.contains(btn)) return;
    var row = btn.closest("[data-slot]");
    var dir = btn.getAttribute("data-vote");
    var pressed = btn.getAttribute("aria-pressed") === "true";
    vote([{ context: row.getAttribute("data-slot"), hash: row.getAttribute("data-hash"), direction: pressed ? "none" : dir }])
      .catch(function (err) { if (err.message !== "stale" && err.message !== "signed out") say(err.message, "error"); });
  });

  var all = document.getElementById("thumbs-up-all");
  if (all) all.addEventListener("click", function () {
    var items = rows().map(function (r) { return { context: r.getAttribute("data-slot"), hash: r.getAttribute("data-hash"), direction: "up" }; });
    if (!items.length) return;
    vote(items).then(function () {
      say("Thanks. Every context is marked as good.", "ok");
      // The natural next step is the next term: focus it so Enter goes there,
      // with a visible ring, which a click-initiated focus() would not draw.
      var next = document.getElementById("next-term");
      if (next) {
        next.setAttribute("data-focus-ring", "");
        next.addEventListener("blur", function () { next.removeAttribute("data-focus-ring"); }, { once: true });
        next.focus();
      }
    })
      .catch(function (err) { if (err.message !== "stale" && err.message !== "signed out") say(err.message, "error"); });
  });

  // ---------------------------------------------------------- suggestions

  var form = document.getElementById("suggest-form");
  var ctxSelect = document.getElementById("suggest-context");
  var single = document.getElementById("suggest-term");
  var plurals = document.getElementById("suggest-plurals");

  // The plurals context is several forms, not one string: swap the fields.
  function syncFields() {
    var isPlurals = ctxSelect && ctxSelect.value === "plurals" && plurals;
    if (single) single.hidden = !!isPlurals;
    if (plurals) plurals.hidden = !isPlurals;
  }
  if (ctxSelect) { ctxSelect.addEventListener("change", syncFields); syncFields(); }

  // What the server hashes for plurals: sorted key=value pairs joined by |,
  // an empty field meaning "keep the current form".
  function pluralValue() {
    var inputs = Array.prototype.slice.call(plurals.querySelectorAll("[data-plural-form]"));
    return inputs.map(function (i) {
      var v = i.value.trim() || i.getAttribute("placeholder") || "";
      return { k: i.getAttribute("data-plural-form"), v: v };
    }).filter(function (p) { return p.v; })
      .sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; })
      .map(function (p) { return p.k + "=" + p.v; }).join("|");
  }
  root.addEventListener("click", function (e) {
    var pencil = e.target.closest('[data-action="suggest"]');
    if (!pencil || !root.contains(pencil)) return;
    var ctx = pencil.closest("[data-slot]").getAttribute("data-slot");
    if (ctxSelect) { ctxSelect.value = ctx; syncFields(); }
    var target = ctx === "plurals" && plurals ? plurals.querySelector("input") : single;
    if (target) { target.focus(); target.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });

  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ctx = ctxSelect ? ctxSelect.value : "prose";
    var row = root.querySelector('[data-slot="' + ctx + '"]');
    var value = ctx === "plurals" && plurals ? pluralValue() : single.value.trim();
    var reason = (document.getElementById("suggest-reason").value || "").trim();
    if (!value || !row) return;
    var btn = form.querySelector('button[type="submit"]');
    btn.setAttribute("aria-busy", "true");
    call("POST", base + "/suggestions", { context: ctx, hash: row.getAttribute("data-hash"), value: value, reason: reason || undefined })
      .then(function (json) {
        say(json.duplicate ? "You had already suggested that." : "Thanks. Your suggestion is with the maintainers.", "ok");
        setTimeout(function () { location.reload(); }, 800);
      })
      .catch(function (err) { if (err.message !== "stale" && err.message !== "signed out") say(err.message, "error"); })
      .finally(function () { btn.removeAttribute("aria-busy"); });
  });

  // Withdrawing ([data-withdraw]) is handled by the shared withdraw island.

  // ------------------------------------------------- dialogs (proposals)
  // Openers ([data-open-dialog]) are bound by the shared prelude.

  function proposalForm(id, build) {
    var f = document.getElementById(id);
    if (!f) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = new FormData(f);
      var body;
      try { body = build(data); } catch (err) { setNote(f, err.message); return; }
      var btn = f.querySelector('button[type="submit"]');
      btn.setAttribute("aria-busy", "true");
      call("POST", "/api/v1/feedback/proposals", body)
        .then(function () {
          f.reset(); setNote(f, "");
          var dlg = f.closest("dialog"); if (dlg) dlg.close();
          say("Thanks. Your proposal is with the maintainers.", "ok");
          setTimeout(function () { location.reload(); }, 800);
        })
        .catch(function (err) { if (err.message !== "signed out") setNote(f, err.message); })
        .finally(function () { btn.removeAttribute("aria-busy"); });
    });
  }
  function setNote(f, text) { var n = f.querySelector("[data-note]"); if (n) { n.textContent = text; n.hidden = !text; } }
  function lines(text) { return String(text || "").split(/\\r?\\n|,/).map(function (s) { return s.trim(); }).filter(Boolean); }

  proposalForm("new-term-form", function (d) {
    var term = String(d.get("term") || "").trim();
    if (!term) throw new Error("Give the term.");
    var prose = String(d.get("translation") || "").trim();
    var payload = { term: term };
    var definition = String(d.get("definition") || "").trim();
    if (definition) payload.definition = definition;
    if (prose) payload.translation = { lang: lang, prose: prose };
    var reason = String(d.get("reason") || "").trim();
    return { kind: "new_term", lang: lang, payload: payload, reason: reason || undefined };
  });

  proposalForm("flag-redundant-form", function (d) {
    var others = lines(d.get("with"));
    if (!others.length) throw new Error("Name at least one other term.");
    var hash = root.getAttribute("data-term-hash");
    var reason = String(d.get("reason") || "").trim();
    return { kind: "redundant", termId: termId, hash: hash, payload: { with: others }, reason: reason || undefined };
  });

  proposalForm("flag-split-form", function (d) {
    var into = lines(d.get("into")).map(function (t) { return { term: t }; });
    if (into.length < 2) throw new Error("Give at least two terms, one per line.");
    var hash = root.getAttribute("data-term-hash");
    var reason = String(d.get("reason") || "").trim();
    return { kind: "split", termId: termId, hash: hash, payload: { into: into }, reason: reason || undefined };
  });
})();
`
