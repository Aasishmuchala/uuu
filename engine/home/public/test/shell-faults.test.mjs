// Three faults of the end-to-end simulation of the redesign (the New task dialog and Escape, the sidebar's count of a
// page nobody sees, the top bar at phone width). Mounted in the test DOM; a mounted test can fail on a busy machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeElement, PUBLIC, byClass, html, installDom, render, settle, textOf } from "./kit/_dom.mjs";

const load = (p) => import(`${new URL(join(PUBLIC, p), "file://").href}`);
const read = (p) => readFileSync(join(PUBLIC, p), "utf8");

test("the New task dialog closes on Escape heard anywhere on the page, as after a task is given", async () => {
  installDom();
  const heard = [];
  document.addEventListener = (t, f) => heard.push([t, f]);
  document.removeEventListener = (t, f) => { const i = heard.findIndex((h) => h[0] === t && h[1] === f); if (i >= 0) heard.splice(i, 1); };
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ departments: [] }) });
  try {
    const { ComposeDialog } = await load("shell/compose-dialog.js");
    let closed = 0;
    const root = new FakeElement("div");
    render(html`<${ComposeDialog} open=${true} seed=${{ n: 1 }} team=${[]} queue=${null} onClose=${() => { closed += 1; }} onSent=${() => {}} />`, root);
    await settle();
    const keys = heard.filter((h) => h[0] === "keydown");
    assert.equal(keys.length, 1, "one keydown listener on the document while the dialog is open");
    // Focus is on the page, not in the dialog (the Composer is gone once a task is given).
    document.activeElement = null;
    const other = { key: "a", defaultPrevented: false, preventDefault() {} };
    keys[0][1](other);
    assert.equal(closed, 0, "another key does not close it");
    let prevented = 0;
    keys[0][1]({ key: "Escape", defaultPrevented: false, preventDefault() { prevented += 1; } });
    assert.equal(closed, 1, "Escape closes it");
    assert.equal(prevented, 1);
    keys[0][1]({ key: "Escape", defaultPrevented: true, preventDefault() {} });
    assert.equal(closed, 1, "an Escape already used by the dialog or its list closes nothing twice");
    render(null, root);
    await settle();
    assert.equal(heard.filter((h) => h[0] === "keydown").length, 0, "no listener once the dialog is gone");
  } finally {
    globalThis.fetch = real;
  }
});

test("once a task is given, focus moves to the note inside the dialog and the dialog gives focus back to its opener", () => {
  const js = read("shell/compose-dialog.js");
  assert.match(js, /class="s-compose-done" role="status" tabindex="-1" ref=\$\{done\}/);
  assert.match(js, /done\.current\.focus\(\)/);
  const overlays = read("kit/overlays.js");
  assert.match(overlays, /opener\.focus\(\)/, "the kit's dialog returns focus to what opened it when it goes away");
});

test("the shell reads /api/shell on the same beat while the page is hidden, so the sidebar's count follows it", async () => {
  installDom();
  const { useHiddenInterval } = await load("shell/app-shell.js");
  let n = 0;
  function Probe() {
    useHiddenInterval(() => { n += 1; }, 20);
    return null;
  }
  const root = new FakeElement("div");
  document.visibilityState = "visible";
  render(html`<${Probe} />`, root);
  await settle(400);
  assert.equal(n, 0, "a visible page is read by useResource's own beat, not twice");
  document.visibilityState = "hidden";
  await settle(400);
  assert.ok(n >= 3, `a hidden page is read on the beat (${n})`);
  render(null, root);
  const at = n;
  await settle(150);
  assert.equal(n, at, "the beat stops with the shell");
  const src = read("shell/app-shell.js");
  assert.match(src, /useHiddenInterval\(shell\.refresh, SHELL_EVERY\)/);
  assert.match(src, /useResource\("\/api\/shell", \{ every: SHELL_EVERY \}\)/);
});

test("the top bar draws the phone's bar whenever the window is under 860 px, whatever the shell last said", async () => {
  installDom();
  const listeners = [];
  globalThis.matchMedia = () => ({ matches: true, addEventListener: (t, f) => listeners.push(f), removeEventListener() {} });
  try {
    const { Topbar } = await load("shell/topbar.js");
    const root = new FakeElement("div");
    render(html`<${Topbar} routeId="map" parts=${["map"]} shell=${null} top=${null} narrow=${false} side="icons" />`, root);
    await settle();
    assert.equal(byClass(root, "s-top--narrow").length, 1, "the narrow bar");
    assert.equal(byClass(root, "s-find").length, 0, "no Search button wider than the phone");
    assert.equal(byClass(root, "s-queue-btn").length, 0);
    assert.match(textOf(root), /Map/);
    render(null, root);
  } finally {
    delete globalThis.matchMedia;
  }
});

test("under 860 px the wide bar cannot widen the page: it clips, its crumbs shrink, the search button has no minimum", () => {
  const css = read("styles/shell.css");
  const block = /@media \(max-width: 859px\) \{\s*\.s-top \{([^}]*)\}([\s\S]*?)\n\}\n/.exec(css);
  assert.ok(block, "a rule for the wide bar under 860 px");
  assert.match(block[1], /overflow-x: clip/);
  assert.match(block[1], /max-width: 100%/);
  assert.match(block[2], /\.s-top \.s-find \{\s*min-width: 0;/);
  assert.match(block[2], /\.s-top \.s-find-words,[\s\S]*display: none/);
  assert.match(block[2], /\.s-top \.s-crumbs \{\s*flex: 0 1 auto;\s*overflow: hidden;/);
});
