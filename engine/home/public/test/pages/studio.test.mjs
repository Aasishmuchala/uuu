// The Studio dashboard (CONTRACTS-V3 30, 37.3, 37.4): the sprite helpers kept from version 2, and the pure
// helpers of the videos, the carousels and the room, tried on the server's pinned shapes and on hostile input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const studio = await import("../../pages/studio.js");
const { thumbStyle, checkLine, studioHref, safeApi, videoWords, videoChecks, slideChecks, playable, motionNotices, studioFigures, problemsOf, roomRows } = studio;
const { filmClips, filmStill, filmCard, offSwitches, OFF_WORDS, jumpsOf } = studio;
const SRC = readFileSync(join(TREE, "pages", "studio.js"), "utf8");

// The shapes of the home server's tests, found by walking up from this tree.
function shape(name) {
  for (let d = TREE; d !== dirname(d); d = dirname(d)) {
    const f = join(d, "server", "test", "shapes", `${name}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
}

// Another host, built from parts so this file itself names none.
const AWAY = ["https:", "", ["elsewhere", "example"].join(".")].join("/");

const sprite = { frames: 4, frameSize: { w: 16, h: 16 }, sheet: { viewUrl: "/api/view/abc" } };

test("thumbStyle scales the first frame by a whole number and uses the sheet as a pixelated background", () => {
  const s = thumbStyle(sprite, 64);
  assert.match(s, /width:64px/);
  assert.match(s, /height:64px/);
  assert.match(s, /background-size:256px 64px/);
  assert.match(s, /background-position:0 0/);
  assert.match(s, /image-rendering:pixelated/);
  assert.match(s, /url\("\/api\/view\/abc"\)/);
});

test("thumbStyle shrinks a large frame and survives missing data", () => {
  const big = thumbStyle({ frames: 2, frameSize: { w: 128, h: 64 }, sheet: { viewUrl: "/api/view/x" } }, 64);
  assert.match(big, /width:64px/);
  assert.match(big, /height:32px/);
  assert.match(big, /background-size:128px 32px/);
  assert.match(thumbStyle(null, 64), /background-image:none/);
  assert.doesNotMatch(thumbStyle({ ...sprite, sheet: { viewUrl: '/a")b' } }, 64), /"\)b/);
});

test("checkLine words the result in plain terms", () => {
  assert.deepEqual(checkLine({ ok: true }), { ok: true, text: "Frames match the tags" });
  assert.deepEqual(checkLine({ ok: false }), { ok: false, text: "The frames and the tags do not match" });
  assert.equal(checkLine(null).ok, false);
});

test("studio: every open thing is in the address", () => {
  assert.equal(studioHref(), "#/dashboards/studio");
  assert.equal(studioHref({ sprite: "STH-8/walker" }), "#/dashboards/studio?sprite=STH-8%2Fwalker");
  assert.equal(studioHref({ video: "STH-25/title" }), "#/dashboards/studio?video=STH-25%2Ftitle");
  assert.equal(studioHref({ slides: "STH-24/launch" }), "#/dashboards/studio?slides=STH-24%2Flaunch");
  assert.equal(studioHref({ video: "a&b=c#/x" }), "#/dashboards/studio?video=a%26b%3Dc%23%2Fx");
  assert.equal(studioHref({ film: "e0000000-0000-4000-8000-000000000041" }), "#/dashboards/studio?film=e0000000-0000-4000-8000-000000000041");
  assert.equal(studioHref({ video: 7 }), "#/dashboards/studio");
  const q = new URLSearchParams(studioHref({ video: "STH-25/title" }).split("?")[1]);
  assert.equal(q.get("video"), "STH-25/title");
});

test("studio: only the home server's own addresses reach a picture, a video or a download", () => {
  assert.equal(safeApi("/api/view/U1RILTI1"), "/api/view/U1RILTI1");
  for (const bad of [`${AWAY}/x.mp4`, AWAY.slice(6) + "/x", "javascript:alert(1)", "/api//x", "/files/x", '/api/view/a"onerror', "/api/view/a b", "/api/view/a)", null, 5, `/api/${"a".repeat(3000)}`]) {
    assert.equal(safeApi(bad), null, String(bad).slice(0, 40));
  }
});

test("studio: a video's size and length in words, from the pinned shape", () => {
  const v = shape("studio-videos").videos[0];
  assert.equal(videoWords(v), "1920 by 1080, 8 s, 30 frames a second, 412 bytes");
  assert.equal(videoWords({ ...v, video: { size: 1258291 } }), "1920 by 1080, 8 s, 30 frames a second, 1.2 MB");
  assert.equal(videoWords({ seconds: 0.4 }), "under a second");
  assert.equal(videoWords({ seconds: 75 }), "75 s");
  // One decimal, as the manifest now has it (M63): 11.5 is not 12.
  assert.equal(videoWords({ seconds: 11.5 }), "11.5 s");
  assert.equal(videoWords({ seconds: 19.94 }), "19.9 s");
  assert.equal(videoWords({ seconds: 12 }), "12 s");
  // Numbers that are not whole or outside the helper's limits are left out.
  assert.equal(videoWords({ width: 1920.5, height: 1080, seconds: 9999, fps: 240 }), "");
  assert.equal(videoWords({ width: "1920", height: 1080, fps: -1, seconds: "x" }), "");
  assert.equal(videoWords(null), "");
});

test("studio: the server's checks of a video and of a slide set read as plain lines", () => {
  const good = videoChecks({ isMp4: true, underLimit: true, posterMatches: true, ok: true });
  assert.deepEqual(good.map((l) => l.ok), [true, true, true]);
  assert.deepEqual(good.map((l) => l.text), ["It is a video file", "Small enough to play here", "The cover picture matches its size"]);
  const bad = videoChecks(null);
  assert.deepEqual(bad.map((l) => l.ok), [false, false, false]);
  assert.equal(bad[1].text, "Too large to play here");
  assert.deepEqual(slideChecks({ sizesMatch: true, countMatches: false }).map((l) => [l.ok, l.text]), [
    [true, "Every slide is the same size"], [false, "Some slides are missing"],
  ]);
  for (const l of [...good, ...bad, ...slideChecks({})]) assert.doesNotMatch(l.text, /mp4|png|ftyp|byte/i);
});

test("studio: a video plays only when its bytes were checked and its address is the server's", () => {
  const v = shape("studio-videos").videos[0];
  assert.equal(playable(v), true);
  assert.equal(playable({ ...v, checks: { ...v.checks, isMp4: false } }), false);
  assert.equal(playable({ ...v, checks: { ...v.checks, underLimit: false } }), false);
  assert.equal(playable({ ...v, video: { ...v.video, viewUrl: `${AWAY}/v.mp4` } }), false);
  assert.equal(playable({ ...v, video: { ...v.video, viewUrl: null } }), false);
  assert.equal(playable(null), false);
});

test("studio: the not-connected lines use the pinned sentences, or the server's own", () => {
  const slides = shape("studio-slides");
  const videos = shape("studio-videos");
  assert.deepEqual(motionNotices(slides, videos), []);
  assert.deepEqual(motionNotices(null, null), []);
  const off = motionNotices({ ...slides, installed: false }, { ...videos, installed: false, speech: false }).map((n) => n.reason);
  assert.deepEqual(off, [
    "The Artist's slide tool is not installed yet.",
    "The Artist's video tool is not installed yet.",
    "The speech model is not in place yet.",
  ]);
  const own = motionNotices(null, { installed: false, notConnected: { reason: "R".repeat(900), next: "Open Health." } });
  assert.equal(own.length, 1);
  assert.equal(own[0].reason.length, 300);
  assert.equal(own[0].next, "Open Health.");
  for (const n of motionNotices({ installed: false }, { installed: false, speech: false })) assert.ok(n.next.length > 0);
});

test("studio: the stat tiles count what the Studio holds, then the department's figures", () => {
  const f = studioFigures({
    art: { sprites: [{}, {}] }, slides: shape("studio-slides"), videos: shape("studio-videos"),
    dept: { figures: [{ id: "cad", label: "CAD parts", value: "1", hint: "STEP files" }] },
  });
  assert.deepEqual(f.map((x) => [x.label, x.value]), [["Videos", "1"], ["Carousels", "1"], ["Sprites", "2"], ["CAD parts", "1"]]);
  // A list the server could not give is left out, not counted as nought.
  assert.deepEqual(studioFigures({}).map((x) => x.id), []);
  assert.deepEqual(studioFigures({ videos: { videos: [] } }).map((x) => x.value), ["0"]);
});

test("studio: files that could not be used come from all three lists, capped and as text", () => {
  const p = problemsOf(
    { problems: [{ goal: "STH-8", name: "walker", problem: "The sheet is missing." }] },
    { problems: [{ goal: "STH-24", name: "../x", problem: "x".repeat(1000) }, "not an object"] },
    { problems: Array.from({ length: 80 }, (_, i) => ({ goal: "STH-25", name: `v${i}`, problem: "<b>bad</b>" })) },
    null,
  );
  assert.equal(p[0].name, "STH-8 / walker");
  assert.equal(p[0].problem, "The sheet is missing.");
  assert.equal(p[1].name, "STH-24 / ../x");
  assert.equal(p[1].problem.length, 300);
  assert.equal(p.length, 52, "two, then at most 50 from one list");
  assert.equal(p[2].problem, "<b>bad</b>", "kept as text; the page renders it as text");
});

test("studio: the room lists names and sizes in words, only of the pinned endings", () => {
  const rows = roomRows({ files: [
    { name: "site-visit.mp4", size: 2048, changed: "12 Nov 2026" },
    { name: "voice.M4A", size: 1, changed: "12 Nov 2026" },
    { name: "notes.txt", size: 10 },
    { name: "link.mp4", size: 3 },
    { size: 5 },
    null,
  ], path: "/Users/x/state/media/room" });
  assert.deepEqual(rows.map((r) => [r.name, r.size]), [["site-visit.mp4", "2.0 KB"], ["voice.M4A", "1 byte"], ["link.mp4", "3 bytes"]]);
  assert.deepEqual(roomRows(null), []);
  assert.equal(roomRows({ files: Array.from({ length: 500 }, (_, i) => ({ name: `c${i}.mov`, size: 1 })) }).length, 200);
});

test("studio: the page plays a video in the kit's player, keeps the pinned room line, and renders agents' words as text", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  // The video opened in place is the kit's Player, given only an address that passed safeApi through playable.
  assert.match(code, /<\$\{Player\} src=\$\{src \|\| undefined\}/);
  assert.match(code, /const src = playable\(video\) \? safeApi\(video\.video\.viewUrl\) : null;/);
  assert.doesNotMatch(code, /<video\b/, "no video element of the page's own");
  assert.match(code, /<details class="p-studio__where">\s*<summary class="p-studio__where-line">Where is this folder\?<\/summary>/);
  for (const url of ["/api/studio/art", "/api/departments/studio", "/api/studio/slides", "/api/studio/videos", "/api/studio/room"]) {
    assert.ok(code.includes(`"${url}", { every: EVERY }`), `${url} refreshes`);
  }
  assert.match(code, /const EVERY = 10000;/);
  assert.match(code, /query\.get\("video"\)/);
  assert.match(code, /query\.get\("slides"\)/);
  assert.match(code, /openPanel\(/);
  assert.match(code, /back=\$\{\{ label: "All dashboards", href: "#\/dashboards" \}\}/);
  // The closing link is the dashboards' shared one (M51 F20), with Jobs to start before it.
  assert.match(code, /<\$\{OpenDepartment\} dept="studio" \/>/);
  assert.match(code, /<\$\{Jobs\} dept="studio" \/>/);
  assert.doesNotMatch(code, /innerHTML|dangerouslySetInnerHTML|\beval\(|new Function/);
  assert.doesNotMatch(code, /#\/studio\b/, "uses the new address, not the old #/studio");
  assert.doesNotMatch(code, /\/api\/gallery/, "the gallery route goes at the switch");
});

test("studio: the video's box is never more than twice its own size nor 60% of the window (M51 F14)", async () => {
  const m = await import("../../pages/studio.js");
  assert.equal(m.videoBox({ width: 320, height: 180 }), "aspect-ratio:320 / 180;max-width:min(100%, 640px);max-height:min(60vh, 360px)");
  assert.equal(m.videoBox({ width: "320", height: 180 }), "", "only whole numbers inside the helper's limits");
  assert.equal(m.videoBox(null), "");
});

test("studio: the room's times read as the other pages' do, not as a machine time (M51 F10)", async () => {
  const m = await import("../../pages/studio.js");
  const [row] = m.roomRows({ files: [{ name: "clip.mp4", size: 10, changed: "2026-11-11T18:31:30.839Z" }] });
  assert.ok(!/T\d\d:/.test(row.changed), row.changed);
  assert.ok(row.changed.length > 0);
});

test("studio: a film's card says how many shots have a clip of how many, and how many are kept", () => {
  assert.equal(filmClips(2, 3, 2), "2 of 3 clips, 2 kept");
  assert.equal(filmClips(1, 1, 0), "1 of 1 clip, 0 kept");
  assert.equal(filmClips(5, 3, 1), "3 of 3 clips, 1 kept", "never more clips than shots");
  // Without the film's shots, the Films list's own words.
  assert.equal(filmClips(3, null, 2), "3 clips made, 2 kept");
  assert.equal(filmClips("x", 0, -1), "0 clips made, 0 kept");
});

test("studio: a film's first still is the first shot's newest take with stills, else its storyboard, and only the server's own", () => {
  const shot = (takes, board = "/api/view/board-1") => ({ board, takes });
  assert.equal(filmStill({ shots: [shot([{ stills: ["/api/view/s1"] }, { stills: ["/api/view/s2", "/api/view/s3"] }])] }), "/api/view/s2");
  assert.equal(filmStill({ shots: [shot([{ stills: ["/api/view/s1"] }, { state: "making" }])] }), "/api/view/s1");
  assert.equal(filmStill({ shots: [shot([])] }), "/api/view/board-1");
  assert.equal(filmStill({ shots: [shot([{ stills: [`${AWAY}/x.png`] }], `${AWAY}/b.png`)] }), "", "another host never reaches the card");
  assert.equal(filmStill({ shots: [shot([], "javascript:alert(1)")] }), "");
  assert.equal(filmStill(null), "");
  assert.equal(filmStill({ shots: "x" }), "");
});

test("studio: a film's card shows the server's figures, its state and its problem, and opens the film", () => {
  const row = { task: { id: "e0000000-0000-4000-8000-000000000041", identifier: "STH-41", title: "A film of the lake house" },
    budget: 220, spent: 110, clips: 2, kept: 2, state: "making", problem: null };
  const detail = { shots: [
    { board: "/api/view/b1", takes: [{ state: "made", stills: ["/api/view/s1"] }] },
    { takes: [{ state: "made" }, { state: "making" }] },
    { takes: [{ state: "making" }] },
  ] };
  const c = filmCard(row, detail);
  assert.equal(c.href, "#/dashboards/studio?film=e0000000-0000-4000-8000-000000000041");
  assert.equal(c.title, "A film of the lake house");
  assert.equal(c.ident, "STH-41");
  assert.equal(c.still, "/api/view/s1");
  assert.equal(c.clips, "2 of 3 clips, 2 kept");
  assert.equal(c.money, "$1.10 of $2.20");
  assert.equal(c.share, 50);
  assert.deepEqual(c.state, { tone: "neutral", icon: "clock", text: "Being made" });
  // Before the film itself has come in: no picture yet, and the list's own words.
  const bare = filmCard(row, null);
  assert.equal(bare.still, "");
  assert.equal(bare.clips, "2 clips made, 2 kept");
  assert.deepEqual(filmCard({ ...row, state: "done" }).state, { tone: "good", icon: undefined, text: "Done" });
  assert.equal(filmCard({ ...row, state: "needs you", problem: "P".repeat(900) }).problem.length, 300);
  assert.equal(filmCard({ ...row, spent: null }).money, "Spent so far not known, of $2.20");
  assert.equal(filmCard(null).href, "#/dashboards/studio");
  assert.equal(filmCard(null).title, "A film");
});

test("studio: each switch that is off is one line, the doors with the way to their own section of Settings", () => {
  const rows = offSwitches({ generation: { on: false }, viewer: { on: true }, web: { on: false },
    dept: { switches: [{ id: "renderer", label: "Show parts in 3D", on: false, explain: "E".repeat(500) }, { id: "x", label: "On", on: true }] } });
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.href]), [
    ["generation", "Generation", "#/settings?s=generation"],
    ["web", "Web", "#/settings?s=web"],
    ["dept-renderer", "Show parts in 3D", null],
  ]);
  assert.equal(rows[2].say.length, 300);
  assert.equal(offSwitches({ viewer: { on: false } })[0].href, "#/settings?s=viewer");
  // An answer that has not come in, or says nothing of its switch, is not called off.
  assert.deepEqual(offSwitches({ generation: null, viewer: {}, web: { on: "no" } }), []);
  assert.deepEqual(offSwitches(), []);
  assert.equal(OFF_WORDS.link, "Open in Settings");
  assert.equal(OFF_WORDS.off, "Off");
  for (const id of ["generation", "viewer", "web"]) assert.ok(OFF_WORDS[id].say.length > 0 && !/\u2014/.test(OFF_WORDS[id].say));
});

test("studio: the row at the top jumps to each part whose list has come in, in the page's order", () => {
  const figures = studioFigures({ art: { sprites: [{}] }, slides: shape("studio-slides"), videos: shape("studio-videos"),
    dept: { figures: [{ id: "files", label: "Files", value: "0", hint: "" }, { id: "cad", label: "Parts", value: "1", hint: "" }] } });
  const j = jumpsOf({ films: [{}, {}, {}], figures, images: [] });
  assert.deepEqual(j.map((x) => [x.id, x.label, x.value]), [
    ["films", "Films", "3"], ["videos", "Videos", "1"], ["carousels", "Carousels", "1"], ["sprites", "Sprites", "1"],
    ["pictures", "Pictures", "0"], ["cad", "Parts", "1"], ["files", "Files", "0"],
  ]);
  assert.deepEqual(jumpsOf({ films: null, figures: [], images: null }), []);
  assert.deepEqual(jumpsOf(), []);
});

test("studio: with a film opened, the film is the whole pane and the rest of Studio follows under it", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  const film = code.indexOf("if (filmId) {");
  const header = code.indexOf("<${PageHeader}");
  assert.ok(film > 0 && header > film, "the film is returned before the page's own header is drawn");
  const branch = code.slice(film, header);
  assert.match(branch, /<\$\{FilmView\} key=\$\{filmId\} id=\$\{filmId\} settled=\$\{settled\} more=\$\{html`<div class="p-studio__rest">\$\{parts\}<\/div>`\} \/>/);
  assert.doesNotMatch(branch, /PageHeader|id="page-title"/, "one page title: the film's");
  // The crumbs the page gives the top bar.
  assert.match(code, /crumbs=\$\{\[\{ label: "Dashboards", href: "#\/dashboards" \}, \{ label: "Studio" \}\]\}/);
  // The film's rules live in studio-film.css alone.
  const css = readFileSync(join(TREE, "styles", "pages", "studio.css"), "utf8");
  assert.doesNotMatch(css, /p-film\b|p-film__|p-studio__film/);
});

test("studio: a media part takes one column a card up to four, all four while loading or with a thing opened in it", async () => {
  const { spanOf } = await import("../../pages/studio.js");
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((n) => spanOf(n)), [1, 1, 2, 3, 4, 4]);
  assert.equal(spanOf(1, { open: true }), 4);
  assert.equal(spanOf(1, { loaded: false }), 4);
  assert.equal(spanOf("3"), 1);
  assert.equal(spanOf(-2), 1);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U13). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const FILM_ID = "e0000000-0000-4000-8000-000000000041";
const ROOM = { path: "/Users/someone/Studio room", limits: { clipBytes: 2147483648 }, files: [{ name: "lake.mp4", size: 1048576, changed: "2026-11-12T10:00:00.000Z" }] };

// The server's answer for each path: the pinned shapes, the room above, and every door off.
function studioAnswers(over = {}) {
  const films = shape("films");
  const base = {
    "/api/studio/art": shape("studio-art"), "/api/departments/studio": shape("department"),
    "/api/studio/slides": shape("studio-slides"), "/api/studio/videos": shape("studio-videos"), "/api/studio/room": ROOM,
    "/api/studio/films": films.list, [`/api/studio/films/${FILM_ID}`]: films.film,
    "/api/generation": { ...shape("generation"), on: false }, "/api/viewer": { ...shape("viewer"), on: false }, "/api/web": { ...shape("web"), on: false },
    "/api/map/studio": shape("map"), "/api/studio/art/sprite?id=STH-8%2Fwalker": shape("sprite"),
  };
  return { ...base, ...over };
}

async function mountStudio(answers, { query = "" } = {}) {
  installDom();
  globalThis.document.visibilityState = "visible";
  const hash = `#/dashboards/studio${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const body = Object.hasOwn(answers, path) ? answers[path] : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body || { error: { message: "Not here.", code: "not_found" } } };
  };
  const tops = [];
  const ctx = { shell: { team: shape("shell").team, dock: [] }, setTop: (t) => tops.push(t), announce() {}, openComposer() {}, openPanel() {}, closePanel() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${studio.default} route=${{ id: "studio", parts: ["dashboards", "studio"], query: new URLSearchParams(query) }} /><//>`, root);
  // Every answer, then the films' own and an opened sprite's, have come in.
  for (let i = 0, n = -1; i < 8 && n !== calls.length; i += 1) { n = calls.length; await new Promise((r) => setTimeout(r, 250)); }
  return { root, calls, tops, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

test("studio: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const query of ["", "video=STH-25%2Ftitle", "sprite=STH-8%2Fwalker", "slides=STH-24%2Flaunch", `film=${FILM_ID}`]) {
    const m = await mountStudio(studioAnswers(), { query });
    try { seen.push(`# ${query || "plain"}`, ...[...m.calls].sort()); } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U13 changed it (each mount's requests sorted: the order of answers in
  // flight is the machine's, not the page's).
  const READS = ["GET /api/departments/studio", "GET /api/generation", "GET /api/map/studio", "GET /api/studio/art"];
  const LISTS = ["GET /api/studio/room", "GET /api/studio/slides", "GET /api/studio/videos", "GET /api/viewer", "GET /api/web"];
  const FILMS = "GET /api/studio/films";
  const FILM = `GET /api/studio/films/${FILM_ID}`;
  const RECORDED = [
    "# plain", ...READS, FILMS, FILM, ...LISTS,
    "# video=STH-25%2Ftitle", ...READS, FILMS, FILM, ...LISTS,
    "# sprite=STH-8%2Fwalker", ...READS, "GET /api/studio/art/sprite?id=STH-8%2Fwalker", FILMS, FILM, ...LISTS,
    "# slides=STH-24%2Flaunch", ...READS, FILMS, FILM, ...LISTS,
    `# film=${FILM_ID}`, ...READS, FILMS, FILMS, FILM, FILM, ...LISTS,
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});
