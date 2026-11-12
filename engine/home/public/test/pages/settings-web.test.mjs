// The Web section of Settings (PLAN-V5 K11, T35), its two placeholders, and "Fine to share with the Researcher" in
// Files: the pure helpers, a case per state of K11, and what the sources never do with a key or with a visit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Section, {
  DOOR, HOST_PATTERN, LISTS, MAX_HOSTS, PROBLEMS, WHY, WORDS, addHosts, blockerLines, doorState, doorWord, entriesOf, hostCheck,
  mergeVisits, plain, problemLine, refusedLine, searchDownLine, sectionState, sharedLine, shortAddress, switchLine, testMark,
  testRows, todayFigures, visitResult, visitText,
} from "../../pages/settings-web.js";
import Generation from "../../pages/settings-generation.js";
import Viewer from "../../pages/settings-viewer.js";
import * as files from "../../pages/files.js";

// The same checks as pages.test.mjs, kept here so that file's tests do not run twice.
const stripJsComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
const importsOf = (src) => [...stripJsComments(src).matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
const hostsIn = (t) => [...String(t).matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)].map((m) => m[0]);

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "settings-web.js"), "utf8");
const FILES_SRC = readFileSync(join(PUBLIC, "pages", "files.js"), "utf8");
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const WEB = JSON.parse(readFileSync(join(SHAPES, "web.json"), "utf8"));
const AT = "2026-11-12T10:00:00.000Z";
// Addresses are built from parts, so this file names no host (test/static.test.mjs).
const HTTPS = "https:" + "//";
const HTTP = "http:" + "//";
const view = (over = {}) => ({ ...WEB, ...over });

test("web: the section and the two placeholders are components; the placeholders draw nothing", () => {
  assert.equal(typeof Section, "function");
  assert.equal(Generation(), null);
  assert.equal(Viewer(), null);
});

test("web: K11's sentences are used as written", () => {
  assert.equal(WORDS.title, "Web");
  assert.equal(WORDS.intro, "One agent, the Researcher, can read public web pages and watch videos through the web door. No other agent can reach the internet.");
  assert.equal(WORDS.leaves, "When this is on, the addresses the Researcher opens and the words it searches for leave this Mac. It can read only its own task and what you mark as fine to share. What it brings back is treated as reference, never as instructions.");
  assert.equal(WORDS.switchLabel, "Let the Researcher use the web");
  assert.equal(WORDS.off, "Off. No agent can reach the internet.");
  assert.equal(WORDS.on, "On. Every address it opens is listed below.");
  assert.equal(WORDS.doorOff, "The web door is off. Run: engine start");
  assert.equal(WORDS.searchDown, "Search is not answering. Reading a page by its address still works.");
  assert.equal(WORDS.noVisits, "Nothing has been opened yet.");
  assert.deepEqual(LISTS.map((l) => l.label), ["Only these sites (leave empty for any public site)", "Never these sites", "Video sites it may watch"]);
  assert.deepEqual(LISTS.map((l) => l.key), ["allow", "block", "watchHosts"]);
  assert.equal(WORDS.keyless, "Search without an account (may stop working)");
  assert.equal(WORDS.brave, "Search with a Brave key");
  assert.equal(WORDS.keyField, "Search key");
  assert.equal(WORDS.test, "Test");
  assert.equal(WORDS.save, "Save");
  assert.equal(WORDS.restart, "This section appears after the home screen is restarted: engine stop, then engine start.");
  for (const w of ["What it may open", "Search", "What it has opened", "Show older", "Remove key"]) assert.ok(SRC.includes(w), w);
});

