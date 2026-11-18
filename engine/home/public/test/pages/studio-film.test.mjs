// A film in Studio (PLAN-V5 T45b): the pure helpers of pages/studio-film.js tried on the home server's pinned shape
// (shapes/films.json) and on hostile input, and the page's own source: agents' words as text, only /api/ addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const m = await import("../../pages/studio-film.js");
const { studioHref } = await import("../../pages/studio.js");
const SRC = readFileSync(join(TREE, "pages", "studio-film.js"), "utf8");
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");

function shape(name) {
  for (let d = TREE; d !== dirname(d); d = dirname(d)) {
    const f = join(d, "server", "test", "shapes", `${name}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
}
const AWAY = ["https:", "", ["elsewhere", "example"].join(".")].join("/");

// U18 L4: a Films row's money is the server's own sentence (the row's `words`), whole and as sent; the page's
// figures only when an older server sends none.
test("rowWords: the Films row's money in the server's words, whole; the figures only without them", () => {
  const unread = "What was spent cannot be read; $6.00 was approved.";
  assert.equal(m.rowWords({ spent: null, budget: 600, words: unread }), unread);
  assert.equal(m.rowWords({ spent: 175, budget: 600, words: "$1.75 of $6.00 spent." }), "$1.75 of $6.00 spent.");
  assert.equal(m.rowWords(shape("films").list.films[0]), shape("films").list.films[0].words);
  assert.equal(m.rowWords({ spent: 175, budget: 600 }), "$1.75 of $6.00", "an older server: its figures, as before");
  assert.equal(m.rowWords({ spent: null, budget: 600, words: "  " }), "Spent so far not known, of $6.00");
  assert.equal(m.rowWords({ spent: 1, budget: 2, words: "<b>x</b>" }), "<b>x</b>", "a string, never markup");
  // The row draws those words, not its own.
  assert.match(code, /p-studio__fact">\$\{rowWords\(film\)\}/);
});

test("credit words: spent of budget, in dollars", () => {
  assert.equal(m.creditWords(175, 600), "$1.75 of $6.00");
  assert.equal(m.totalWords(175, 600), "$1.75 of $6.00");
  assert.equal(m.totalWords(0, 220), "$0.00 of $2.20");
  assert.match(m.creditWords(null, 600), /not known/);
  assert.equal(m.totalWords(null, 600), "Spent so far not known, of $6.00");
  assert.equal(m.takeCredits(25), "$0.25");
  assert.equal(m.takeCredits(1), "$0.01");
  assert.equal(m.takeCredits("x"), "");
  assert.equal(m.dollarsOf(-5), "");
  assert.equal(m.spentShare(110, 220), 50);
  assert.equal(m.spentShare(500, 220), 100);
  assert.equal(m.spentShare(null, 220), 0);
  assert.equal(m.spentShare(5, 0), 0);
});

test("take states and verdicts in words", () => {
  assert.deepEqual(["making", "made", "refused", "failed", "x"].map(m.takeStateWords), ["Being made", "Made", "Refused by Runway", "Failed", "Not known"]);
  assert.equal(m.verdictWords({ verdict: "keep", reason: "fine", round: 1 }), "Keep");
  assert.equal(m.verdictWords({ verdict: "retake", reason: "the tower bends", round: 1 }), "Retake: the tower bends");
  assert.equal(m.verdictWords({ verdict: "retake", reason: "x".repeat(900) }).length, "Retake: ".length + 200);
  assert.equal(m.verdictWords(null), "Not looked at yet");
  assert.equal(m.verdictWords({ verdict: "other" }), "Not looked at yet");
  assert.deepEqual(["making", "done", "stopped", "needs you", "ended"].map(m.filmStateWords), ["Being made", "Done", "Stopped", "Needs you", "Approval ended"]);
  assert.equal(m.clipsWords(3, 2), "3 clips made, 2 kept");
  assert.equal(m.clipsWords(1, 0), "1 clip made, 0 kept");
  assert.equal(m.takeName("t2"), "Take 2");
  assert.equal(m.takeName("../x"), "Take");
});

test("the banners: a frozen newest batch, a changed shotlist, the server's own problem", () => {
  const f = shape("films").film;
  assert.deepEqual(m.filmBanners(f), []);
  const frozen = { ...f, batches: [{ ...f.batches[0], frozen: false }, { ...f.batches[0], frozen: true }], problem: m.FROZEN_WORDS };
  assert.deepEqual(m.filmBanners(frozen).map((b) => b.text), ["Runway refused two pictures or prompts in this film. It needs you."]);
  assert.equal(m.filmBanners({ ...f, batches: [{ frozen: true }, { frozen: false }] }).length, 0, "only the newest batch counts");
  const both = m.filmBanners({ ...frozen, changedAfterApproval: true });
  assert.deepEqual(both.map((b) => b.key), ["frozen", "changed"]);
  assert.equal(both[1].text, "The shotlist was changed after you approved it. Each take shows what was sent to Runway.");
  assert.equal(m.filmBanners({ ...f, problem: "The ledger could not be read." })[0].text, "The ledger could not be read.");
  assert.deepEqual(m.filmBanners(null), []);
  assert.equal(m.anyMaking({ shots: [{ takes: [{ state: "made" }, { state: "making" }] }] }), true);
  assert.equal(m.anyMaking(f), false);
  assert.equal(m.STILL_CHARGING, "Runway may still charge for clips that are being made.");
});

test("the approved and sent prompts: the server's words, the gone and none sentences, the changed banner", () => {
  const f = shape("films").film;
  assert.deepEqual(m.labelsOf(f), f.labels);
  assert.equal(m.labelsOf(f).approved, "What you approved");
  assert.equal(m.labelsOf(f).sentPrompt, "The prompt sent to Runway");
  assert.deepEqual(m.labelsOf({}), m.LABEL_WORDS, "without labels the same words stand in");
  assert.equal(m.labelsOf({ labels: { changed: "  ", approved: 5 } }).changed, m.CHANGED_WORDS);
  assert.equal(m.labelsOf({ labels: { approved: "Approved by you" } }).approved, "Approved by you");
  assert.equal(m.sentPromptKind("A prompt."), "text");
  assert.equal(m.sentPromptKind("gone"), "gone");
  assert.equal(m.sentPromptKind(null), "none");
  assert.equal(m.sentPromptKind("  "), "none");
  assert.equal(m.sentPromptKind(5), "none");
  const changed = m.filmBanners({ ...f, changedAfterApproval: true, labels: { ...f.labels, changed: "Changed: see each take." } });
  assert.equal(changed[0].text, "Changed: see each take.");
  assert.doesNotMatch(m.CHANGED_WORDS, /follow what you approved/);
  assert.deepEqual(m.filmBanners({ ...f, changedAfterApproval: false }), []);
});

test("the sent picture, the prompt and the edit link", () => {
  const f = shape("films").film;
  assert.equal(m.sentKind(f.shots[0].takes[0].sent), "picture");
  assert.equal(m.sentKind("gone"), "gone");
  assert.equal(m.sentKind(null), "none");
  assert.equal(m.sentKind(`${AWAY}/x.png`), "none");
  assert.equal(m.GONE_WORDS, "No longer kept: the door keeps sent pictures for a day");
  assert.equal(m.clampWords("short"), "short");
  const c = m.clampWords("word ".repeat(200));
  assert.ok(c.length <= 241 && c.endsWith("…"));
  assert.equal(m.editHref(f.edit), "#/dashboards/studio?video=STH-41%2Flake-film");
  assert.equal(m.editHref({ identifier: "../x", name: "a" }), null);
  assert.equal(m.editHref(null), null);
});

// T49f N2: a request Runway did not start is shown under its shot, quietly, with the picture and prompt sent.
test("requests Runway did not start: the server's words, only an /api/ picture, the prompt as text, gone or none", () => {
  const f = shape("films").film;
  assert.equal(m.labelsOf(f).notStarted, "Sent, not started by Runway");
  assert.equal(m.labelsOf({}).notStarted, "Sent, not started by Runway");
  const [n] = m.notStartedOf(f.shots[0]);
  assert.deepEqual(n, {
    key: "b0123456789abcdef0123-g00000000000000000004-0", when: "2026-11-13T10:00:00.000Z",
    sent: "/api/studio/films/e0000000-0000-4000-8000-000000000041/sent/g00000000000000000004",
    prompt: "The camera moves slowly towards the front door in soft morning light.",
  });
  const odd = m.notStartedOf({ notStarted: [
    { sent: `${AWAY}/x.png`, sentPrompt: "gone" }, { sent: "gone", sentPrompt: null }, null, "x", { sentPrompt: "y".repeat(5000), at: 5 },
  ] });
  assert.deepEqual(odd.map((x) => [x.sent, x.prompt.length > 10 ? x.prompt.length : x.prompt, x.when]), [["", "gone", ""], ["", "none", ""], ["", 1000, ""]]);
  assert.deepEqual(m.notStartedOf({}), []);
  assert.deepEqual(m.notStartedOf({ notStarted: "no" }), []);
  assert.equal(m.notStartedOf({ notStarted: Array.from({ length: 20 }, () => ({})) }).length, 6);
  // On the page: the words as text, the picture only through safeApi, no markup from the prompt.
  assert.match(code, /sent: safeApi\(n\.sent\) \|\| ""/);
  assert.match(code, /<\$\{NotStarted\} shot=\$\{shot\} labels=\$\{labels\} \/>/);
  assert.match(code, /<span>\$\{labels\.notStarted\}<\/span>/);
});

test("studioHref opens a film by its task id", () => {
  assert.equal(studioHref({ film: "e0000000-0000-4000-8000-000000000041" }), "#/dashboards/studio?film=e0000000-0000-4000-8000-000000000041");
  assert.equal(studioHref({ film: "a&b" }), "#/dashboards/studio?film=a%26b");
  assert.equal(studioHref({ film: 5 }), "#/dashboards/studio");
});

test("the page: every address passes safeApi, agent words are text, nothing outside /api/", () => {
  assert.doesNotMatch(code, /innerHTML|dangerouslySetInnerHTML|\beval\(|new Function|fetch\(/);
  assert.doesNotMatch(code, /https?:\/\//);
  for (const field of ["take.clip", "take.sent", "shot.board"]) assert.ok(code.includes(`safeApi(${field})`), field);
  assert.match(code, /stills\.map\(safeApi\)/);
  assert.match(code, /useResource\(id \? `\/api\/studio\/films\/\$\{encodeURIComponent\(id\)\}`/);
  // T52: the clip plays in the kit Player (no autoplay; preload metadata), never in a <video> drawn by the page.
  assert.match(code, /<\$\{Player\} key=\$\{`\$\{at\.shot\}-\$\{at\.take\}`\} src=\$\{clipOf\(take\) \|\| undefined\}/);
  assert.doesNotMatch(code, /<video\b/);
  assert.match(code, /useBringIntoView\(/);
  const studio = readFileSync(join(TREE, "pages", "studio.js"), "utf8");
  assert.match(studio, /query\.get\("film"\)/);
  assert.match(studio, /"\/api\/studio\/films", \{ every: EVERY \}/);
  assert.match(studio, /No films yet\./);
  assert.match(studio, /Start "A film from your renders" in <a href="#\/jobs\/studio\/a-film-from-your-renders">Jobs<\/a>/);
});

// ---- T52 (PLAN-COOK, S04): the film on a stage ----------------------------------------------------------------

const DOM = await import("../kit/_dom.mjs");

// The pinned film with the take's two prompts made different, and a clip address that is not the home server's.
function filmWith(take) {
  const f = JSON.parse(JSON.stringify(shape("films").film));
  Object.assign(f.shots[0].takes[0], take);
  return f;
}

test("the take shown first: a take that needs the owner, else the newest made, else the first shot", () => {
  const f = shape("films").film;
  assert.deepEqual(m.defaultPick(f), { shot: 0, take: 0 }, "a retake verdict needs the owner");
  const kept = filmWith({ verdict: { verdict: "keep", reason: "fine" } });
  const two = { ...kept, shots: [kept.shots[0], { ...kept.shots[0], id: "s02", takes: [{ ...kept.shots[0].takes[0], take: "t1" }, { ...kept.shots[0].takes[0], take: "t2" }] }] };
  assert.deepEqual(m.defaultPick(two), { shot: 1, take: 1 }, "else the newest made, in reading order");
  const making = { ...two, shots: [two.shots[0], { ...two.shots[1], takes: [{ state: "refused" }] }] };
  assert.deepEqual(m.defaultPick(making), { shot: 1, take: 0 }, "a refusal needs the owner");
  const changed = filmWith({ verdict: { verdict: "keep" }, sentPrompt: "Another prompt." });
  assert.deepEqual(m.defaultPick({ ...changed, changedAfterApproval: true, shots: [{ takes: [{ state: "made", verdict: { verdict: "keep" } }] }, changed.shots[0]] }), { shot: 1, take: 0 }, "changed after approval: the take whose sent prompt differs");
  assert.equal(m.needsLook({ state: "made", verdict: { verdict: "keep" }, approvedPrompt: "a", sentPrompt: "b" }, false), false);
  assert.deepEqual(m.defaultPick({ shots: [{ id: "s01", takes: [] }] }), { shot: 0, take: -1 });
  assert.deepEqual(m.defaultPick(null), { shot: 0, take: -1 });
});

test("a take's chip, label and facts, and the prompt as the rail shows it", () => {
  assert.deepEqual(m.takeChip({ state: "made", verdict: { verdict: "keep" } }), { tone: "good", text: "Made, kept", icon: "check" });
  assert.deepEqual(m.takeChip({ state: "made", verdict: { verdict: "retake" } }), { tone: "warn", text: "Made, to retake", icon: "retake" });
  assert.deepEqual(m.takeChip({ state: "made" }), { tone: "neutral", text: "Made" });
  assert.deepEqual(m.takeChip({ state: "making" }), { tone: "neutral", text: "Being made", icon: "clock" });
  assert.equal(m.takeChip({ state: "refused" }).tone, "bad");
  assert.equal(m.takeChip({ state: "failed" }).text, "Failed");
  assert.equal(m.takeChip(null).text, "Not known");
  assert.equal(m.takeLabel(1, { take: "t2" }), "Shot 1, take 2");
  assert.equal(m.secondsWords({ seconds: 5 }), "5 s");
  assert.equal(m.secondsWords({ seconds: "x" }), "");
  assert.deepEqual(m.promptView({ approvedPrompt: "a b", sentPrompt: "a c" }), { kind: "diff", approved: "a b", sent: "a c" });
  assert.deepEqual(m.promptView({ approvedPrompt: "a b", sentPrompt: "a b" }), { kind: "same", approved: "a b", sent: "a b" });
  assert.deepEqual(m.promptView({ sentPrompt: "a b" }), { kind: "same", approved: "", sent: "a b" });
  assert.deepEqual(m.promptView({ approvedPrompt: "a", sentPrompt: "gone" }), { kind: "gone", approved: "a", sent: "" });
  assert.equal(m.promptView({ approvedPrompt: "a" }).kind, "none");
  assert.equal(m.promptView({ sentPrompt: "x".repeat(5000) }).sent.length, 1000);
  assert.equal(m.FILM_WORDS.diffApproved, "you approved, not sent");
  assert.equal(m.FILM_WORDS.diffSent, "sent, not approved");
});

test("a clip or still address outside /api/ is dropped", () => {
  assert.equal(m.clipOf({ clip: "/api/view/abc" }), "/api/view/abc");
  for (const bad of [`${AWAY}/x.mp4`, "//elsewhere/x.mp4", "/view/x.mp4", "javascript:alert(1)", "/api/view/a b", "/api//x", 5, null]) {
    assert.equal(m.clipOf({ clip: bad }), "", String(bad));
  }
  assert.equal(m.clipOf(null), "");
  assert.deepEqual(m.stillsOf({ stills: ["/api/view/a", `${AWAY}/b.png`, "/api/view/c", null, ...Array(9).fill("/api/view/d")] }), ["/api/view/a", "/api/view/c", "/api/view/d", "/api/view/d", "/api/view/d", "/api/view/d"]);
  assert.deepEqual(m.stillsOf({ stills: "x" }), []);
  assert.deepEqual(m.shotRows({ shots: [{ id: "s01", board: `${AWAY}/b.png`, takes: [] }] })[0].board, "");
});

test("the top bar: the crumbs, Film 1 of 3 and the task", () => {
  const films = [{ task: { id: "a", identifier: "STH-41" } }, { task: { id: "b", identifier: "STH-43" } }, { task: { id: "c", identifier: "STH-42" } }];
  assert.deepEqual(m.filmPager(films, "STH-43"), { label: "Film 2 of 3", prev: "#/dashboards/studio?film=STH-41", next: "#/dashboards/studio?film=STH-42" });
  assert.deepEqual(m.filmPager(films, "a"), { label: "Film 1 of 3", prev: null, next: "#/dashboards/studio?film=STH-43" });
  assert.equal(m.filmPager(films, "zz"), null);
  assert.equal(m.filmPager(null, "a"), null);
  assert.deepEqual(m.filmCrumbs("STH-41").map((c) => c.label), ["Dashboards", "Studio", "Films", "STH-41"]);
  assert.equal(m.filmCrumbs("STH-41")[1].href, "#/dashboards/studio");
  assert.equal(m.taskHref("STH-41"), "#/tasks/STH-41");
  assert.equal(m.taskHref("../x"), null);
});

test("every shot and every approval as rows, figures from the server's numbers", () => {
  const f = shape("films").film;
  assert.deepEqual(m.shotRows(f).map(({ n, move, takes, state, cost }) => ({ n, move, takes, state, cost })),
    [{ n: 1, move: "A slow push towards the door.", takes: "1 take", state: "Made, to retake", cost: "$0.50" }]);
  assert.equal(m.shotRows(f)[0].board, f.shots[0].board);
  const [b] = m.batchRows(f, Date.parse("2026-11-14T00:00:00Z"));
  assert.deepEqual([b.budget, b.spent, b.refused, b.state], ["$3.00", "$1.25", "0", "Open"]);
  assert.equal(m.batchRows(f, Date.parse("2026-12-01T00:00:00Z"))[0].state, "Ended");
  assert.equal(m.batchRows({ batches: [{ frozen: true }] })[0].state, "Stopped, needs you");
});

// Drawn for real (the kit tests' small DOM): both prompts reach the page as text nodes, and a clip that is not the
// home server's own never reaches a video.
test("drawn: both prompts are text nodes, a clip address outside /api/ is dropped, the money is the server's", async () => {
  const approved = "The camera pulls back slowly through the morning mist <b>to</b> show the pool.";
  const sent = "The camera pulls back slowly to show the pool. <img src=x onerror=alert(1)> Soft light.";
  const f = filmWith({ verdict: { verdict: "keep", reason: "steady" }, approvedPrompt: approved, sentPrompt: sent, clip: `${AWAY}/clip.mp4` });
  DOM.installDom();
  const tops = [];
  const stub = DOM.stubFetch((path) => (path === "/api/studio/films"
    ? { status: 200, body: shape("films").list }
    : { status: 200, body: { ...f, changedAfterApproval: true } }));
  let root = null;
  try {
    const ctx = await import("../../lib/context.js");
    root = await DOM.mount(({ id }) => DOM.html`<${ctx.AppContext.Provider} value=${{ setTop: (t) => tops.push(t) }}><${m.FilmView} id=${id} /><//>`, { id: f.task.id });
    // Both answers (the film and the Films list) have come in and the top bar has heard the film: at most two seconds.
    const ready = () => DOM.textOf(root).includes("$1.75 of $6.00") && tops.some((t) => t && t.pager && t.crumbs.at(-1).label === "STH-41");
    for (let i = 0; i < 20 && !ready(); i += 1) await DOM.settle();
    const all = DOM.elements(root);
    const texts = [...DOM.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
    // The approved words that were not sent, and the sent words that were not approved, each a text node as written.
    assert.ok(texts.some((t) => t.includes("through the morning mist <b>to</b> ")), "the approved prompt's words are text");
    assert.ok(texts.some((t) => t.includes("<img src=x onerror=alert(1)>")), "the sent prompt's words are text");
    assert.ok(!all.some((e) => e.localName === "img" && e.getAttribute("src") === "x"), "no markup from a prompt");
    assert.ok(all.some((e) => e.localName === "del") && all.some((e) => e.localName === "ins"), "removed and added words are marked");
    // The clip from elsewhere is dropped: no video; the stage shows the take's stills instead.
    assert.ok(!all.some((e) => e.localName === "video"), "no video for a clip outside /api/");
    for (const e of all) for (const a of ["src", "poster", "href"]) {
      const v = e.getAttribute(a);
      if (typeof v === "string" && v && a !== "href") assert.ok(v.startsWith("/api/"), `${e.localName} ${a} ${v}`);
    }
    const words = DOM.textOf(root);
    assert.match(words, /\$1\.75 of \$6\.00/, "the spend is the server's numbers");
    assert.match(words, /you approved, not sent/);
    assert.match(words, /The shotlist was changed after you approved it\./);
    assert.ok(all.some((e) => e.getAttribute("id") === "page-title"), "the film's title is the page's h1");
    const top = tops.filter((t) => t && t.pager).pop();
    assert.deepEqual(top.crumbs.map((c) => c.label), ["Dashboards", "Studio", "Films", "STH-41"]);
    assert.equal(top.pager.label, "Film 1 of 1");
    assert.deepEqual(top.links, [{ label: "Open its task", href: "#/tasks/STH-41" }]);
  } finally {
    if (root) DOM.unmount(root);
    stub.restore();
  }
});
