import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Page, {
  NOT_KNOWN, SECTIONS, SIDES, THEMES, alarmOnly, appearanceLine, chipOf, laterLine, sectionHref, sectionOf, sideShown, statusOf,
} from "../../pages/settings.js";

const SRC = readFileSync(new URL("../../pages/settings.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/pages/settings.css", import.meta.url), "utf8");
const q = (s) => new URLSearchParams(s);

test("settings: the page is a component", () => {
  assert.equal(typeof Page, "function");
});

test("settings: three themes in order", () => {
  assert.deepEqual(THEMES.map((t) => t.id), ["auto", "light", "dark"]);
  assert.deepEqual(THEMES.map((t) => t.label), ["Auto", "Light", "Dark"]);
});

test("settings: the page names nothing it should not and holds no address", () => {
  assert.doesNotMatch(SRC, /https?:\/\//);
  assert.doesNotMatch(SRC, /innerHTML|dangerouslySetInnerHTML/);
});

test("settings: the page is a DocLayout with six sections in order, each with its line icon", () => {
  assert.match(SRC, /<\$\{DocLayout\}/);
  assert.deepEqual(SECTIONS.map((s) => s.id), ["appearance", "models", "web", "generation", "viewer", "later"]);
  assert.deepEqual(SECTIONS.map((s) => s.label), ["Appearance", "Models", "Web", "Generation", "Page viewer", "Later"]);
  assert.deepEqual(SECTIONS.map((s) => s.icon), ["sun", "chip", "globe", "film", "eye", "clock"]);
});

test("settings: Models, Web, Generation and Page viewer are each drawn by their own module, in that order", () => {
  assert.match(SRC, /import ModelsSection, \* as models from "\.\/settings-models\.js";/);
  assert.match(SRC, /import WebSection, \* as web from "\.\/settings-web\.js";/);
  assert.match(SRC, /import GenerationSection, \* as generation from "\.\/settings-generation\.js";/);
  assert.match(SRC, /import ViewerSection, \* as viewer from "\.\/settings-viewer\.js";/);
  const bodies = Object.fromEntries(SECTIONS.filter((s) => s.Body).map((s) => [s.id, s.Body.name]));
  assert.deepEqual(Object.keys(bodies), ["models", "web", "generation", "viewer"]);
  assert.deepEqual(SECTIONS.filter((s) => s.from).map((s) => s.from), ["/api/models", "/api/web", "/api/generation", "/api/viewer"]);
});

test("settings: the chosen section is in the address; no s is Appearance; the way back from Higgsfield opens Generation", () => {
  assert.equal(sectionOf(q("")), "appearance");
  assert.equal(sectionOf(undefined), "appearance");
  assert.equal(sectionOf(q("s=generation")), "generation");
  assert.equal(sectionOf(q("s=viewer")), "viewer");
  assert.equal(sectionOf(q("s=later")), "later");
  assert.equal(sectionOf(q("s=nothing")), "appearance");
  assert.equal(sectionOf(q("s=__proto__")), "appearance");
  assert.equal(sectionOf(q("generation=connected")), "generation");
  assert.equal(sectionOf(q("generation=failed")), "generation");
  assert.equal(sectionOf(q("generation=other")), "appearance");
  assert.equal(sectionOf(q("s=web&generation=failed")), "web");
  assert.equal(sectionHref("appearance"), "#/settings");
  assert.equal(sectionHref("generation"), "#/settings?s=generation");
  assert.equal(sectionHref("viewer"), "#/settings?s=viewer");
  assert.equal(sectionHref("javascript:x"), "#/settings");
});

test("settings: a section's line is what its module's statusLine says, else the plain fallback", () => {
  const fallback = { tone: "neutral", text: NOT_KNOWN };
  assert.equal(NOT_KNOWN, "Not known yet");
  assert.deepEqual(statusOf(undefined, { on: true }), fallback);
  assert.deepEqual(statusOf(() => "On", null), fallback);
  assert.deepEqual(statusOf(() => { throw new Error("x"); }, {}), fallback);
  assert.deepEqual(statusOf(() => "", {}), fallback);
  assert.deepEqual(statusOf(() => 7, {}), fallback);
  assert.deepEqual(statusOf(() => ({ tone: "good" }), {}), fallback);
  assert.deepEqual(statusOf(() => "Your Claude and Codex plans", {}), { tone: "neutral", text: "Your Claude and Codex plans" });
  assert.deepEqual(statusOf((d) => ({ tone: "good", text: d.words }), { words: "On, within your limits" }), { tone: "good", text: "On, within your limits" });
  assert.deepEqual(statusOf(() => ({ tone: "pink", text: "Off" }), {}), { tone: "neutral", text: "Off" });
  assert.equal(statusOf(() => "x".repeat(200), {}).text.length, 60);
  // Every door's line is read through statusOf from its module's export, when the module has one.
  assert.match(SRC, /statusOf\(s\.mod\.statusLine, answers\[s\.id\]\.data\)/);
});

test("settings: Appearance's line is the theme's word; Later's counts what is off", () => {
  assert.deepEqual(appearanceLine("dark"), { tone: "neutral", text: "Dark" });
  assert.deepEqual(appearanceLine("light"), { tone: "neutral", text: "Light" });
  assert.deepEqual(appearanceLine("auto"), { tone: "neutral", text: "Auto" });
  assert.deepEqual(appearanceLine("pink"), { tone: "neutral", text: "Dark" });
  assert.deepEqual(laterLine([1, 2, 3, 4, 5]), { tone: "neutral", text: "5 things, all off" });
  assert.deepEqual(laterLine([1]), { tone: "neutral", text: "1 thing, off" });
  assert.deepEqual(laterLine([]), { tone: "neutral", text: NOT_KNOWN });
  assert.deepEqual(laterLine(null), { tone: "neutral", text: NOT_KNOWN });
});

test("settings: Appearance is one panel of rows: Theme, Sidebar and Motion", () => {
  const t = SRC.indexOf('title="Theme"');
  const s = SRC.indexOf('title="Sidebar"');
  const m = SRC.indexOf('title="Motion"');
  assert.ok(t > 0 && s > t && m > s, String([t, s, m]));
  assert.match(SRC, /<\$\{Segmented\} label="Theme" items=\$\{THEMES\}/);
  assert.match(SRC, /<\$\{Segmented\} label="Sidebar" items=\$\{SIDES\}/);
  assert.match(SRC, /<\$\{Switch\} on=\$\{motion !== "off"\} label="Motion"/);
  assert.deepEqual(SIDES.map((x) => x.id), ["open", "icons", "auto"]);
  assert.deepEqual(SIDES.map((x) => x.label), ["Names", "Icons", "Automatic"]);
  // The sidebar's width is the shell's: chosen through the context's setSide, null for automatic.
  assert.match(SRC, /setSide\(id === "open" \|\| id === "icons" \? id : null\)/);
});

test("settings: the page offers neither an accent colour nor a background, and saves the theme and motion only", () => {
  for (const gone of [/SWATCHES/, /BACKDROPS/, /Accent colour/i, /accent/i, /backdrop/i, /Background/, /Moving background/, /type="radio"/]) {
    assert.doesNotMatch(SRC, gone);
  }
  const saves = SRC.match(/saveSettings\(\{[^}]*\}\)/g) || [];
  assert.deepEqual(saves, ["saveSettings({ theme, motion, ...patch })"]);
  assert.match(SRC, /change\(\{ theme: id \}\)/);
  assert.match(SRC, /change\(\{ motion: on \? "on" : "off" \}\)/);
  assert.doesNotMatch(CSS, /swatch|backdrop|data-accent/i);
});

