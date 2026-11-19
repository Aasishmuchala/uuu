// The stand-in home page's script (frames trial, PLAN-MAC-2 M8). It holds the frame and writes down what the frame's
// page says it tried, the place of each button the runner clicks, and whether the frame's cookie or storage shows up
// on the home page. Served under the home screen's own content policy, so it is a file, not inline script.
const P = new URLSearchParams(location.search);
const T = (window.__trial = { ready: false, results: {}, top: {}, buttons: [] });
const frame = document.getElementById("app");

addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.trial === "result" && typeof m.id === "string") T.results[m.id] = m.value;
  else if (m.trial === "buttons" && Array.isArray(m.buttons)) {
    const r = frame.getBoundingClientRect();
    T.buttons = m.buttons.map((b) => ({ id: String(b.id), x: r.left + Number(b.x), y: r.top + Number(b.y) }));
  } else if (m.trial === "ready") {
    T.top.cookieSeen = document.cookie.includes("trialframe=1");
    try { T.top.storageSeen = localStorage.getItem("trialframe") === "1"; } catch (x) { T.top.storageSeen = false; }
    T.ready = true;
  }
});

// The Astryx page is the kit's own: it says nothing, so the frame having loaded is "ready".
if (P.get("kit")) frame.addEventListener("load", () => { T.ready = true; });
