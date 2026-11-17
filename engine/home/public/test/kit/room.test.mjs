// The room header, its picture's address and the lamp (PLAN-3D-ALL D6, 4.2, U2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, html, render, installDom, showTree, elements, textOf, classesOf, byClass, fire, settle } from "./_dom.mjs";
import { compositeSheetTests } from "./_rules.mjs";

installDom();
const room = await import(pathToFileURL(join(KIT, "room.js")).href);
const page = await import(pathToFileURL(join(KIT, "page.js")).href);
const { AppContext } = await import(pathToFileURL(join(PUBLIC, "lib", "context.js")).href);
const { glimpseFor, glimpseSrc, RoomHeader, Lamp, GLIMPSES } = room;

// PLAN-3D section 3's hostile strings, and other things an address could be made of.
const HOSTILE = ["<img src=x onerror=alert(1)>", "\"><script>alert(1)</script>", "javascript:alert(1)", "\");background:url(//evil.example/x)", "${7*7}", "x".repeat(5000), "‮gnp.exe", "../../x"];

test("glimpseFor: the vectors of 4.2", () => {
  assert.equal(glimpseFor("tasks"), "desk");
  assert.equal(glimpseFor("dept", "books"), "room-books");
  assert.equal(glimpseFor("dept", "customers"), "room");
  assert.equal(glimpseFor("dept", "../../x"), "room");
  assert.equal(glimpseFor("dashboard", "customers"), "room-sales");
  assert.equal(glimpseFor("settings"), "facade");
  assert.equal(glimpseFor("app"), null);
  assert.equal(glimpseFor("nope"), "room");
  assert.equal(glimpseFor(null), "room");
});

test("glimpseFor: every route of section 3 gives its key, and every key it gives is in the table", () => {
  const routes = {
    tasks: "desk", dashboards: "facade", marketing: "room-marketing", studio: "table", files: "shelves", jobs: "table",
    team: "facade", agent: "desk", routines: "facade", health: "facade", settings: "facade", search: "shelves", apps: "terrace",
  };
  for (const [r, k] of Object.entries(routes)) assert.equal(glimpseFor(r), k, r);
  assert.equal(glimpseFor("task", "sales"), "room-sales");
  assert.equal(glimpseFor("task"), "desk");
  assert.equal(glimpseFor("job", "people"), "room-people");
  assert.equal(glimpseFor("job", "nope"), "table");
  for (const d of ["books", "customers", "support", "people"]) assert.match(glimpseFor("dashboard", d), /^room-/);
  assert.equal(glimpseFor("dashboard", "__proto__"), "facade");
  assert.equal(glimpseFor("map"), null);
  assert.equal(glimpseFor("needs-you"), null);
  assert.equal(glimpseFor("__proto__"), "room");
  assert.equal(glimpseFor("constructor"), "room");
  for (const h of HOSTILE) {
    for (const r of ["task", "job", "dept", "dashboard", h]) {
      const k = glimpseFor(r, h);
      assert.ok(k === null || GLIMPSES.includes(k), `${r} with a hostile hint gives a key of the table`);
    }
  }
  assert.ok(Object.isFrozen(GLIMPSES));
  assert.equal(GLIMPSES.length, 14, "the fourteen keys of D7");
});

test("glimpseSrc: the vectors of 4.2", () => {
  assert.equal(glimpseSrc("room-books", { theme: "dark", width: 1280 }), "./assets/glimpse/v1/room-books-dusk-1600.webp");
  assert.equal(glimpseSrc("room-books", { theme: "light", width: 390 }), "./assets/glimpse/v1/room-books-morning-780.webp");
  assert.equal(glimpseSrc("x/../y", { theme: "dark", width: 1280 }), null);
  assert.equal(glimpseSrc("__proto__", { theme: "dark", width: 1280 }), null);
  assert.equal(glimpseSrc("desk"), "./assets/glimpse/v1/desk-dusk-1600.webp", "no look: dusk, wide");
  assert.equal(glimpseSrc("desk", { theme: "auto", width: 859 }), "./assets/glimpse/v1/desk-dusk-780.webp");
  assert.equal(glimpseSrc("desk", { theme: "light", width: 860 }), "./assets/glimpse/v1/desk-morning-1600.webp");
});