test("web: the restart line drawn on screen says the plan's sentence", () => {
  const m = /function RestartLine\(\) \{\s*return html`([\s\S]*?)`;/.exec(SRC);
  assert.ok(m);
  assert.equal(m[1].replace(/<[^>]+>/g, ""), WORDS.restart);
});

test("web: state to sentence, a case per state (off, on, door off, not installed, not answering, search down, no visits)", () => {
  // Off and on.
  assert.equal(switchLine(false), "Off. No agent can reach the internet.");
  assert.equal(switchLine(true), "On. Every address it opens is listed below.");
  // The door.
  assert.equal(doorState({ state: "on" }).sentence, "The web door is running.");
  assert.equal(doorState({ state: "off" }).sentence, "The web door is off. Run: engine start");
  assert.equal(doorState({ state: "not_installed" }).sentence, "The web door is not installed yet.");
  assert.equal(doorState({ state: "unhealthy" }).sentence, "The web door is running but not answering. Run: engine stop, then engine start.");
  assert.equal(doorState({ state: "made up" }).state, "off");
  assert.equal(doorState(null).state, "off");
  assert.equal(doorState({ state: "on" }).tone, "ok");
  assert.equal(doorState({ state: "unhealthy" }).tone, "warn");
  for (const s of Object.keys(DOOR)) assert.ok(DOOR[s].word && DOOR[s].sentence, s);
  // The word under the drawn door.
  assert.equal(doorWord(true, { state: "on" }), "Open");
  assert.equal(doorWord(false, { state: "on" }), "Closed");
  assert.equal(doorWord(true, { state: "off" }), "Off");
  assert.equal(doorWord(false, { state: "not_installed" }), "Not installed");
  // Search down: only when the last test says so.
  const down = { at: AT, fetch: { ok: true }, search: { ok: false, code: "web_search_down" } };
  assert.equal(searchDownLine(view({ lastTest: down })), "Search is not answering. Reading a page by its address still works.");
  assert.equal(searchDownLine(view({ lastTest: { ...down, search: { ok: true, results: 3 } } })), "");
  assert.equal(searchDownLine(view({ lastTest: null })), "");
  assert.equal(searchDownLine(null), "");
  // No visits.
  assert.equal(WORDS.noVisits, "Nothing has been opened yet.");
});

test("web: why the switch cannot be turned on, in the server's order", () => {
  assert.deepEqual(blockerLines(view({ blockers: ["no_researcher"] })), ["The Researcher is not set up yet. Run: engine setup"]);
  assert.deepEqual(blockerLines(view({ blockers: ["door_off"], door: { state: "off" } })), ["The web door is off. Run: engine start"]);
  // Today's live state: the door not installed and the Researcher not set up.
  assert.deepEqual(blockerLines(view({ blockers: ["no_researcher", "door_off"], door: { state: "not_installed" } })),
    ["The Researcher is not set up yet. Run: engine setup", "The web door is not installed yet."]);
  assert.deepEqual(blockerLines(view({ blockers: ["door_off"], door: { state: "unhealthy" } })),
    ["The web door is running but not answering. Run: engine stop, then engine start."]);
  assert.deepEqual(blockerLines(view({ blockers: ["something new"], canSwitchOn: false })), ["The web cannot be switched on yet."]);
  assert.deepEqual(blockerLines(view({ blockers: [], canSwitchOn: true })), []);
  assert.deepEqual(blockerLines(null), []);
});

test("web: the host chip check takes a site's name, and refuses anything else with one sentence", () => {
  const src = readFileSync(join(PUBLIC, "..", "..", "web", "address.mjs"), "utf8");
  const row8 = /export const HOST_RE = (\/.*\/);/.exec(src);
  assert.ok(row8, "engine/web/address.mjs has K11 row 8's pattern");
  assert.equal(String(HOST_PATTERN), row8[1], "the page checks with the door's own pattern");
  assert.deepEqual(hostCheck("example.com"), { host: "example.com", refused: "" });
  assert.equal(hostCheck("  Example.COM ").host, "example.com");
  assert.equal(hostCheck("*.example.com").host, "example.com");
  assert.equal(hostCheck(".example.com").host, "example.com");
  assert.equal(hostCheck("example.com.").host, "example.com");
  assert.equal(hostCheck(`${HTTPS}www.example.com/a/b?c=d#e`).host, "www.example.com");
  assert.equal(hostCheck(`${HTTP}user:secret@example.org:8080/x`).host, "example.org");
  assert.equal(hostCheck("example.net/about").host, "example.net");
  assert.equal(hostCheck("sub-1.a-b.example.co.uk").host, "sub-1.a-b.example.co.uk");
  for (const bad of ["exa mple", "localhost", "127.0.0.1", "http://[::1]/", "javascript:alert(1)", "<b>x</b>.com", "-a.com", "a..com",
    "a.c", `${"a".repeat(64)}.com`, "exämple.com", "file:///etc/passwd", "example"]) {
    const c = hostCheck(bad);
    assert.equal(c.host, null, bad);
    assert.ok(c.refused.endsWith(" is not a site name."), bad);
  }
  assert.equal(hostCheck("exa mple").refused, "\"exa mple\" is not a site name.", "the server's own words for a bad host");
  assert.equal(refusedLine("a\u0000b\u202ec"), "\"abc\" is not a site name.", "control and direction characters are taken out");
  assert.deepEqual(hostCheck(""), { host: null, refused: "" });
  assert.deepEqual(hostCheck(null), { host: null, refused: "" });
});

test("web: typed or pasted names become entries, new ones only, at most 200", () => {
  assert.deepEqual(entriesOf("a.com, b.com;c.com\nd.com"), ["a.com", "b.com", "c.com", "d.com"]);
  assert.deepEqual(entriesOf("a.com b.com"), ["a.com", "b.com"]);
  assert.deepEqual(entriesOf("exa mple"), ["exa mple"]);
  assert.deepEqual(entriesOf(" , ;"), []);
  assert.deepEqual(addHosts(["a.com"], "A.com, b.com, exa mple"), { list: ["a.com", "b.com"], refused: ["exa mple"], full: false });
  const many = Array.from({ length: MAX_HOSTS }, (_, i) => `s${i}.example.com`);
  assert.deepEqual(addHosts(many, "one.example.com"), { list: many, refused: [], full: true });
  assert.deepEqual(addHosts(null, "x.example.com").list, ["x.example.com"]);
});

test("web: an address is plain text, cut in the middle when long", () => {
  assert.equal(shortAddress(`${HTTPS}example.com/`), "example.com/");
  assert.equal(shortAddress(`${HTTP}example.com/`), `${HTTP}example.com/`, `only ${HTTPS} is left out`);
  const long = `${HTTPS}journal.example.org/2026/11/courtyard-houses-of-hyderabad-and-the-light-that-falls-into-them?ref=newsletter&part=2`;
  const cut = shortAddress(long, 40);
  assert.equal([...cut].length, 40);
  assert.ok(cut.startsWith("journal.example.org/"), cut);
  assert.ok(cut.endsWith("part=2"), cut);
  assert.equal((cut.match(/…/g) || []).length, 1);
  assert.equal(shortAddress(`${HTTPS}example.com/?q=<img src=x onerror=alert(1)>`, 200), "example.com/?q=<img src=x onerror=alert(1)>", "markup stays text");
  assert.equal(shortAddress(`${HTTPS}a.example.com/\u0007x\u200b`), "a.example.com/x");
  assert.equal(shortAddress(null), "");
  assert.equal(plain("x".repeat(3000), 1024).length, 1024);
});

test("web: a visit's result in one word, with its reason", () => {
  const v = (over) => ({ at: AT, kind: "fetch", slug: "researcher", url: `${HTTPS}example.com/`, status: 200, code: null, result: "ok", bytes: 10, ...over });
  assert.deepEqual(visitResult(v({})), { word: "Opened", tone: "ok", why: "" });
  assert.equal(visitResult(v({ kind: "search" })).word, "Searched");
  assert.equal(visitResult(v({ kind: "watch" })).word, "Watched");
  assert.deepEqual(visitResult(v({ status: 404, result: "site_error" })), { word: "Error", tone: "warn", why: "The site answered 404." });
  assert.equal(visitResult(v({ status: null, code: "web_unreachable", result: "unreachable" })).word, "Unreachable");
  assert.deepEqual(visitResult(v({ status: null, code: "web_blocked", result: "refused" })), { word: "Refused", tone: "bad", why: WHY.web_blocked });
  assert.equal(visitResult(v({ status: null, code: "web_private_address", result: "refused" })).why, "It led to this Mac or a private network.");
  assert.equal(visitResult(v({ kind: "search", status: null, code: "web_search_down", result: "refused" })).word, "Failed");
  assert.equal(visitResult(v({ status: null, code: "web_new_thing", result: "refused" })).why, "The web door refused it.");
  for (const r of [visitResult(null), visitResult({})]) assert.equal(r.word, "Refused");
  for (const k of ["fetch", "search", "watch"]) assert.equal(visitResult(v({ kind: k })).word.split(" ").length, 1, "one word");
  assert.equal(visitText(v({ kind: "search", url: "courtyard <b>plans</b>" })), "\"courtyard <b>plans</b>\"");
  assert.equal(visitText(v({ url: `${HTTPS}example.com/a` })), `${HTTPS}example.com/a`);
});

test("web: pages of visits are one list, newest first, each once", () => {
  const a = { at: "2026-11-12T10:00:02.000Z", kind: "fetch", url: `${HTTPS}a.example.com/`, status: 200, code: null };
  const b = { at: "2026-11-12T10:00:01.000Z", kind: "search", url: "plans", status: 200, code: null };
  const c = { at: "2026-11-12T09:00:00.000Z", kind: "fetch", url: `${HTTPS}c.example.com/`, status: null, code: "web_blocked" };
  assert.deepEqual(mergeVisits([b, a], [a, c, null, { at: "not a time" }, 4]), [a, b, c]);
  assert.deepEqual(mergeVisits(null, undefined), []);
});

test("web: today's counts beside the caps", () => {
  const f = todayFigures(view({ today: { fetches: 7, searches: 2, watches: 1, refused: 3, lastAt: AT }, caps: { perHour: 60, perDay: 300 } }));
  assert.equal(f.used, 10);
  assert.equal(f.line, "10 of 300 today");
  assert.equal(f.caps, "At most 60 an hour and 300 a day.");
  assert.deepEqual([f.pages, f.searches, f.videos, f.refused], [7, 2, 1, 3]);
  assert.equal(todayFigures(null).line, "0 today");
  assert.equal(todayFigures(view({ today: { fetches: -4, searches: "x" } })).used, 0);
});

test("web: the test's result in words", () => {
  assert.deepEqual(testMark(null), { tone: "off", word: "Not tested yet" });
  const works = { at: AT, fetch: { ok: true, sentence: "Reading a page worked." }, search: { ok: true, results: 3, sentence: "Search without an account worked." } };
  assert.equal(testMark(works).word, "Works");
  assert.deepEqual(testRows(works).map((r) => r.text), ["Reading a page worked.", "Search without an account worked."]);
  const down = { ...works, search: { ok: false, sentence: "Search is not answering. Reading a page by its address still works." } };
  assert.equal(testMark(down).word, "Search is down");
  assert.deepEqual(testRows(down).map((r) => r.tone), ["ok", "warn"]);
  const none = { at: AT, fetch: { ok: false }, search: { ok: false } };
  assert.equal(testMark(none).word, "Not working");
  assert.deepEqual(testRows(none).map((r) => r.text), ["Reading a page did not work.", WORDS.searchDown]);
  assert.deepEqual(testRows(undefined), []);
});

test("web: a damaged settings file, in the server's words first", () => {
  assert.equal(problemLine(view({ problem: "state_unreadable", problemSentence: "From the server." })), "From the server.");
  assert.equal(problemLine(view({ problem: "state_unreadable", problemSentence: null })), PROBLEMS.state_unreadable);
  assert.ok(problemLine(view({ problem: "new_problem", problemSentence: null })).length > 0);
  assert.equal(problemLine(view({ problem: null })), "");
  assert.equal(problemLine(null), "");
});

test("web: loading, ready, an error, and the routes not there yet", () => {
  assert.equal(sectionState({ loading: true }), "loading");
  assert.equal(sectionState({ data: {} }), "ready");
  assert.equal(sectionState({ error: { status: 404 } }), "restart");
  assert.equal(sectionState({ error: { status: 0 } }), "error");
});

test("web: the search key goes nowhere but the one POST", () => {
  const code = stripJsComments(SRC);
  for (const bad of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /\bhistory\./, /location\./, /\bconsole\./, /caches\./]) {
    assert.doesNotMatch(code, bad, `settings-web.js does not use ${bad}`);
  }
  assert.match(code, /type="password" name="search-key" autocomplete="off"/);
  // The field is only ever filled by the owner's typing, and emptied after Save.
  assert.match(code, /value=\$\{typed\}/);
  assert.match(code, /if \(ok\) setTyped\(""\)/);
  assert.doesNotMatch(code, /setTyped\((?!""|e\.currentTarget\.value)/);
  assert.match(code, /api\.post\(path, body\)/);
  assert.match(code, /"\/api\/web\/search-key", \{ key: typed \}/);
  const page = stripJsComments(readFileSync(join(PUBLIC, "pages", "settings.js"), "utf8"));
  for (const bad of [/localStorage/, /sessionStorage/, /\bconsole\./]) assert.doesNotMatch(page, bad);
});

test("web: nothing from a visit, a list or a shared file is ever set as HTML", () => {
  for (const [name, src] of [["settings-web.js", SRC], ["files.js", FILES_SRC]]) {
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/, name);
  }
});

