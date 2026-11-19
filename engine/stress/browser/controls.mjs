// Every control on every page, found and pressed once (PLAN-STRESS T3), on a fresh load of `normal` at 1280 light.
//   collect(tab) -> [control]     (and window.__stressEls in the page, in the same order)
//   pressAll({ ctx, tab, stage, page, notes, tally, shellDone, quick }) -> [control with its outcome]
// A control: { i, sig, nth, tag, role, type, name, href, disabled, reason, shell, x, y, w, h, tabIndex, ring }.
// `shell`: it belongs to the shell (side bar, top bar), not to the page; those are pressed once in the whole sweep.
// Links are followed and the address they reach must be a page; a link off this Mac or to a download is not followed
// and is listed with that reason. Fields get "stress", then 10 000 characters, then planted markup. Forms are sent
// empty, then filled. A control that makes no request, changes nothing and goes nowhere is a finding (high) unless
// it is disabled with a visible reason; one of many alike (three are pressed) is listed with that reason.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "../lib/http.mjs";
import { findRoute } from "../../home/public/routes.js";
import { judgeWindow } from "./loads.mjs";
import { norm } from "./notes.mjs";
import { hostOk, sleep } from "./recorder.mjs";
import { urlOf } from "./pages.mjs";

export const SELECTOR = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=switch], [role=menuitem], [tabindex]:not([tabindex="-1"])';
const XSS = "<img src=x onerror=alert(1)>";
const LONG = "stress ".repeat(1429).slice(0, 10000);
// Requests the shell makes on its own clock; they do not count as a control's doing.
const POLLS = /\/api\/(shell|setup|settings)(\?|$)/;
const ALIKE_PRESSED = 3;

export const COLLECT = `(() => {
  const SEL = ${JSON.stringify(SELECTOR)};
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01; };
  // Inside a closed <details> only its own summary shows (Chrome still gives the hidden content a box).
  const folded = (el) => { const d = el.closest("details:not([open])"); if (!d) return false; const s = el.closest("summary"); return !(s && s.parentElement === d); };
  const els = [...document.querySelectorAll(SEL)].filter((el) => vis(el) && !folded(el) && !el.closest("[inert], [aria-hidden=true]"));
  window.__stressEls = els;
  const seen = new Map();
  return els.map((el, i) => {
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const type = (el.getAttribute("type") || "").toLowerCase();
    const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || el.value || el.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 60);
    const href = el.getAttribute("href") || "";
    const cls = String(el.className && typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).slice(0, 2).join(".");
    const sig = [tag, role, type, name, href, cls].join("|");
    const nth = seen.get(sig) || 0;
    seen.set(sig, nth + 1);
    const disabled = !!(el.disabled || el.getAttribute("aria-disabled") === "true");
    let reason = el.getAttribute("title") || "";
    const db = el.getAttribute("aria-describedby");
    if (db) for (const id of db.split(/\\s+/)) { const d = document.getElementById(id); if (d) reason += " " + d.textContent.trim(); }
    // A disabled switch in a settings row: the row's own words say why ("It can be switched on when these are done",
    // "None of it is built yet" over the Later rows), on screen beside it.
    if (disabled && !reason.trim()) { const row = el.closest(".k-rows__row"); const say = row && row.querySelector(".k-say"); const intro = el.closest("main") && el.closest("main").querySelector(".k-page__intro, .p-settings__intro"); reason = ((say && say.innerText) || "") + " " + ((intro && intro.innerText) || ""); }
    const r = el.getBoundingClientRect();
    const shell = !!el.closest(".s-side, .s-top, .s-tabbar, .s-skip") && !el.closest("[role=dialog]");
    const kind = [tag, role, type, cls, href.replace(/[0-9a-f-]{8,}|[A-Za-z0-9_-]{16,}/g, "*").replace(/\\d+/g, "*")].join("|");
    return {
      i, sig, nth, kind, tag, role, type, name, href, cls, disabled, reason: reason.trim().slice(0, 200), shell,
      download: el.hasAttribute("download") || /[?&]download=1/.test(href), target: el.getAttribute("target") || "",
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height),
      current: (el.hasAttribute("aria-current") && el.getAttribute("aria-current") !== "false") || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true" || (!!href && href === location.hash) || el.matches(".is-current, .is-active, .is-on, .is-selected, [data-current]"),
      tabIndex: el.tabIndex, inForm: !!el.form || !!el.closest("form"), popup: el.getAttribute("aria-haspopup") || "", expanded: el.getAttribute("aria-expanded"),
      roving: !!el.closest("[role=tablist], [role=radiogroup], [role=menu], [role=listbox], [role=menubar], [role=toolbar], [role=grid]"),
      ring: { outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor, shadow: cs.boxShadow, border: cs.borderColor, bg: cs.backgroundColor },
      // The kit draws some rings on the control's box (a composer, a money field, a card): three ancestors' looks.
      up: [el.parentElement, el.parentElement && el.parentElement.parentElement, el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement]
        .map((u) => { if (!u) return null; const s = getComputedStyle(u); return s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor + "|" + s.boxShadow + "|" + s.borderColor; }),
    };
  });
})()`;

