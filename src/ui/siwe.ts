/**
 * Sign-In with Ethereum, browser side.
 *
 * Discovers wallets through EIP-6963 (falling back to window.ethereum), asks
 * the server for a nonce, has the wallet sign an EIP-4361 message that names
 * this host, and posts message and signature back. Vanilla and small; there
 * is no wallet library because the whole exchange is three calls.
 *
 * Contract: a `[data-siwe]` button, a `[data-siwe-status]` element for
 * messages, and `data-next` on the button for where to go afterwards.
 */

export const SIWE_ISLAND = `
(function () {
  var btn = document.querySelector("[data-siwe]");
  var status = document.querySelector("[data-siwe-status]");
  if (!btn) return;

  var providers = [];
  window.addEventListener("eip6963:announceProvider", function (e) {
    if (e.detail && e.detail.provider) providers.push(e.detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  function say(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("text-rose", !!isError);
    status.hidden = !text;
  }

  function toHex(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "0x";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  function pickProvider() {
    if (providers.length) return providers[0].provider;
    if (window.ethereum) return window.ethereum;
    return null;
  }

  async function post(path, body) {
    var res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {})
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || ("request failed (" + res.status + ")"));
    return json;
  }

  btn.addEventListener("click", async function () {
    var eth = pickProvider();
    if (!eth) {
      say("No Ethereum wallet was found in this browser.", true);
      return;
    }
    btn.setAttribute("aria-busy", "true");
    say("");
    try {
      var accounts = await eth.request({ method: "eth_requestAccounts" });
      var address = accounts && accounts[0];
      if (!address) throw new Error("no account was shared");

      var next = btn.getAttribute("data-next") || "";
      var nonce = (await post("/auth/siwe/nonce", { next: next })).nonce;
      var now = new Date();
      var expires = new Date(now.getTime() + 10 * 60 * 1000);
      // EIP-4361 makes the scheme optional and wallets assume https when it
      // is missing, which fails on a plain-http dev server. Always state it.
      var message =
        location.protocol + "//" + location.host + " wants you to sign in with your Ethereum account:\\n" +
        address + "\\n\\n" +
        "Sign in to ETHGlossary. This request will not trigger a blockchain transaction or cost any gas.\\n\\n" +
        "URI: " + location.origin + "\\n" +
        "Version: 1\\n" +
        "Chain ID: 1\\n" +
        "Nonce: " + nonce + "\\n" +
        "Issued At: " + now.toISOString() + "\\n" +
        "Expiration Time: " + expires.toISOString();

      say("Check your wallet to sign the message.");
      var signature = await eth.request({ method: "personal_sign", params: [toHex(message), address] });
      var result = await post("/auth/siwe/verify", { message: message, signature: signature });
      location.assign(result.next || "/");
    } catch (err) {
      var text = (err && err.message) || "sign-in failed";
      say(/reject|denied/i.test(text) ? "The signature request was declined." : text, true);
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
})();
`