test("web: imports stay inside public, use the kit through kit/index.js, and name no host", () => {
  for (const file of ["settings-web.js", "settings-generation.js", "settings-viewer.js"]) {
    const src = readFileSync(join(PUBLIC, "pages", file), "utf8");
    for (const spec of importsOf(src)) {
      assert.ok(spec.startsWith("../"), `${file}: ${spec}`);
      assert.ok(!spec.includes("/kit/") || spec === "../kit/index.js", `${file}: ${spec}`);
    }
    assert.deepEqual(hostsIn(stripJsComments(src)), [], file);
  }
});

// Files: "Fine to share with the Researcher" on a text or table file, and the list of what is shared.
test("files: the share switch, its words, and which files can be shared", () => {
  assert.equal(files.SHARE_WORDS.label, "Fine to share with the Researcher");
  assert.equal(files.canShare({ kind: "text" }), true);
  assert.equal(files.canShare({ kind: "table" }), true);
  for (const kind of ["image", "pdf", "html", undefined]) assert.equal(files.canShare({ kind }), false, String(kind));
  assert.equal(files.canShare(null), false);
  assert.match(FILES_SRC, /<\$\{ShareSwitch\} file=\$\{file\} \/>/, "the switch sits in a file's panel");
  assert.match(FILES_SRC, /api\.post\("\/api\/web\/share", \{ token: file\.token, share: next \}\)/);
});