test("settings: Later is the same rows, each switch off and unusable, with its sentence; the technical details on asking", () => {
  assert.match(SRC, /<\$\{Switch\} on=\$\{false\} disabled=\$\{true\} label=\$\{l\.label\}/);
  assert.match(SRC, /<span>\$\{l\.explain\}<\/span>/);
  assert.match(SRC, /Show technical details/);
  assert.match(SRC, /Hide technical details/);
});

test("settings: the Sidebar row shows what the owner chose (Automatic when nothing); the page never sets the width itself", () => {
  assert.equal(sideShown(null), "auto");
  assert.equal(sideShown(undefined), "auto");
  assert.equal(sideShown("open"), "open");
  assert.equal(sideShown("icons"), "icons");
  assert.equal(sideShown("pink"), "auto");
  assert.deepEqual(SIDES.map((x) => [x.id, x.label]), [["open", "Names"], ["icons", "Icons"], ["auto", "Automatic"]]);
  // The row reads sideChoice from the context, not the width that is drawn.
  assert.match(SRC, /const \{ saveSettings, setTop, sideChoice, setSide \} = app;/);
  assert.match(SRC, /sideChoice=\$\{sideShown\(sideChoice\)\}/);
  // setSide is called only from the owner's pick in the row.
  assert.equal((SRC.match(/setSide\(/g) || []).length, 1);
  assert.doesNotMatch(SRC, /localStorage|sessionStorage/);
});

test("settings: the sheet keeps to this page's own touches, and a switch in a row shows the control alone", () => {
  assert.match(CSS, /\.p-settings \.k-rows__control \.k-switch__label/);
  assert.doesNotMatch(CSS, /\.p-settings__(group|swatch|swatches|dot|themes|later|item|sub)\b/);
});

test("fix round B2: the head's chip is one or two words; the long line lives once (in the list's dot, for a screen reader and on hover)", () => {
  assert.deepEqual(chipOf({ tone: "good", text: "On, within your limits" }), { tone: "good", text: "On" });
  assert.deepEqual(chipOf({ tone: "neutral", text: "Off. No agent can reach the internet." }), { tone: "neutral", text: "Off" });
  assert.deepEqual(chipOf({ tone: "bad", text: "Over today's limit" }), null, "three words: no chip");
  assert.equal(chipOf({ tone: "neutral", text: NOT_KNOWN }), null);
  assert.deepEqual(chipOf({ tone: "neutral", text: "Your Claude and Codex plans" }, () => "Your plans", {}), { tone: "neutral", text: "Your plans" }, "a module may say its own");
  assert.deepEqual(chipOf({ tone: "good", text: "On" }, () => { throw new Error("x"); }, {}), { tone: "good", text: "On" });
  assert.match(SRC, /chipOf\(lines\[here\.id\], here\.mod\.stateWord/);
});

test("fix round R6: a state is said once: the head carries a chip only for the page's alarm, never one that repeats the switch", () => {
  assert.equal(alarmOnly({ tone: "good", text: "On" }), null);
  assert.equal(alarmOnly({ tone: "neutral", text: "Off" }), null);
  assert.deepEqual(alarmOnly({ tone: "warn", text: "Held" }), { tone: "warn", text: "Held" });
  assert.deepEqual(alarmOnly({ tone: "bad", text: "Not read" }), { tone: "bad", text: "Not read" });
  assert.equal(alarmOnly(null), null);
});

// ---- PLAN-3D-ALL U4: the room header, the wire, hostile text, whole sentences, and the door panel's imports ----

const SHAPE = (n) => JSON.parse(readFileSync(new URL(`../../../server/test/shapes/${n}.json`, import.meta.url), "utf8"));
const IDS_ALL = ["appearance", "models", "web", "generation", "viewer", "later"];
const ANSWERS = () => ({ "/api/settings": SHAPE("settings"), "/api/models": SHAPE("models"), "/api/web": SHAPE("web"), "/api/generation": SHAPE("generation"), "/api/viewer": SHAPE("viewer") });

// Mounts the page on one section with the given answers (by path, the query left off) and records every request.
async function drawPage(section, answers = ANSWERS()) {
  const DOM = await import("../kit/_dom.mjs");
  const ctx = await import("../../lib/context.js");
  DOM.installDom();
  globalThis.document.querySelector = () => null;
  globalThis.window = { location: { hash: "#/settings", pathname: "/", search: "" }, history: { state: null, replaceState() {} }, scrollTo() {} };
  const stub = DOM.stubFetch((path) => {
    const p = String(path).split("?")[0];
    return Object.hasOwn(answers, p) ? { status: 200, body: answers[p] } : { status: 200, body: {} };
  });
  const route = { query: new URLSearchParams(section === "appearance" ? "" : `s=${section}`) };
  const app = { announce() {}, setTop() {}, shell: { company: { name: "Sorrel Yard" } } };
  const root = await DOM.mount(() => DOM.html`<${ctx.AppContext.Provider} value=${app}><${Page} route=${route} /><//>`, {});
  for (let i = 0; i < 6; i += 1) await DOM.settle();
  const wire = stub.calls.map((c) => `${c.method} ${c.path}${c.body ? ` ${JSON.stringify(c.body)}` : ""}`).sort();
  return { DOM, root, wire, done: () => { DOM.unmount(root); stub.restore(); delete globalThis.window; } };
}

test("the page sends what it sent before (PLAN-3D-ALL)", async () => {
  // Recorded on the unchanged page (before U4's edit), on the shapes' answers, sorted.
  const BEFORE = {
    appearance: ["GET /api/generation", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/web"],
    models: ["GET /api/generation", "GET /api/models", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/web"],
    web: ["GET /api/generation", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/web", "GET /api/web", "GET /api/web/visits"],
    generation: ["GET /api/generation", "GET /api/generation", "GET /api/generation/ledger", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/web"],
    viewer: ["GET /api/generation", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/viewer", "GET /api/web"],
    later: ["GET /api/generation", "GET /api/models", "GET /api/settings", "GET /api/viewer", "GET /api/web"],
  };
  for (const s of IDS_ALL) {
    const m = await drawPage(s);
    try {
      assert.deepEqual(m.wire, BEFORE[s], s);
      assert.ok(!m.wire.some((w) => /\/assets\/world\/|\/vendor\/three-/.test(w)), `${s}: nothing of the world`);
    } finally { m.done(); }
  }
});

test("PLAN-3D-ALL U4: every section is under the annex's band: one h1, the section's name, above the list and the column", async () => {
  const { GLIMPSES, glimpseSrc } = await import("../../kit/room.js");
  for (const s of IDS_ALL) {
    const m = await drawPage(s);
    try {
      const { DOM, root } = m;
      const all = DOM.elements(root);
      const h1 = all.filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1, `${s}: one h1`);
      assert.equal(h1[0].getAttribute("id"), "page-title");
      assert.equal(DOM.textOf(h1[0]), SECTIONS.find((x) => x.id === s).label);
      const band = all.find((e) => e.localName === "header" && DOM.classesOf(e).includes("k-room"));
      assert.ok(band, `${s}: the room header`);
      assert.equal(band.getAttribute("data-glimpse"), "annex");
      assert.ok(DOM.elements(band).includes(h1[0]), "the title is in the band");
      // The band comes first, then the frame: the list and the column are both under it.
      const page = all.find((e) => DOM.classesOf(e).includes("p-settings"));
      assert.deepEqual(page.childNodes.filter((n) => n.nodeType === 1).map((e) => DOM.classesOf(e)[0]), ["k-room", "k-doc"]);
      assert.equal(DOM.byClass(root, "k-doc__title").length, 0, "the frame draws no title of its own");
      // The picture, when there is one, is a table key's file, hidden from readers.
      for (const img of all.filter((e) => e.localName === "img")) {
        assert.ok(GLIMPSES.some((k) => [glimpseSrc(k, { theme: "dark", width: 1280 }), glimpseSrc(k, { theme: "dark", width: 390 }), glimpseSrc(k, { theme: "light", width: 1280 }), glimpseSrc(k, { theme: "light", width: 390 })].includes(img.getAttribute("src"))));
        assert.equal(img.getAttribute("alt"), "");
        assert.equal(img.getAttribute("aria-hidden"), "true");
      }
      // The window's title is the page's, not the band's.
      assert.equal(globalThis.document.title, `Settings, ${SECTIONS.find((x) => x.id === s).label} · Sorrel Yard`);
    } finally { m.done(); }
  }
  assert.match(CSS, /\.p-settings > \.k-room \{/);
});

// Every string in an answer replaced by one of PLAN-3D's hostile set, in turn.
const HOSTILE_SET = ["<img src=x onerror=alert(1)>", "\"><script>alert(1)</script>", "javascript:alert(1)", "\");background:url(//evil.example/x)", "${7*7}", "L".repeat(5000), "‮gnp.exe"];
function hostile(v, n = { i: 0 }) {
  if (typeof v === "string") return HOSTILE_SET[n.i++ % HOSTILE_SET.length];
  if (Array.isArray(v)) return v.map((x) => hostile(x, n));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostile(x, n)]));
  return v;
}

test("PLAN-3D-ALL U4: server text is hostile and stays text in every section", async () => {
  const { glimpseSrc } = await import("../../kit/room.js");
  const bad = Object.fromEntries(Object.entries(ANSWERS()).map(([k, v]) => [k, hostile(v)]));
  for (const s of IDS_ALL) {
    const m = await drawPage(s, bad);
    try {
      const all = m.DOM.elements(m.root);
      for (const t of ["script", "iframe", "object", "embed"]) assert.equal(all.filter((e) => e.localName === t).length, 0, `${s}: no ${t}`);
      const imgs = all.filter((e) => e.localName === "img");
      assert.ok(imgs.every((e) => e.getAttribute("src") === glimpseSrc("annex", { theme: "dark", width: 1280 })), `${s}: the band's picture is the only img`);
      for (const e of all) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `${s}: no ${k} attribute`);
        for (const h of HOSTILE_SET) {
          for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${s}: no ${a} holds the answer's text`);
        }
      }
    } finally { m.done(); }
  }
});

// The sentences of the doors' modules: every one of them on the page is one whole text node, as written.
test("PLAN-3D-ALL U4: a money or safety sentence on the page is one whole text node, and no sheet cuts a sentence's box", async () => {
  const mods = {
    models: await import("../../pages/settings-models.js"),
    web: await import("../../pages/settings-web.js"),
    generation: await import("../../pages/settings-generation.js"),
    viewer: await import("../../pages/settings-viewer.js"),
  };
  const shapes = ANSWERS();
  let seen = 0;
  for (const [s, mod] of Object.entries(mods)) {
    const words = [...Object.values(mod.WORDS || {}), ...Object.values(mod.HF_WORDS || {})].filter((w) => typeof w === "string" && w.length >= 40 && /[.!?]$/.test(w));
    const m = await drawPage(s);
    try {
      const nodes = [...m.DOM.walkDom(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
      const text = nodes.join("");
      for (const w of words) {
        if (!text.includes(w)) continue;
        seen += 1;
        assert.ok(nodes.includes(w), `${s}: whole, as one text node: ${w.slice(0, 50)}`);
      }
      assert.ok(nodes.includes(mod.WORDS.intro), `${s}: its intro, whole`);
      // The view's own sentences (sentence, example, whyNot) arrive from the server and are shown as sent.
      const view = shapes[`/api/${s}`] || {};
      for (const k of ["sentence", "whyNot"]) if (typeof view[k] === "string" && view[k] && text.includes(view[k])) assert.ok(nodes.includes(view[k]), `${s}: the view's ${k}`);
    } finally { m.done(); }
  }
  assert.ok(seen >= 8, `sentences checked: ${seen}`);
  // No sheet of Settings clamps, cuts or fixes the height of a sentence's box.
  const SENTENCE = /intro|warned|__line|__lines|k-say|sentence|money|why|example|notice|__note|__answer/;
  for (const f of ["settings", "settings-generation", "settings-web", "settings-viewer", "settings-models"]) {
    const sheet = readFileSync(new URL(`../../styles/pages/${f}.css`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(sheet, /line-clamp/, f);
    for (const [, sel, body] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!SENTENCE.test(sel)) continue;
      assert.doesNotMatch(body, /overflow:\s*hidden|text-overflow|(^|[\s;])(max-)?height:/, `${f}: ${sel.trim()}`);
    }
  }
});

test("PLAN-3D-ALL U4: the exports the Map's door panel imports keep their names and values", async () => {
  const { createHash } = await import("node:crypto");
  const sum = (v) => createHash("sha256").update(typeof v === "function" ? v.toString() : JSON.stringify(v)).digest("hex").slice(0, 16);
  // Taken from the modules before U4's edit.
  const BEFORE = {
    "settings-web.js": { WORDS: "ba004ce815ea9d6e", switchLine: "0bb9ca2809a95851", blockerLines: "746191055b47be4e", plain: "6ad44b18886a2440" },
    "settings-generation.js": {
      WORDS: "d8644411989b4c00", HF_WORDS: "2a439c338b2bcd1e", CAPS: "1aeb83dedb2b0cc5", switchLine: "0bb9ca2809a95851",
      blockerLines: "113caf3af99c3bc9", hfSwitchLine: "d46364c977d9a71f", plain: "0faa9104a03766cf", spentLine: "37b3bdff3fd2c919",
      leftLine: "b5719dd393547343", capsLines: "6b6bf86e8dedde9f", pausedLine: "65c998974da9fcfe", ledgerLine: "51df56d460280a7a",
      runningLine: "c65b93b3daa5a5be",
    },
  };
  for (const [file, names] of Object.entries(BEFORE)) {
    const mod = await import(`../../pages/${file}`);
    for (const [name, was] of Object.entries(names)) assert.equal(sum(mod[name]), was, `${file} ${name}`);
  }
});
