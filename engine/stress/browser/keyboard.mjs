// The keyboard alone, per page at 1280 (PLAN-STRESS T3): Tab from the top through every control, then Escape on what
// opens, then Enter or Space against the click for a sample of five controls.
//   keyboardPage({ tab, stage, page, notes, cell, theme, sample }) -> { walked, focused, ring, trap, escape, keys }
// Findings: a control from the list never focused, focus with no visible ring (the focused control's outline, shadow,
// border and fill compared with its look before anything had focus), a trap (focus cannot leave), Escape not closing
// an open menu or dialog, Enter or Space doing nothing where the click does something.
import { COLLECT, findAgain } from "./controls.mjs";
import { norm } from "./notes.mjs";
import { press, sleep } from "./recorder.mjs";
import { urlOf } from "./pages.mjs";

const ACTIVE = `(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { i: -1, body: true };
  const i = (window.__stressEls || []).indexOf(a);
  const cs = getComputedStyle(a);
  return {
    i, body: false, tag: a.tagName.toLowerCase(), cls: String(a.className || "").slice(0, 60), name: (a.getAttribute("aria-label") || a.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 50),
    inDialog: !!a.closest("[role=dialog]"),
    ring: { outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor, shadow: cs.boxShadow, border: cs.borderColor, bg: cs.backgroundColor },
    up: [a.parentElement, a.parentElement && a.parentElement.parentElement, a.parentElement && a.parentElement.parentElement && a.parentElement.parentElement.parentElement]
      .map((u) => { if (!u) return null; const s = getComputedStyle(u); return s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor + "|" + s.boxShadow + "|" + s.borderColor; }),
  };
})()`;

const OPEN_COUNT = `[...document.querySelectorAll("[role=dialog], [role=menu], [role=listbox], dialog[open], .k-drawer__panel")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length`;

// before: the control as collected before anything had focus ({ ring, up }); a ring on one of its three ancestors
// (the kit's composer box, money field and dashboard card draw it there, by design) counts.
const ringShows = (now, beforeCtl) => {
  const before = beforeCtl && beforeCtl.ring;
  if (!now || !before) return true;
  // An open combobox (the command menu's field) shows the keyboard's place on its marked row, by design (the shell's
  // test pins "no ring: the marked row shows the keyboard's place").
  if (beforeCtl.role === "combobox" && beforeCtl.expanded === "true") return true;
  if (Array.isArray(now.up) && Array.isArray(beforeCtl.up) && now.up.some((u, k) => u && beforeCtl.up[k] && u !== beforeCtl.up[k])) return true;
  const outline = /^(none|hidden)\b/.test(now.ring.outline) || / 0px /.test(now.ring.outline) ? null : now.ring.outline;
  if (outline && outline !== before.outline) return true;
  if (now.ring.shadow !== "none" && now.ring.shadow !== before.shadow) return true;
  if (now.ring.border !== before.border) return true;
  if (now.ring.bg !== before.bg) return true;
  return false;
};

const MUT = "(window.__stress ? window.__stress.mutations : 0)";

// One action and whether anything came of it (a request that is not the shell's clock, a change, a new address).
async function effect(tab, act) {
  const h0 = await tab.eval("location.hash").catch(() => "");
  const m0 = await tab.eval(MUT).catch(() => 0);
  await sleep(300);
  const m1 = await tab.eval(MUT).catch(() => 0);
  tab.window();
  await act();
  await sleep(1000);
  await tab.settle({ quietMs: 300, maxMs: 4000 });
  const win = tab.window();
  const h1 = await tab.eval("location.hash").catch(() => h0);
  const m2 = await tab.eval(MUT).catch(() => m1);
  const reqs = win.requests.filter((r) => /^https?:/.test(r.url || "") && !/\/api\/(shell|setup|settings)(\?|$)/.test(r.url));
  return { did: h1 !== h0 || win.navigations > 0 || reqs.length > 0 || m2 - m1 > Math.max(0, m1 - m0) * 4, exceptions: win.exceptions };
}

