// The engine stopped while a page is open (S-recovery-0dfd431c, S-recovery-90f75d0a): the shell asks /healthz on a
// short visible beat, says "The engine is not answering." over whatever is on screen, and when the engine answers
// again clears the line and reads the shell at once. Nothing is read while the page is hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeElement, PUBLIC, html, installDom, render, settle } from "./kit/_dom.mjs";

const load = (p) => import(`${new URL(join(PUBLIC, p), "file://").href}`);
const read = (p) => readFileSync(join(PUBLIC, p), "utf8");

test("useEngineDown: null while /healthz answers, the not-answering error when it does not, null again when it is back", async () => {
  installDom();
  const heard = [];
  document.addEventListener = (t, f) => heard.push([t, f]);
  document.removeEventListener = (t, f) => { const i = heard.findIndex((h) => h[0] === t && h[1] === f); if (i >= 0) heard.splice(i, 1); };
  const real = globalThis.fetch;
  let up = true;
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    if (!up) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, json: async () => ({ status: "ok", part: "home" }) };
  };
  const root = new FakeElement("div");
  let seen = "unset";
  let backs = 0;
  try {
    const { useEngineDown } = await load("lib/api.js");
    function Probe() { const down = useEngineDown(40, () => { backs += 1; }); seen = down; return null; }
    document.visibilityState = "visible";
    render(html`<${Probe} />`, root);
    await settle(400);
    assert.equal(seen, null, "the engine answers: nothing said");
    assert.ok(paths.length >= 2 && paths.every((p) => p === "/healthz"), `only /healthz is asked: ${JSON.stringify(paths)}`);
    assert.equal(backs, 0, "not back from anything");
    up = false;
    await settle(300);
    assert.ok(seen && seen.offline, "the engine stopped: the not-answering error");
    assert.equal(seen.message, "The engine is not answering.");
    assert.equal(seen.next, "Run: engine start");
    up = true;
    await settle(300);
    assert.equal(seen, null, "back: the line goes");
    assert.equal(backs, 1, "back: onBack once");
    await settle(100);
    assert.equal(backs, 1, "and only once");
    document.visibilityState = "hidden";
    await settle(60);
    const at = paths.length;
    await settle(200);
    assert.equal(paths.length, at, "a hidden page asks nothing");
  } finally {
    render(null, root);
    globalThis.fetch = real;
  }
});

test("an answer that is not the engine being down (a 404, a 421) says nothing", async () => {
  installDom();
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 421, json: async () => ({ error: { message: "This address is not the home screen.", next: "", code: "wrong_host" } }) });
  const root = new FakeElement("div");
  let seen = "unset";
  try {
    const { useEngineDown } = await load("lib/api.js");
    function Probe() { seen = useEngineDown(40); return null; }
    document.visibilityState = "visible";
    render(html`<${Probe} />`, root);
    await settle(400);
    assert.equal(seen, null);
  } finally {
    render(null, root);
    globalThis.fetch = real;
  }
});

test("the shell shows the offline line from useEngineDown even with old data on screen, on a 3 s beat, and reads the shell when back", () => {
  const src = read("shell/app-shell.js");
  assert.match(src, /const ALIVE_EVERY = 3000;/);
  assert.match(src, /const down = useEngineDown\(ALIVE_EVERY, \(\) => shell\.refresh\(\)\);/);
  assert.match(src, /const offline = shell\.error && !shell\.data \? shell\.error : down;/);
  assert.match(src, /<p class="s-offline" role="status">\$\{offline\.message\}/);
});

test("a partial Needs-you count is read as a floor: 'at least' and a plus (REVIEW-STRESS 2)", async () => {
  const { needsLabel } = await load("shell/topbar.js");
  assert.equal(needsLabel(3), "Needs you, 3 waiting");
  assert.equal(needsLabel(3, true), "Needs you, at least 3 waiting: a part did not answer");
  assert.equal(needsLabel(0, true), "Needs you, at least 0 waiting: a part did not answer");
  const side = read("shell/sidenav.js");
  assert.match(side, /const partial = shell\?\.counts\?\.partial === true;/);
  assert.match(side, /label=\$\{needsLabel\(needs, partial\)\}.*more=\$\{partial\}/);
  assert.match(side, /more \? `\$\{count\}\+` : count/);
  assert.match(read("shell/topbar.js"), /needsLabel\(needs, shell\?\.counts\?\.partial === true\)/);
});