// The index of the control with this signature (the nth alike) in the page now, after a fresh COLLECT.
export function findAgain(list, c) {
  const same = list.filter((x) => x.sig === c.sig);
  return (same[c.nth] || same[0] || null);
}

// Scrolls the control into the middle of the window; -> its centre now, and whether it is the element there.
const AIM = (i) => `(() => {
  const el = window.__stressEls && window.__stressEls[${i}];
  if (!el || !el.isConnected) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const top = document.elementFromPoint(x, y);
  return { x, y, hit: !!top && (top === el || el.contains(top) || top.contains(el)) };
})()`;

const MUT = "(window.__stress ? window.__stress.mutations : 0)";
const LT = "(window.__stress ? window.__stress.longtasks.length : 0)";

// One press and what came of it. `act` does the press. -> outcome
async function measure(tab, act, { waitMs = 1200, index = -1 } = {}) {
  const h0 = await tab.eval("location.hash").catch(() => "");
  const FOCUS = `(() => { const a = document.activeElement; if (!a || a === document.body || a === document.documentElement) return ""; const me = (window.__stressEls || [])[${index}]; if (me && (a === me || me.contains(a))) return ""; return a.tagName + "#" + a.id + "." + String(a.className || "").slice(0, 40); })()`;
  const f0 = await tab.eval(FOCUS).catch(() => "");
  const m0 = await tab.eval(MUT).catch(() => 0);
  await sleep(300);
  const m1 = await tab.eval(MUT).catch(() => 0);
  const idle = m1 - m0;
  const lt0 = await tab.eval(LT).catch(() => 0);
  tab.window();
  const t0 = Date.now();
  const how = await act();
  await sleep(waitMs);
  await tab.settle({ quietMs: 300, maxMs: 5000 });
  const win = tab.window();
  // Where focus went (a "Skip to content" link only moves focus); the control itself taking focus does not count.
  const f1 = await tab.eval(FOCUS).catch(() => "");
  const focusMoved = !!f1 && f1 !== f0;
  let h1 = h0;
  let m2 = m1;
  let longTasks = [];
  let alive = true;
  try {
    h1 = await tab.eval("location.hash", { timeoutMs: 5000 });
    m2 = await tab.eval(MUT, { timeoutMs: 5000 });
    longTasks = await tab.eval(`(window.__stress ? window.__stress.longtasks.slice(${lt0}) : [])`, { timeoutMs: 5000 });
  } catch {
    alive = false;
  }
  const changed = m2 - m1 > Math.max(0, idle) * 4;
  const requests = win.requests.filter((r) => r.url && /^https?:/.test(r.url) && !POLLS.test(r.url)).map((r) => ({ method: r.method, path: (() => { try { return new URL(r.url).pathname; } catch { return r.url; } })(), status: r.status }));
  return {
    how, ms: Date.now() - t0, navigated: h1 !== h0 || win.navigations > 0, hash: h1, changed, mutations: m2 - m1, idle,
    requests, exceptions: win.exceptions.slice(0, 3), longTasks, alive, win, focusMoved, focus: f1,
  };
}

// The home routes whose 502 says what is behind them failed (B6): on the stage Omega Plus is out of reach and the
// sign-in fakes start no sign-in.
const UPSTREAM_ROUTES = /\/api\/(models\/refresh|generation\/(runway|higgsfield)\/begin)(\?|$)/;

function did(o) {
  return o.navigated || o.changed || o.requests.length > 0 || o.focusMoved;
}