export async function keyboardPage({ tab, stage, page, notes, cell, theme = "light", sample = 5 }) {
  const url = urlOf(stage, page, theme);
  const base = { phase: "keyboard", page: page.key, cell };
  await tab.load(url, { maxMs: 8000 });
  const list = await tab.eval(COLLECT).catch(() => []);
  // From the top: nothing focused, then Tab.
  await tab.eval("(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); return true; })()").catch(() => {});
  const max = Math.min(400, list.length * 2 + 20);
  const seen = new Map(); // index -> ring shown
  const order = [];
  let left = false;
  let wrapped = false;
  let first = null;
  for (let n = 0; n < max; n += 1) {
    await press(tab, "Tab");
    await sleep(60);
    const a = await tab.eval(ACTIVE).catch(() => null);
    if (!a) break;
    if (a.body) { if (order.length) { left = true; break; } continue; }
    const id = a.i >= 0 ? `i${a.i}` : `${a.tag}.${a.cls}|${a.name}`;
    if (first === null) first = id;
    else if (id === first) { wrapped = true; break; }
    order.push(id);
    if (a.i >= 0 && !seen.has(a.i)) seen.set(a.i, ringShows(a, list[a.i]));
  }
  const res = { controls: list.length, walked: order.length, focused: seen.size, left, wrapped, noRing: [], never: [], trap: false, escape: [], keys: [] };
  // A page opened with a dialog on it ("?open=") keeps focus inside the dialog, as a modal must: no trap and no
  // control behind it is "never reached". Escape closing it is the shell's own check (keyboardShell).
  const modal = !!page.open;
  // A trap: focus neither left the page nor came back round, and kept circling a few places.
  if (!modal && !left && !wrapped && order.length >= max - 1) {
    const tail = order.slice(-30);
    if (new Set(tail).size <= 6) {
      res.trap = true;
      notes.note({ ...base, area: "keyboard", check: "trap", target: page.key, severity: "medium", title: `Focus is trapped on ${page.key}`, expected: "Tab can leave every part of the page", actual: `circling ${new Set(tail).size} places after ${order.length} presses` });
    }
  }
  for (const [i, shown] of seen) {
    if (!shown) res.noRing.push(list[i]);
  }
  if (res.noRing.length) {
    const names = res.noRing.slice(0, 8).map((c) => `${c.tag}${c.role ? `[${c.role}]` : ""} "${c.name || c.cls}"`);
    for (const c of res.noRing) {
      notes.note({ ...base, area: "keyboard", check: "no-ring", target: `${c.shell ? "shell" : page.key}: ${c.tag} ${norm(c.cls || c.name, 40)}`, severity: "medium", title: `Focus has no visible ring on ${c.shell ? "the shell" : page.key}`, expected: "a visible change when focused by the keyboard", actual: names.join(", ") });
    }
  }
  if (!modal && (left || wrapped)) {
    for (const c of list) {
      if (seen.has(c.i) || c.disabled || c.tabIndex < 0 || c.roving) continue;
      res.never.push(c);
    }
    for (const c of res.never) {
      notes.note({ ...base, area: "keyboard", check: "never-focused", target: `${c.shell ? "shell" : page.key}: ${c.tag}${c.role ? `[${c.role}]` : ""} ${norm(c.name || c.cls, 40)}`, severity: "medium", title: `A control on ${c.shell ? "the shell" : page.key} cannot be reached with Tab`, expected: "every control is reached by Tab", actual: `${c.tag} "${c.name}" (${c.cls})` });
    }
  }
  // Escape on what opens: controls that say they open something (at most three a page).
  const openers = list.filter((c) => !c.disabled && (c.popup || c.expanded === "false") && !c.shell).slice(0, 3);
  for (const c of openers) {
    await tab.load(url, { maxMs: 8000 });
    const now = findAgain(await tab.eval(COLLECT).catch(() => []), c);
    if (!now) continue;
    const before = await tab.eval(OPEN_COUNT).catch(() => 0);
    await tab.eval(`window.__stressEls[${now.i}].focus()`).catch(() => {});
    await press(tab, "Enter");
    await sleep(500);
    const opened = await tab.eval(OPEN_COUNT).catch(() => 0);
    const exp = await tab.eval(`(window.__stressEls[${now.i}] || {}).getAttribute ? window.__stressEls[${now.i}].getAttribute("aria-expanded") : null`).catch(() => null);
    // Only a menu or a dialog that opened is Escape's to close; a section shown in place (aria-expanded alone) is not.
    if (opened <= before) { res.escape.push({ name: c.name, opened: false, expanded: exp === "true" }); continue; }
    await press(tab, "Escape");
    await sleep(400);
    const after = await tab.eval(OPEN_COUNT).catch(() => 0);
    const closed = after <= before;
    res.escape.push({ name: c.name, opened: true, closed });
    if (!closed) notes.note({ ...base, area: "keyboard", check: "escape", target: `${page.key}: ${norm(c.name || c.cls, 50)}`, severity: "medium", title: `Escape does not close what "${c.name}" opens on ${page.key}`, expected: "Escape closes it", actual: `${after} open after Escape` });
  }
  // Enter or Space against the click, for a sample of the page's own controls.
  const keyable = list.filter((c) => !c.disabled && !c.shell && c.tabIndex >= 0 && !(c.tag === "input" && !["checkbox", "radio", "button", "submit"].includes(c.type)) && c.tag !== "textarea" && c.tag !== "select" && !c.download && !(c.tag === "a" && !String(c.href).startsWith("#")));
  const picked = [];
  const kinds = new Set();
  for (const c of keyable) { if (picked.length >= sample) break; if (kinds.has(c.kind)) continue; kinds.add(c.kind); picked.push(c); }
  for (const c of picked) {
    const key = c.role === "switch" || c.type === "checkbox" || c.type === "radio" ? "Space" : "Enter";
    await tab.load(url, { maxMs: 8000 });
    let now = findAgain(await tab.eval(COLLECT).catch(() => []), c);
    if (!now) continue;
    const click = await effect(tab, () => tab.eval(`window.__stressEls[${now.i}].click()`).catch(() => {}));
    await tab.load(url, { maxMs: 8000 });
    now = findAgain(await tab.eval(COLLECT).catch(() => []), c);
    if (!now) continue;
    await tab.eval(`window.__stressEls[${now.i}].focus()`).catch(() => {});
    const byKey = await effect(tab, () => press(tab, key));
    res.keys.push({ name: c.name, key, click: click.did, key_: byKey.did });
    if (click.did && !byKey.did) {
      notes.note({ ...base, area: "keyboard", check: "key-vs-click", target: `${page.key}: ${key} ${c.tag}${c.role ? `[${c.role}]` : ""} ${norm(c.name || c.cls, 40)}`, severity: "medium", title: `${key} does not do what the click does on "${c.name}" (${page.key})`, expected: `${key} acts as the click`, actual: "the click did something; the key did nothing" });
    }
  }
  return res;
}

