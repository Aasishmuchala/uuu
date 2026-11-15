import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Page, {
  NOT_KNOWN, SECTIONS, SIDES, THEMES, appearanceLine, chipOf, laterLine, sectionHref, sectionOf, sideShown, statusOf,
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