// The fill for a field of this type.
function fillFor(c) {
  switch (c.type) {
    case "email": return "stress@example.com";
    case "number": case "range": return "1";
    case "url": return "http://127.0.0.1/";
    case "date": return "2026-11-19";
    case "tel": return "123";
    default: return "stress";
  }
}
const TEXTY = (c) => c.tag === "textarea" || (c.tag === "input" && ["", "text", "search", "email", "number", "url", "password", "tel"].includes(c.type));

export async function pressAll({ ctx, tab, stage, page, notes, tally, shellDone, quick, cell, theme = "light", only, noisy = false }) {
  const url = urlOf(stage, page, theme);
  const fresh = async () => {
    await tab.load(url, { maxMs: 8000 });
    tab.window();
    return tab.eval(COLLECT).catch(() => []);
  };
  const found = await fresh();
  tally.controlsFound += found.length;
  const kinds = new Map();
  const cap = quick ? 15 : 150;
  let pressedHere = 0;
  const results = [];
  let dirty = false;
  let list = found;
  const base = { phase: "controls", page: page.key, cell, noisy };
  for (const c of found) {
    const r = { ...c, outcome: null, listed: null };
    results.push(r);
    if (only && !only(c)) { r.listed = "not asked for in this run (--only)"; continue; }
    if (c.shell) {
      if (shellDone.has(c.sig)) { r.listed = "a shell control, pressed once on another page"; tally.controlsListed += 1; continue; }
      shellDone.add(c.sig);
    }
    const k = kinds.get(c.kind) || 0;
    kinds.set(c.kind, k + 1);
    if (!c.shell && k >= ALIKE_PRESSED) { r.listed = `one of many alike (${c.kind}); ${ALIKE_PRESSED} were pressed`; tally.controlsListed += 1; continue; }
    if (pressedHere >= cap) { r.listed = `over the cap of ${cap} a page${quick ? " (quick run)" : ""}`; tally.controlsListed += 1; continue; }
    if (c.tag === "input" && c.type === "file") { r.listed = "a file picker; a headless browser has no file to give it"; tally.controlsListed += 1; continue; }
    if (c.download) { r.listed = "a download; downloads are refused in the stage"; tally.controlsListed += 1; continue; }
    if (c.tag === "a" && c.href && !c.href.startsWith("#")) {
      // A link to an address: never followed off this Mac; on the stage its address must answer.
      let abs = null;
      try { abs = new URL(c.href, stage.urls.home + "/").href; } catch { abs = null; }
      if (!abs || !hostOk(abs, stage.base)) { r.listed = `leads off this Mac (${String(c.href).slice(0, 80)}); not followed in the stage`; tally.controlsListed += 1; continue; }
      const res = await call(abs, { timeoutMs: 15000 }).catch((e) => ({ status: 0, error: String(e.message || e) }));
      r.outcome = { how: "fetched", status: res.status };
      pressedHere += 1;
      tally.controlsPressed += 1;
      if (!(res.status >= 200 && res.status < 400)) {
        notes.note({ ...base, area: "controls", check: "link-broken", target: `${page.key}: ${norm(c.href, 70)}`, severity: "high", title: `A link on ${page.key} leads to an address that does not answer`, expected: "200", actual: `${c.href} -> ${res.status || res.error}` });
      }
      continue;
    }
    // With apps: false the stage's apps keep their live ports (3171..), so an app's switch is never pressed there.
    if (!stage.apps && (page.route === "apps" || page.route === "app") && (c.role === "switch" || /^(turn (it )?on|switch (it )?on|start|on)\b/i.test(c.name))) {
      r.listed = "an app's switch; pressed only in the apps part of this sweep, on a stage with apps: true (staged app ports)";
      tally.controlsListed += 1;
      continue;
    }
    if (dirty) { list = await fresh(); dirty = false; }
    const now = findAgain(list, c);
    if (!now) { r.listed = "not on the page after a fresh load"; tally.controlsListed += 1; continue; }
    pressedHere += 1;
    tally.controlsPressed += 1;
    if (TEXTY(c)) {
      r.outcome = await typeInto(tab, now, c, { notes, base, page, tally, cell });
      dirty = true;
      continue;
    }
    let o;
    if (c.tag === "select") {
      o = await measure(tab, () => tab.eval(`(() => { const el = window.__stressEls[${now.i}]; if (!el) return "gone"; const opts = [...el.options].filter((x) => !x.disabled); const next = opts.find((x) => x.value !== el.value); if (!next) return "one choice"; el.value = next.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return "chose " + next.value; })()`), { index: now.i });
    } else {
      // A check box or radio's own state is a property, not markup: its flip is the change.
      const box = c.tag === "input" && (c.type === "checkbox" || c.type === "radio");
      const checked = () => tab.eval(`(() => { const el = window.__stressEls[${now.i}]; return el ? !!el.checked : null; })()`).catch(() => null);
      const ck0 = box ? await checked() : null;
      o = await measure(tab, async () => {
        const aim = await tab.eval(AIM(now.i)).catch(() => null);
        if (!aim) return "gone";
        if (aim.hit) { await tab.click(aim.x, aim.y); return "clicked"; }
        await tab.eval(`window.__stressEls[${now.i}].click()`).catch(() => {});
        return "clicked by script (covered on screen)";
      }, { index: now.i });
      if (box) { const ck1 = await checked(); if (ck0 !== null && ck1 !== null && ck0 !== ck1) o.changed = true; }
    }
    r.outcome = { how: o.how, navigated: o.navigated, hash: o.hash, changed: o.changed, requests: o.requests, exceptions: o.exceptions, longTasks: o.longTasks, ms: o.ms };
    dirty = true;
    // A 502/503/504 from a home route whose upstream failed (the sign-ins, Omega Plus's list) is the home's house rule,
    // accepted by the owner (B6, 19 Nov): counted apart in tally.upstream5xx, not a finding.
    const upstream = (q) => UPSTREAM_ROUTES.test(String(q.path || q.url || "")) && [502, 503, 504].includes(q.status);
    for (const q of [...o.requests, ...o.win.failed]) if (upstream(q)) tally.upstream5xx = (tally.upstream5xx || 0) + 1;
    judgeWindow({ win: { ...o.win, failed: o.win.failed.filter((f) => (f.status >= 500 || f.status === 0) && !upstream(f)) }, snap: null, page, cell, notes, tally, phase: "controls", area: "controls", owner: true });
    for (const q of o.requests) {
      if (q.status >= 500 && !upstream(q)) notes.note({ ...base, area: "controls", check: "control-5xx", target: `${page.key}: ${norm(c.name, 40)} ${q.method} ${norm(q.path, 50)}`, severity: "high", title: `Pressing "${c.name}" on ${page.key} gets a ${q.status}`, expected: "no 5xx", actual: `${q.method} ${q.path} -> ${q.status}` });
    }
    // A link inside the app must reach a page.
    if (c.tag === "a" && c.href.startsWith("#") && o.navigated) {
      const parts = o.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
      const snap = await tab.snapshot().catch(() => null);
      if (!findRoute(parts) || (snap && (snap.notFound || snap.building))) {
        notes.note({ ...base, area: "controls", check: "link-nowhere", target: `${page.key}: ${norm(c.href, 70)}`, severity: "high", title: `A link on ${page.key} goes to no page`, expected: "the address is a page", actual: `${c.name} -> ${o.hash}` });
      }
    }
    if (!o.alive) {
      notes.note({ ...base, area: "controls", check: "page-hung", target: `${page.key}: ${norm(c.name, 50)}`, severity: "high", title: `The page stopped answering after "${c.name}" on ${page.key}`, expected: "the page answers", actual: o.how });
    } else if (!did(o) && o.how !== "gone") {
      const reasoned = c.disabled && c.reason;
      if (c.current && !c.disabled) r.outcome.note = "the current choice; pressing it again changes nothing";
      else if (!reasoned) {
        notes.note({ ...base, area: "controls", check: "dead-control", target: `${page.key}: ${c.tag}${c.role ? `[${c.role}]` : ""} ${norm(c.name || c.cls, 50)}`, severity: "high", title: `"${c.name || c.tag}" on ${page.key} does nothing`, expected: "a request, a change on the page, or a new address", actual: `${o.how}; no request, no change, no navigation${c.disabled ? "; disabled with no reason shown" : ""}` });
      }
    }
    noteLongTasks(notes, base, page, c, o.longTasks);
  }
  // Forms: sent empty, then filled.
  if (!quick && !only) {
    const forms = await tab.eval("document.querySelectorAll('form').length").catch(() => 0);
    for (let f = 0; f < Math.min(forms, 6); f += 1) {
      for (const filled of [false, true]) {
        await fresh();
        const o = await measure(tab, () => tab.eval(`(() => {
          const form = document.querySelectorAll("form")[${f}];
          if (!form) return "gone";
          for (const el of form.elements) {
            if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
            if (el.type === "file" || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
            if (${filled}) {
              if (el instanceof HTMLSelectElement) { const o = [...el.options].find((x) => x.value); if (o) el.value = o.value; }
              else if (el.type === "checkbox" || el.type === "radio") el.checked = true;
              else el.value = ({ email: "stress@example.com", number: "1", url: "http://127.0.0.1/", date: "2026-11-19" })[el.type] || "stress";
            } else if (!(el instanceof HTMLSelectElement) && el.type !== "checkbox" && el.type !== "radio") el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const b = form.querySelector("[type=submit], button:not([type=button])");
          if (b) b.click(); else form.requestSubmit ? form.requestSubmit() : form.submit();
          return "sent " + (${filled} ? "filled" : "empty");
        })()`));
        tally.controlsPressed += 1;
        judgeWindow({ win: { ...o.win, failed: o.win.failed.filter((x) => x.status >= 500 || x.status === 0) }, snap: null, page, cell, notes, tally, phase: "controls", area: "controls", owner: true });
        results.push({ form: f, filled, outcome: { how: o.how, navigated: o.navigated, changed: o.changed, requests: o.requests, exceptions: o.exceptions } });
      }
    }
  }
  const dir = join(ctx.passDir, "controls");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${page.key}.json`), `${JSON.stringify({ page: page.key, hash: page.hash, found: found.length, controls: results }, null, 2)}\n`);
  return results;
}

function noteLongTasks(notes, base, page, c, longTasks) {
  if (base.noisy) return;
  for (const t of longTasks || []) {
    if (t.ms > 100) notes.note({ ...base, area: "controls", check: "long-task-use", target: `${page.key}: ${norm(c.name || c.tag, 50)}`, severity: "medium", title: `A ${t.ms} ms long task after "${c.name}" on ${page.key}`, expected: "no long task over 100 ms while using a page", actual: `${t.ms} ms` });
    else if (t.ms >= 50) notes.note({ ...base, area: "controls", check: "long-task-use-low", target: `${page.key}: ${norm(c.name || c.tag, 50)}`, severity: "low", title: `A ${t.ms} ms long task after "${c.name}" on ${page.key}`, expected: "no long task of 50 ms or more while using a page", actual: `${t.ms} ms` });
  }
}

// A field: "stress", then 10 000 characters, then planted markup. Each must be taken, nothing may throw, and the
// markup must stay text.
async function typeInto(tab, now, c, { notes, base, page, tally, cell }) {
  const out = [];
  for (const [label, text] of [["stress", "stress"], ["10000", LONG], ["markup", XSS]]) {
    const o = await measure(tab, async () => {
      const ok = await tab.eval(`(() => { const el = window.__stressEls[${now.i}]; if (!el || !el.isConnected) return false; el.scrollIntoView({ block: "center" }); el.focus(); if (el.select) el.select(); return document.activeElement === el; })()`).catch(() => false);
      if (!ok) return "could not focus";
      await tab.type(text);
      return `typed ${label}`;
    }, { waitMs: 600 });
    const value = await tab.eval(`(() => { const el = window.__stressEls[${now.i}]; return el ? String(el.value || "").length : -1; })()`).catch(() => -1);
    out.push({ label, how: o.how, valueLength: value, requests: o.requests, exceptions: o.exceptions, changed: o.changed });
    judgeWindow({ win: { ...o.win, failed: o.win.failed.filter((f) => f.status >= 500 || f.status === 0) }, snap: null, page, cell, notes, tally, phase: "controls", area: "controls", owner: true });
    const planted = await tab.eval("document.querySelectorAll(\"img[src='x'], [onerror]\").length").catch(() => 0);
    if (planted > 0) notes.note({ ...base, area: "safety", check: "typed-markup", target: `${page.key}: ${norm(c.name, 50)}`, severity: "critical", title: `Markup typed into "${c.name}" on ${page.key} became an element`, expected: "typed text stays text", actual: `${planted} element(s)` });
    if (o.how === "could not focus" && !c.disabled) {
      notes.note({ ...base, area: "controls", check: "field-unfocusable", target: `${page.key}: ${norm(c.name, 50)}`, severity: "high", title: `The field "${c.name}" on ${page.key} cannot take focus`, expected: "the field takes focus and text", actual: o.how });
      break;
    }
    noteLongTasks(notes, base, page, c, o.longTasks);
  }
  return { how: "typed", steps: out };
}
