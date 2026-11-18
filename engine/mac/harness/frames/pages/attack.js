// The stand-in app's page (frames trial, PLAN-MAC-2 M8): what an app's page inside App Studio's frame might try.
// `only` names one attempt (or "auto": every attempt that needs no click and cannot move the top page). Each attempt
// tells the home page what it saw; the servers of run.mjs write down what reached them, and the runner what the app's
// guard asked for (a browser window, a panel). Served with App Studio's own headers, so it is a file, not inline.
const P = new URLSearchParams(location.search);
const ONLY = P.get("only") || "auto";
const O = `http://127.0.0.1:${P.get("o")}`;      // a stand-in for the internet
const PC = `http://127.0.0.1:${P.get("pc")}`;    // the same, for a bare connection (preconnect)
const B = `127.0.0.1:${P.get("b")}`;             // a stand-in for the brain door (3190)
const H = `127.0.0.1:${P.get("h")}`;             // the home screen itself
const U = P.get("u");                              // a UDP port that counts STUN packets

const say = (id, value) => parent.postMessage({ trial: "result", id, value }, "*");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (e) => (e && (e.name || e.message)) ? `${e.name || "Error"}: ${String(e.message || "").slice(0, 160)}` : String(e);
const settle = (p, ms = 3000) => Promise.race([p, wait(ms).then(() => ({ timedOut: true }))]);

function image(src) {
  return new Promise((r) => {
    const i = new Image();
    i.onload = () => r({ loaded: true });
    i.onerror = () => r({ loaded: false });
    i.src = src;
    setTimeout(() => r({ loaded: false, timedOut: true }), 3000);
  });
}
function socket(url) {
  return new Promise((r) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { r({ opened: false, error: word(e) }); return; }
    ws.onopen = () => { r({ opened: true }); ws.close(); };
    ws.onerror = () => r({ opened: false });
    setTimeout(() => r({ opened: false, timedOut: true }), 3000);
  });
}
async function fetched(url, init) {
  try { const res = await fetch(url, init); return { ok: true, status: res.status, type: res.type }; } catch (e) { return { ok: false, error: word(e) }; }
}
function link(rel, href) {
  const l = document.createElement("link");
  l.rel = rel; l.href = href;
  document.head.append(l);
  return { added: true };
}