test("files: \"Shared with the Researcher: <n> files\" leads to the list of them", () => {
  assert.equal(files.sharedLine(0), "Shared with the Researcher: 0 files");
  assert.equal(files.sharedLine(1), "Shared with the Researcher: 1 file");
  assert.equal(files.sharedLine(3), "Shared with the Researcher: 3 files");
  assert.equal(sharedLine(2), files.sharedLine(2), "Settings says the same as Files");
  assert.equal(files.filesHref({ shared: true }), "#/files?shared=1");
  assert.equal(files.filesHref({ shared: true, file: "YQ" }), "#/files?file=YQ&shared=1");
  assert.equal(files.filesHref({ shared: true, folder: "brand" }), "#/files/brand", "a folder is never the shared list");
  assert.equal(files.filesHref({ shared: "yes" }), "#/files");
});

test("files: the shared list from the web view, each file leading where it should", () => {
  const brainToken = "cHJpY2luZy9zZXJ2aWNlcy5tZA";
  const v = view({
    shared: [
      { name: "brand-public.md", size: 300, source: "brand-kit", path: null, token: null, title: "The brand's public summary" },
      { name: "services.md", size: 120, source: "brain", path: "pricing/services.md", token: brainToken, title: "services.md" },
      { name: "odd.txt", size: 5, source: "other", path: null, token: null, title: "odd.txt" },
      { name: "x", source: "made up" }, null, "text",
    ],
  });
  assert.deepEqual(files.sharedFiles(v).map((f) => f.name), ["brand-public.md", "services.md", "odd.txt"]);
  assert.equal(files.sharedFiles(WEB).length, 1, "the shape's own example");
  assert.equal(files.isShared(v, brainToken), true);
  assert.equal(files.isShared(v, "b3RoZXI"), false);
  assert.equal(files.isShared(v, ""), false);
  assert.equal(files.isShared(null, brainToken), false);
  const [kit, mine, other] = files.sharedFiles(v);
  assert.equal(files.sharedHref(kit), "#/files/brand-kit");
  assert.equal(files.sharedHref(mine), `#/files?file=${brainToken}&shared=1`);
  assert.equal(files.sharedHref(other), null);
  assert.equal(files.sharedHref({ source: "brain", token: "../x" }), null);
});