test("glimpseSrc: no input can make it give an address outside ./assets/glimpse/v1/ (200 strings, the hostile set among them)", () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz-/._%:?#&=\\ \u0000‮<>\"'()";
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const inputs = [...HOSTILE, "constructor", "toString", "hasOwnProperty", "room-", "room-books/", " room-books", "ROOM-BOOKS", "room-books\u0000"];
  while (inputs.length < 200) {
    let s = "";
    const n = next() % 24;
    for (let i = 0; i < n; i++) s += alphabet[next() % alphabet.length];
    if (next() % 3 === 0) s = GLIMPSES[next() % GLIMPSES.length] + s;
    inputs.push(s);
  }
  const looks = [{}, { theme: "light", width: 390 }, { theme: HOSTILE[3], width: HOSTILE[1] }, { theme: "dark", width: Number.NaN }];
  for (const v of [...inputs, null, undefined, 3, {}, [], ["desk"], { toString: () => "desk" }]) {
    for (const look of looks) {
      const out = glimpseSrc(v, look);
      if (out === null) continue;
      assert.ok(out.startsWith("./assets/glimpse/v1/"), `${JSON.stringify(v)} stays in the folder`);
      assert.match(out, /^\.\/assets\/glimpse\/v1\/[a-z-]+-(dusk|morning)-(1600|780)\.webp$/);
      assert.ok(GLIMPSES.includes(v), "only a key of the table gives an address");
    }
  }
});

// The room header in the test DOM. The page's address and the browser's data saving are set per test.
function setPlace({ href = "/index.html#/tasks", saveData = false } = {}) {
  globalThis.location = { href };
  Object.defineProperty(globalThis, "navigator", { value: { connection: { saveData } }, configurable: true, writable: true });
}
const img = (root) => elements(root).filter((e) => e.localName === "img");

test("RoomHeader: one h1#page-title, the band's picture hidden from readers, decoded off the main path, never lazy", async () => {
  installDom();
  setPlace();
  const root = await showTree(RoomHeader, { glimpse: "room-books", title: "Books", lede: "Invoices and quotations.", actions: html`<button type="button">New</button>` });
  const head = elements(root)[1];
  assert.equal(head.localName, "header");
  assert.deepEqual(classesOf(head), ["k-room"]);
  assert.equal(head.getAttribute("data-glimpse"), "room-books");
  const h1s = elements(root).filter((e) => e.localName === "h1");
  assert.equal(h1s.length, 1);
  assert.equal(h1s[0].getAttribute("id"), "page-title");
  assert.equal(textOf(h1s[0]), "Books");
  const [pic] = img(root);
  assert.ok(pic, "the picture is drawn");
  assert.equal(pic.getAttribute("alt"), "");
  assert.equal(pic.getAttribute("aria-hidden"), "true");
  assert.equal(pic.getAttribute("decoding"), "async");
  assert.equal(pic.getAttribute("loading"), null, "the first thing on the page is not lazy");
  assert.equal(pic.getAttribute("src") ?? pic.src, glimpseSrc("room-books", { theme: "dark", width: 1280 }));
  assert.equal(byClass(root, "k-room__band")[0].getAttribute("aria-hidden"), "true");
  assert.equal(textOf(byClass(root, "k-page-header__lede")[0]), "Invoices and quotations.");
  assert.ok(byClass(root, "k-page-header__actions").length === 1);
  render(null, root);
});

