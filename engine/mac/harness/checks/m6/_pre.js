// What every M6 page script starts with (run-m6.mjs puts it before the script's own body; the whole is the body of
// an async function, run by webkit-probe --script, or in Chrome through the cook harness's evaluate). INJ holds the
// values run-m6.mjs gives the script.
/*INJECT*/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(200)]);
async function quiet(max = 8000) {
  const p = window.__probe || { inflight: 0, last: 0 };
  const end = performance.now() + max;
  if (!window.__probe) { await sleep(Math.min(max, 1200)); await frame(); return; }
  while (performance.now() < end) {
    if (p.inflight === 0 && performance.now() - p.last >= 400) break;
    await sleep(50);
  }
  await frame();
}
async function waitFor(sel, ms = 15000) {
  const end = performance.now() + ms;
  while (performance.now() < end) { const e = document.querySelector(sel); if (e) return e; await sleep(100); }
  return null;
}
async function waitUntil(fn, ms = 15000) {
  const end = performance.now() + ms;
  while (performance.now() < end) { try { const v = fn(); if (v) return v; } catch { /* not yet */ } await sleep(100); }
  return null;
}
// Typing into a field as the harness does: focus, select what is there, insertText (fires the input event).
function typeInto(el, text) {
  el.focus();
  if (typeof el.select === "function") el.select();
  document.execCommand("insertText", false, text);
  if (el.value !== text) {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (set) set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
const label = (e) => e ? (e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "")) : null;
const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
const text = (e, n = 120) => String(e?.textContent || "").replace(/\s+/g, " ").trim().slice(0, n);
