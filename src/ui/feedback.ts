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

export const FEEDBACK_ISLAND = `
(function () {
  var root = document.querySelector("[data-feedback]");
  if (!root || root.getAttribute("data-feedback") !== "live") return;

  var lang = root.getAttribute("data-lang");
  var termId = root.getAttribute("data-term-id");
  var signin = root.getAttribute("data-signin");
  var base = "/api/v1/feedback/translations/" + encodeURIComponent(lang) + "/" + encodeURIComponent(termId);
  var status = document.getElementById("feedback-status");

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
      say("This term changed since the page loaded. Reloading\\u2026", "error");
      setTimeout(function () { location.reload(); }, 1500);
      throw new Error("stale");
    }
    var json = res.status === 204 ? {} : await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || ("request failed (" + res.status + ")"));
    return json;
  }

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

  async function vote(items) {
    var json = await call("PUT", base + "/votes", { votes: items });
    (json.tallies || []).forEach(paint);
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
    vote(items).then(function () { say("Thanks. Every context is marked as good.", "ok"); })
      .catch(function (err) { if (err.message !== "stale" && err.message !== "signed out") say(err.message, "error"); });
  });

  // ---------------------------------------------------------- suggestions

  var form = document.getElementById("suggest-form");
  var ctxSelect = document.getElementById("suggest-context");
  root.addEventListener("click", function (e) {
    var pencil = e.target.closest('[data-action="suggest"]');
    if (!pencil || !root.contains(pencil)) return;
    var ctx = pencil.closest("[data-slot]").getAttribute("data-slot");
    if (ctxSelect) ctxSelect.value = ctx;
    var input = document.getElementById("suggest-term");
    if (input) { input.focus(); input.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });

  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ctx = ctxSelect ? ctxSelect.value : "prose";
    var row = root.querySelector('[data-slot="' + ctx + '"]');
    var value = document.getElementById("suggest-term").value.trim();
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

  document.addEventListener("click", function (e) {
    var del = e.target.closest("[data-withdraw]");
    if (!del) return;
    var kind = del.getAttribute("data-withdraw"); // "suggestions" | "proposals"
    call("DELETE", "/api/v1/feedback/" + kind + "/" + del.getAttribute("data-id"))
      .then(function () { location.reload(); })
      .catch(function (err) { if (err.message !== "signed out") say(err.message, "error"); });
  });

  // ------------------------------------------------- dialogs (proposals)

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open-dialog]");
    if (!opener) return;
    var dlg = document.getElementById(opener.getAttribute("data-open-dialog"));
    if (dlg && dlg.showModal) { e.preventDefault(); dlg.showModal(); }
  });

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