test("RoomHeader: no picture when the browser saves data, when the address holds glimpse=off, after its error, or for a key not in the table", async () => {
  installDom();
  setPlace({ saveData: true });
  let root = await showTree(RoomHeader, { glimpse: "desk", title: "Tasks" });
  assert.equal(img(root).length, 0, "saveData");
  assert.ok(classesOf(elements(root)[1]).includes("k-room--bare"));
  render(null, root);

  for (const href of ["/index.html#/tasks?glimpse=off", "/index.html?glimpse=off#/tasks", "/index.html#/tasks?x=1&glimpse=off"]) {
    setPlace({ href });
    root = await showTree(RoomHeader, { glimpse: "desk", title: "Tasks" });
    assert.equal(img(root).length, 0, href);
    render(null, root);
  }
  setPlace({ href: "/index.html#/tasks?glimpse=offish" });
  root = await showTree(RoomHeader, { glimpse: "desk", title: "Tasks" });
  assert.equal(img(root).length, 1, "only the word off turns it off");
  render(null, root);

  setPlace();
  root = await showTree(RoomHeader, { glimpse: "desk", title: "Tasks" });
  fire(img(root)[0], "error");
  await settle();
  assert.equal(img(root).length, 0, "after its error event");
  assert.ok(classesOf(elements(root)[1]).includes("k-room--bare"));
  assert.equal(elements(root).filter((e) => e.localName === "h1").length, 1, "the words stay");
  render(null, root);

  for (const glimpse of [undefined, "nope", "../../x", HOSTILE[0], "__proto__"]) {
    root = await showTree(RoomHeader, { glimpse, title: "Tasks" });
    assert.equal(img(root).length, 0, String(glimpse));
    assert.equal(elements(root)[1].getAttribute("data-glimpse"), "none");
    render(null, root);
  }
});

test("RoomHeader: the same crumbs to the top bar as PageHeader for the same props", async () => {
  installDom();
  setPlace();
  const cases = [
    { title: "Brand kit", chip: { label: ["Files", "Brand kit"], href: "#/files" } },
    { title: "STH-25", crumbs: [{ label: "Tasks", href: "#/tasks" }, { label: "STH-25", href: "#/task/STH-25" }] },
    { title: "Somewhere", chip: { label: "Somewhere", href: "javascript:alert(1)" } },
  ];
  for (const props of cases) {
    const calls = { page: [], room: [] };
    const wrap = (C, list) => (p) => html`<${AppContext.Provider} value=${{ setTop: (t) => list.push(t) }}><${C} ...${p} /><//>`;
    let root = await showTree(wrap(page.PageHeader, calls.page), props);
    render(null, root);
    root = await showTree(wrap(RoomHeader, calls.room), { glimpse: "shelves", ...props });
    render(null, root);
    assert.ok(calls.page.length > 0, "PageHeader called setTop");
    assert.deepEqual(calls.room, calls.page, JSON.stringify(props));
  }
  // Nothing to say: neither calls it.
  const none = [];
  const root = await showTree((p) => html`<${AppContext.Provider} value=${{ setTop: (t) => none.push(t) }}><${RoomHeader} ...${p} /><//>`, { glimpse: "desk", title: "Tasks" });
  render(null, root);
  assert.equal(none.length, 0);
});

