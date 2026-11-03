/*
 * PEARL chat widget. Embed on a Merchant's site:
 *   <script src="https://<pearl-host>/widget.js" data-merchant="demo"></script>
 * Page API:
 *   PEARL.identify(customerExternalId)  // the Merchant's site says which of its customers this Visitor is
 *   PEARL.viewing(productId | null)     // which product page the Visitor is on (starts the Proactive Trigger timer)
 *   PEARL.reset()                       // forget this Visitor (e.g. on logout)
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var merchant = (script && script.dataset.merchant) || "demo";
  var origin = script ? new URL(script.src).origin : location.origin;
  var PROACTIVE_DELAY_MS = 8000;
  var STORAGE_KEY = "pearl.visitorId." + merchant;

  // ---------- Visitor identity ----------
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var visitorId = storageGet(STORAGE_KEY) || newId();
  storageSet(STORAGE_KEY, visitorId);

  // ---------- Automated traffic signals ----------
  var interacted = false;
  ["mousemove", "scroll", "keydown", "touchstart", "pointerdown"].forEach(function (evt) {
    window.addEventListener(evt, function () { interacted = true; }, { once: true, passive: true });
  });
  function looksAutomated() {
    return !interacted || navigator.webdriver === true ||
      /bot|crawl|spider|headless|puppeteer|playwright|selenium|phantom|lighthouse/i.test(navigator.userAgent);
  }

  // ---------- Styles ----------
  var css = "" +
    ".pearl-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2330}" +
    ".pearl-bubble{width:58px;height:58px;border-radius:50%;border:0;background:#0f766e;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}" +
    ".pearl-panel{display:none;flex-direction:column;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;margin-bottom:12px}" +
    ".pearl-open .pearl-panel{display:flex}" +
    ".pearl-head{background:#0f766e;color:#fff;padding:12px 14px}" +
    ".pearl-head b{display:block;font-size:15px}.pearl-head span{font-size:12px;opacity:.85}" +
    ".pearl-log{flex:1;overflow-y:auto;padding:12px;background:#f5f7f8;display:flex;flex-direction:column;gap:8px}" +
    ".pearl-msg{max-width:82%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}" +
    ".pearl-msg small{display:block;font-size:11px;opacity:.65;margin-bottom:2px}" +
    ".pearl-visitor{align-self:flex-end;background:#0f766e;color:#fff;border-bottom-right-radius:4px}" +
    ".pearl-ai_agent,.pearl-operator{align-self:flex-start;background:#fff;border:1px solid #e3e7ea;border-bottom-left-radius:4px}" +
    ".pearl-system{align-self:center;background:none;color:#6b7280;font-size:12px;text-align:center}" +
    ".pearl-card{display:flex;gap:10px;align-items:center;margin-top:8px;padding:8px;border:1px solid #e3e7ea;border-radius:10px;background:#fafbfb;color:#1d2330;text-decoration:none}" +
    ".pearl-card .e{font-size:26px}.pearl-card b{display:block;font-size:13px}.pearl-card span{font-size:12px;color:#0f766e;font-weight:600}" +
    ".pearl-foot{border-top:1px solid #e3e7ea;padding:8px;display:flex;gap:6px}" +
    ".pearl-foot input{flex:1;border:1px solid #d5dadf;border-radius:8px;padding:8px;font:inherit}" +
    ".pearl-foot button{border:0;background:#0f766e;color:#fff;border-radius:8px;padding:0 12px;font:inherit;cursor:pointer}" +
    ".pearl-human{border:0;background:none;color:#0f766e;font-size:12px;padding:4px 12px 8px;text-align:left;cursor:pointer}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  var root = document.createElement("div");
  root.className = "pearl-root";
  root.innerHTML =
    '<div class="pearl-panel" role="dialog" aria-label="Chat">' +
    '<div class="pearl-head"><b>Chat with us</b><span class="pearl-status">AI Agent · replies instantly</span></div>' +
    '<div class="pearl-log" aria-live="polite"></div>' +
    '<button class="pearl-human" type="button">Talk to a human</button>' +
    '<form class="pearl-foot"><input placeholder="Type a message…" maxlength="2000" aria-label="Message"><button type="submit">Send</button></form>' +
    "</div>" +
    '<div style="text-align:right"><button class="pearl-bubble" type="button" aria-label="Open chat">💬</button></div>';
  document.body.appendChild(root);
  var log = root.querySelector(".pearl-log");
  var statusEl = root.querySelector(".pearl-status");
  var input = root.querySelector("input");
  var humanBtn = root.querySelector(".pearl-human");

  function setOpen(open) {
    root.classList.toggle("pearl-open", open);
    if (open) { log.scrollTop = log.scrollHeight; input.focus(); }
  }
  root.querySelector(".pearl-bubble").addEventListener("click", function () {
    setOpen(!root.classList.contains("pearl-open"));
  });

  function rupiah(n) { return "Rp" + Number(n).toLocaleString("id-ID"); }

  function renderMessage(m) {
    var el = document.createElement("div");
    el.className = "pearl-msg pearl-" + m.sender;
    if (m.senderName && m.sender !== "visitor") {
      var who = document.createElement("small");
      who.textContent = m.senderName;
      el.appendChild(who);
    }
    if (m.body) el.appendChild(document.createTextNode(m.body));
    if (m.product) {
      var card = document.createElement("a");
      card.className = "pearl-card";
      card.href = origin + m.product.url;
      var e = document.createElement("div"); e.className = "e"; e.textContent = m.product.emoji;
      var info = document.createElement("div");
      var name = document.createElement("b"); name.textContent = m.product.name;
      var price = document.createElement("span"); price.textContent = rupiah(m.product.price);
      info.appendChild(name); info.appendChild(price);
      card.appendChild(e); card.appendChild(info);
      el.appendChild(card);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function renderConversation(c) {
    if (!c || c.status !== "open") {
      statusEl.textContent = "AI Agent · replies instantly";
      humanBtn.style.display = "";
      return;
    }
    if (c.responder === "ai_agent") {
      statusEl.textContent = "AI Agent · replies instantly";
      humanBtn.style.display = "";
    } else {
      statusEl.textContent = c.operatorName ? c.operatorName + " (Operator)" : "Waiting for an Operator…";
      humanBtn.style.display = "none";
    }
  }

  // ---------- Connection ----------
  var ws = null;
  var queue = [];
  var retry = 0;
  var lastIdentify = null;
  var lastViewing = null;

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    else queue.push(payload);
  }

  function connect() {
    var wsUrl = origin.replace(/^http/, "ws") + "/ws/visitor?merchant=" + encodeURIComponent(merchant) +
      "&visitorId=" + encodeURIComponent(visitorId);
    var socket = new WebSocket(wsUrl);
    ws = socket;
    socket.onopen = function () {
      retry = 0;
      // Re-send current page state on (re)connect, then anything queued.
      var pending = queue; queue = [];
      if (lastIdentify) socket.send(JSON.stringify({ type: "identify", externalId: lastIdentify }));
      if (lastViewing !== undefined) socket.send(JSON.stringify({ type: "viewing", productId: lastViewing }));
      pending.forEach(function (p) {
        if (p.type !== "identify" && p.type !== "viewing") socket.send(JSON.stringify(p));
      });
    };
    socket.onmessage = function (evt) {
      var msg = JSON.parse(evt.data);
      if (msg.type === "hello") {
        log.innerHTML = "";
        msg.messages.forEach(renderMessage);
        renderConversation(msg.conversation);
      } else if (msg.type === "message") {
        renderMessage(msg.message);
        if (msg.message.sender !== "visitor") setOpen(true);
      } else if (msg.type === "conversation") {
        renderConversation(msg.conversation);
        if (msg.conversation.status === "closed") {
          var el = document.createElement("div");
          el.className = "pearl-msg pearl-system";
          el.textContent = "This chat was closed. Send a message to start a new one.";
          log.appendChild(el);
        }
      }
    };
    socket.onclose = function () {
      if (ws !== socket) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * Math.pow(2, retry));
    };
  }
  connect();

  root.querySelector("form").addEventListener("submit", function (evt) {
    evt.preventDefault();
    var body = input.value.trim();
    if (!body) return;
    input.value = "";
    send({ type: "message", body: body });
  });
  humanBtn.addEventListener("click", function () { send({ type: "request_human" }); });

  // ---------- Proactive Trigger ----------
  var proactiveTimer = null;
  function scheduleProactive(productId) {
    clearTimeout(proactiveTimer);
    if (!productId) return;
    var firedKey = "pearl.proactive." + visitorId + "." + productId;
    try { if (sessionStorage.getItem(firedKey)) return; } catch (e) {}
    proactiveTimer = setTimeout(function () {
      if (looksAutomated()) {
        console.debug("[PEARL] Proactive Trigger skipped: no human signals yet");
        return;
      }
      try { sessionStorage.setItem(firedKey, "1"); } catch (e) {}
      send({ type: "proactive", productId: productId, signals: { interacted: interacted, webdriver: navigator.webdriver === true } });
    }, PROACTIVE_DELAY_MS);
  }

  // ---------- Page API ----------
  window.PEARL = {
    identify: function (externalId) {
      lastIdentify = String(externalId);
      send({ type: "identify", externalId: lastIdentify });
    },
    viewing: function (productId) {
      lastViewing = productId == null ? null : Number(productId);
      send({ type: "viewing", productId: lastViewing });
      scheduleProactive(lastViewing);
    },
    reset: function () {
      visitorId = newId();
      storageSet(STORAGE_KEY, visitorId);
      lastIdentify = null;
      var old = ws; ws = null; queue = [];
      if (old) old.close();
      log.innerHTML = "";
      renderConversation(null);
      connect();
    },
  };
})();