const AUTO = {
  "read-parent-document": () => { try { return { read: true, title: parent.document.title }; } catch (e) { return { read: false, error: word(e) }; } },
  "read-top-location": () => { try { return { read: true, href: String(top.location.href) }; } catch (e) { return { read: false, error: word(e) }; } },
  alert: () => { try { alert("trial"); return { returned: true }; } catch (e) { return { error: word(e) }; } },
  confirm: () => { try { return { value: confirm("trial") }; } catch (e) { return { error: word(e) }; } },
  prompt: () => { try { return { value: prompt("trial", "x") }; } catch (e) { return { error: word(e) }; } },
  cookie: () => { try { document.cookie = "trialframe=1; path=/"; return { own: document.cookie.includes("trialframe=1") }; } catch (e) { return { own: false, error: word(e) }; } },
  "local-storage": () => { try { localStorage.setItem("trialframe", "1"); return { own: localStorage.getItem("trialframe") === "1" }; } catch (e) { return { own: false, error: word(e) }; } },
  "fetch-own-origin": () => fetched("/attack.html"),
  "fetch-outside": () => fetched(`${O}/fetch`, { mode: "no-cors" }),
  "img-outside": () => image(`${O}/img`),
  "websocket-outside": () => socket(`ws://${O.slice(7)}/ws`),
  "eventsource-outside": () => new Promise((r) => {
    let es;
    try { es = new EventSource(`${O}/sse`); } catch (e) { r({ opened: false, error: word(e) }); return; }
    es.onopen = () => { r({ opened: true }); es.close(); };
    es.onerror = () => { r({ opened: false }); es.close(); };
    setTimeout(() => r({ opened: false, timedOut: true }), 3000);
  }),
  "beacon-outside": () => { try { return { queued: navigator.sendBeacon(`${O}/beacon`, "x") }; } catch (e) { return { queued: false, error: word(e) }; } },
  "link-prerender-outside": () => link("prerender", `${O}/prerender`),
  "link-prefetch-outside": () => link("prefetch", `${O}/prefetch`),
  "link-preconnect-outside": () => link("preconnect", `${PC}/`),
  "service-worker": async () => {
    if (!navigator.serviceWorker) return { registered: false, error: "no navigator.serviceWorker" };
    try {
      const reg = await settle(navigator.serviceWorker.register(`/sw.js?o=${encodeURIComponent(O)}`), 4000);
      if (reg && reg.timedOut) return { registered: false, timedOut: true };
      await wait(2500);
      return { registered: true };
    } catch (e) { return { registered: false, error: word(e) }; }
  },
  "webrtc-stun": async () => {
    if (typeof RTCPeerConnection !== "function") return { made: false, error: "no RTCPeerConnection" };
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${U}` }] });
      let candidates = 0;
      pc.onicecandidate = (e) => { if (e.candidate) candidates++; };
      pc.createDataChannel("t");
      await pc.setLocalDescription(await pc.createOffer());
      const end = Date.now() + 4000;
      while (Date.now() < end && pc.iceGatheringState !== "complete") await wait(100);
      const state = pc.iceGatheringState;
      pc.close();
      return { made: true, candidates, gathering: state };
    } catch (e) { return { made: false, error: word(e) }; }
  },
  "get-user-media": async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { granted: false, error: "no getUserMedia" };
    try { const s = await settle(navigator.mediaDevices.getUserMedia({ video: true, audio: true })); if (s && s.timedOut) return { granted: false, timedOut: true }; s.getTracks().forEach((t) => t.stop()); return { granted: true }; } catch (e) { return { granted: false, error: word(e) }; }
  },
  "get-display-media": async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return { granted: false, error: "no getDisplayMedia" };
    try { const s = await settle(navigator.mediaDevices.getDisplayMedia({ video: true })); if (s && s.timedOut) return { granted: false, timedOut: true }; s.getTracks().forEach((t) => t.stop()); return { granted: true }; } catch (e) { return { granted: false, error: word(e) }; }
  },
  geolocation: () => new Promise((r) => {
    if (!navigator.geolocation) { r({ granted: false, error: "no geolocation" }); return; }
    navigator.geolocation.getCurrentPosition(() => r({ granted: true }), (e) => r({ granted: false, error: `code ${e.code}` }), { timeout: 3000 });
    setTimeout(() => r({ granted: false, timedOut: true }), 3500);
  }),
  "data-image": () => image("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'/%3E"),
  "blob-image": () => image(URL.createObjectURL(new Blob(["<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'/>"], { type: "image/svg+xml" }))),
  "brain-door-fetch": () => fetched(`http://${B}/ask`, { method: "POST", mode: "no-cors", body: "{}" }),
  "brain-door-img": () => image(`http://${B}/img`),
  "brain-door-websocket": () => socket(`ws://${B}/ws`),
  "home-brain-find-fetch": () => fetched(`http://${H}/api/brain/find?q=trial`, { mode: "no-cors" }),
  "home-brain-find-img": () => image(`http://${H}/api/brain/find?q=trial-img`),
  "home-brain-find-websocket": () => socket(`ws://${H}/api/brain/find?q=trial-ws`),
};

// Each of these is its own load: it may move the top page, open a window or need a click.
const MOVE = {
  "top-assign": () => { try { top.location = `${O}/top-assign`; return { threw: false }; } catch (e) { return { threw: true, error: word(e) }; } },
  "parent-assign": () => { try { parent.location = `${O}/parent-assign`; return { threw: false }; } catch (e) { return { threw: true, error: word(e) }; } },
  "open-no-click": () => { try { const w = window.open(`${O}/open-no-click`); return { handle: !!w }; } catch (e) { return { handle: false, error: word(e) }; } },
};

// Click attempts: the page draws one large control; the runner clicks its middle with a real mouse event.
const CLICK = {
  "open-click": { tag: "button", run: () => { try { const w = window.open(`${O}/open-click`); return { handle: !!w }; } catch (e) { return { handle: false, error: word(e) }; } } },
  "a-top-click": { tag: "a", attrs: { target: "_top", href: `${O}/a-top` } },
  "a-blank-click": { tag: "a", attrs: { target: "_blank", href: `${O}/a-blank` } },
  "form-top-click": { tag: "form" },
  "top-assign-click": { tag: "button", run: () => { try { top.location = `${O}/top-assign-click`; return { threw: false }; } catch (e) { return { threw: true, error: word(e) }; } } },
  "download-click": { tag: "a", attrs: { href: "/dl", download: "trial.txt" } },
  "fullscreen-click": { tag: "button", run: async () => { try { await settle(document.documentElement.requestFullscreen()); await wait(300); const on = !!document.fullscreenElement; if (on) await document.exitFullscreen(); return { granted: on }; } catch (e) { return { granted: false, error: word(e) }; } } },
  "pointer-lock-click": { tag: "button", run: async () => { try { const p = document.body.requestPointerLock(); if (p && p.then) await settle(p); await wait(500); const on = !!document.pointerLockElement; if (on) document.exitPointerLock(); return { granted: on }; } catch (e) { return { granted: false, error: word(e) }; } } },
  "clipboard-read-click": { tag: "button", run: async () => { try { const t = await settle(navigator.clipboard.readText()); if (t && t.timedOut) return { granted: false, timedOut: true }; return { granted: true, length: String(t).length }; } catch (e) { return { granted: false, error: word(e) }; } } },
  "clipboard-write-click": { tag: "button", run: async () => { try { const r = await settle(navigator.clipboard.writeText("frames trial")); return { written: !(r && r.timedOut) }; } catch (e) { return { written: false, error: word(e) }; } } },
  "get-display-media-click": { tag: "button", run: () => AUTO["get-display-media"]() },
};

async function main() {
  if (ONLY === "auto") {
    await Promise.all(Object.entries(AUTO).map(async ([id, f]) => { try { say(id, await f()); } catch (e) { say(id, { error: word(e) }); } }));
    parent.postMessage({ trial: "ready" }, "*");
    return;
  }
  if (MOVE[ONLY]) {
    parent.postMessage({ trial: "ready" }, "*");
    await wait(200);
    say(ONLY, MOVE[ONLY]());
    return;
  }
  const c = CLICK[ONLY];
  if (!c) { say(ONLY, { error: "no such attempt" }); parent.postMessage({ trial: "ready" }, "*"); return; }
  let el;
  if (c.tag === "form") {
    el = document.createElement("form");
    el.method = "post"; el.target = "_top"; el.action = `${O}/form-top`;
    const b = document.createElement("button");
    b.type = "submit"; b.textContent = ONLY;
    el.append(b);
  } else {
    el = document.createElement(c.tag);
    el.textContent = ONLY;
    for (const [k, v] of Object.entries(c.attrs || {})) el.setAttribute(k, v);
  }
  el.id = "go";
  el.style.cssText = "position:fixed;left:20px;top:20px;width:400px;height:200px;display:block;margin:0;font:20px sans-serif";
  if (c.tag === "form") el.firstChild.style.cssText = "width:400px;height:200px;font:20px sans-serif";
  if (c.run) el.addEventListener("click", async (e) => { e.preventDefault(); say(ONLY, await c.run()); });
  else el.addEventListener("click", () => say(ONLY, { clicked: true }));
  document.body.append(el);
  parent.postMessage({ trial: "buttons", buttons: [{ id: ONLY, x: 220, y: 120 }] }, "*");
  parent.postMessage({ trial: "ready" }, "*");
}
main();