test("RoomHeader: the window's title, the kind line and the state as PageHeader draws them; hostile words stay text", async () => {
  installDom();
  setPlace();
  const bad = HOSTILE[0];
  const root = await showTree(RoomHeader, { glimpse: "annex", title: bad, over: "SETTINGS", lede: HOSTILE[1], state: html`<span class="k-tag">${HOSTILE[3]}</span>` });
  assert.equal(document.title, bad);
  assert.equal(textOf(byClass(root, "k-page-header__over")[0]), "Settings");
  assert.equal(textOf(elements(root).find((e) => e.localName === "h1")), bad);
  assert.equal(byClass(root, "k-page-header__state").length, 1);
  assert.equal(img(root).length, 1, "only the band's own picture");
  assert.equal(img(root)[0].getAttribute("src"), glimpseSrc("annex", { theme: "dark", width: 1280 }));
  assert.ok(!elements(root).some((e) => e.localName === "script"));
  for (const e of elements(root)) for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k} attribute`);
  render(null, root);
});

test("RoomHeader: the light theme gives the morning picture; a narrow window the 780 px file", async () => {
  installDom();
  setPlace();
  const attrs = { "data-theme": "light" };
  document.documentElement = { getAttribute: (k) => attrs[k] ?? null };
  globalThis.innerWidth = 390;
  try {
    const root = await showTree(RoomHeader, { glimpse: "terrace", title: "App Studio" });
    assert.equal(img(root)[0].getAttribute("src"), "./assets/glimpse/v1/terrace-morning-780.webp");
    render(null, root);
  } finally {
    delete document.documentElement;
    delete globalThis.innerWidth;
  }
});

test("RoomHeader's sheet: the band's height is set by class at 152, 120 and 96 px, never by the picture; the picture covers it", () => {
  const c = readFileSync(join(PUBLIC, "styles", "kit", "room.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(/\.k-room \{([^}]*)\}/.exec(c)[1], /min-height: 152px;/);
  assert.match(c, /@media \(max-width: 1279px\) \{\s*\.k-room \{\s*min-height: 120px;/);
  assert.match(c, /@media \(max-width: 859px\) \{\s*\.k-room \{\s*min-height: 96px;/);
  const pic = /\.k-room__img \{([^}]*)\}/.exec(c)[1];
  assert.match(pic, /position: absolute;/);
  assert.match(pic, /object-fit: cover;/);
  assert.match(/\.k-room__band \{([^}]*)\}/.exec(c)[1], /overflow: hidden;/, "the band clips the picture");
  assert.doesNotMatch(/\.k-room \{([^}]*)\}/.exec(c)[1], /overflow/, "never the words");
  assert.match(c, /var\(--room-scrim-0/, "the scrim is made of the two tokens");
  assert.match(c, /var\(--room-scrim-1/);
  assert.match(c, /@media \(max-width: 859px\) \{[\s\S]*\.k-room__head \.k-page-header__actions \.k-btn \{\s*min-height: calc\(var\(--h-lg\) \+ var\(--s-1\)\);/, "44 px actions on a phone");
});

test("Lamp: five states, each its own shape class; hidden from readers without a label, named with one", async () => {
  installDom();
  const shapes = new Set();
  for (const state of ["on", "amber", "red", "off", "down"]) {
    const root = await showTree(Lamp, { state });
    const lamp = byClass(root, "k-lamp")[0];
    assert.ok(classesOf(lamp).includes(`k-lamp--${state}`));
    const shape = classesOf(lamp).find((c) => /^k-lamp--(disc|halo|ring|hollow|line)$/.test(c));
    assert.ok(shape, `${state} has a shape class`);
    shapes.add(shape);
    assert.equal(lamp.getAttribute("aria-hidden"), "true");
    assert.equal(lamp.getAttribute("role"), null);
    render(null, root);
  }
  assert.equal(shapes.size, 5, "five different shapes");
  let root = await showTree(Lamp, { state: "red", label: "Stuck" });
  const lamp = byClass(root, "k-lamp")[0];
  assert.equal(lamp.getAttribute("role"), "img");
  assert.equal(lamp.getAttribute("aria-label"), "Stuck");
  assert.equal(lamp.getAttribute("aria-hidden"), null);
  render(null, root);
  root = await showTree(Lamp, { state: HOSTILE[0] });
  assert.deepEqual(classesOf(byClass(root, "k-lamp")[0]), ["k-lamp", "k-lamp--off", "k-lamp--hollow"], "an unknown state is off");
  render(null, root);
  const c = readFileSync(join(PUBLIC, "styles", "kit", "room.css"), "utf8");
  for (const s of ["disc", "halo", "ring", "hollow", "line"]) assert.match(c, new RegExp(`\\.k-lamp--${s} \\{`), `${s} is drawn`);
});

test("room.js and sheet.js together stay within 14,000 bytes (D9)", () => {
  const n = ["room.js", "sheet.js"].map((f) => readFileSync(join(KIT, f)).length).reduce((a, b) => a + b, 0);
  assert.ok(n <= 14000, `${n} bytes`);
});

compositeSheetTests("room");