// The shell's own keys, once: the command menu (Ctrl+K and Cmd+K), the queue ("q"), compose ("c"), each closed by
// Escape with focus back where it was.
export async function keyboardShell({ tab, stage, notes, cell, theme = "light" }) {
  const page = { key: "shell", hash: "#/tasks" };
  const base = { phase: "keyboard", page: "shell", cell };
  const url = urlOf(stage, page, theme);
  const out = [];
  const tries = [
    { name: "command menu (Ctrl+K)", act: () => tab.key("k", { code: "KeyK", keyCode: 75, modifiers: 2 }) },
    { name: "command menu (Cmd+K)", act: () => tab.key("k", { code: "KeyK", keyCode: 75, modifiers: 4 }) },
    { name: "queue (q)", act: () => tab.key("q", { code: "KeyQ", keyCode: 81, text: "q" }) },
    { name: "compose (c)", act: () => tab.key("c", { code: "KeyC", keyCode: 67, text: "c" }) },
  ];
  for (const t of tries) {
    await tab.load(url, { maxMs: 8000 });
    await tab.eval("document.activeElement && document.activeElement.blur && document.activeElement.blur()").catch(() => {});
    const before = await tab.eval(OPEN_COUNT).catch(() => 0);
    await t.act();
    await sleep(600);
    const opened = await tab.eval(OPEN_COUNT).catch(() => 0);
    if (opened <= before) {
      out.push({ name: t.name, opened: false });
      notes.note({ ...base, area: "keyboard", check: "shell-key", target: `shell: ${t.name}`, severity: "medium", title: `The ${t.name} key opens nothing`, expected: "it opens", actual: "nothing opened" });
      continue;
    }
    await press(tab, "Escape");
    await sleep(400);
    const after = await tab.eval(OPEN_COUNT).catch(() => 0);
    out.push({ name: t.name, opened: true, closed: after <= before });
    if (after > before) notes.note({ ...base, area: "keyboard", check: "escape", target: `shell: ${t.name}`, severity: "medium", title: `Escape does not close the ${t.name}`, expected: "Escape closes it", actual: `${after} open after Escape` });
  }
  return out;
}
