// PLAN-V5 K9: the owner's pick on a card of versions, through a stub home. The pick is the acceptance (one action);
// "Another round" and "Send all back" behave like today's Send back. Each action writes exactly its records,
// comments and statuses; a stale card, a version that is not shown, a variant on any other item are refused and
// write nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDS_V3 } from "../../../test/stubs/seed.mjs";
import { forgetBrandChecks } from "../lib/brandcheck.mjs";
import { PICK_CHANGED } from "../lib/inbox.mjs";
import { forgetTasteChecks } from "../lib/taste.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { actAsSeen, call, writes } from "../lib/testing.mjs";

const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const GOAL = IDS_V3.issues["STH-25"];
const PLAIN = IDS_V3.issues["STH-23"];
const ITEM = `goal:${GOAL}`;
const PNG = (n = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56 + n)]);
const VARIANTS = { kind: "carousel", name: "launch", round: 1, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "picture-led" }, { id: "c", direction: "diagram-led" }] };
const REVIEW = [
  "REVIEW: FAIL - b is off the palette",
  "# Art review: round 1",
  "## Pieces",
  "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; calm and exact, the type carries it",
  "b: brand 5, hierarchy 6, composition 7, finish 7, idea 8, voice 7, kind 6; the strongest idea, but the teal is not ours",
  "## Seen",
  "- a: slides/launch-a/contact.png, slide 4: the figure and its label are the same size",
  "## Actions",
  "- b: use ink and sand only",
  "Review: FAIL",
].join("\n");
const REPORT = {
  version: 1, kit: "present",
  pieces: ["a", "b", "c"].map((id) => ({ kind: "slides", name: `launch-${id}`, result: "pass", hard: [], soft: [], measured: { colours: [], words: 0 } })),
  variants: { result: "pass", hard: [], present: true },
};
const later = (m) => new Date(Date.now() + m * 60000).toISOString();

// A stub home where STH-25 is a finished carousel job with three versions on disk and the Art director's review.
async function withPick({ variants = VARIANTS, ids = ["a", "b", "c"], comments = true, template = "marketing/carousel-from-a-concept" } = {}, fn) {
  forgetBrandChecks();
  forgetTasteChecks();
  const h = await startV2({
    routes: ["inbox"], inbox: ["goals"], brandCheckRunner: async () => REPORT,
    decisions: template ? { [`template:${GOAL}`]: template } : {},
  });
  try {
    const idsFile = join(h.state, "ids.json");
    const all = JSON.parse(readFileSync(idsFile, "utf8"));
    all.agents["art-director"] = AD;
    writeFileSync(idsFile, JSON.stringify(all));
    const goal = join(h.state, "tasks", "company-work", "STH-25");
    mkdirSync(goal, { recursive: true });
    if (variants) writeFileSync(join(goal, "variants.json"), JSON.stringify(variants));
    for (const id of ids) {
      mkdirSync(join(goal, "slides", `launch-${id}`), { recursive: true });
      writeFileSync(join(goal, "slides", `launch-${id}`, "contact.png"), PNG());
      writeFileSync(join(goal, "slides", `launch-${id}`, "slide-01.png"), PNG());
    }
    if (comments) {
      h.board.state.comments.push({ id: "cd000000-0000-4000-8000-000000000001", issueId: GOAL, body: REVIEW, authorAgentId: AD, authorUserId: null, createdAt: later(5) });
    }
    return await fn(h, goal);
  } finally {
    forgetBrandChecks();
    await h.close();
  }
}

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const itemOf = async (h, id = ITEM) => (await inbox(h)).items.find((i) => i.id === id);
const decisionsOf = (h) => JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
const tasteFile = (h) => join(h.state, "knowledge", "docs", "brand", "taste.md");
const lastWrites = (h, n) => h.board.requests.filter((x) => x.method !== "GET").slice(-n).map((w) => [`${w.method} ${w.path}`, w.body]);

// Keys added or changed in decisions.json between two reads.
function changed(before, after) {
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

// ---- the card

test("pick card: a finished task with variants.json is one item of kind pick, with the versions, their scores and three actions", async () => {
  await withPick({}, async (h) => {
    const item = await itemOf(h);
    assert.ok(item, "listed");
    assert.equal(item.kind, "pick");
    assert.equal(item.source, "goal");
    assert.equal(item.title, "Pick one: An animated title card");
    assert.equal(item.summary, "Three versions are ready. Pick one, ask for another round, or send all back with a note.");
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]),
      [["pick", "Pick this one", "primary", false], ["another", "Another round", "plain", false], ["reopen", "Send all back", "plain", true]]);
    assert.equal(item.actions[0].takes, "variant");
    assert.deepEqual(item.details.slice(0, 2), [{ label: "Versions", value: "3 to choose from" }, { label: "Round", value: "1" }]);
    assert.equal(item.pieceKind, "carousel");
    assert.equal(item.round, 1);
    assert.deepEqual(item.missing, []);
    assert.deepEqual(item.variants.map((v) => [v.id, v.direction.title, v.review && v.review.total, v.brand.result]),
      [["a", "Type led", 52, "pass"], ["b", "Picture led", 46, "pass"], ["c", "Diagram led", null, "pass"]]);
    assert.equal(item.variants[0].preview[0].type, "image");
    assert.match(item.version, /^[0-9a-f]{16}$/);
    assert.deepEqual(item.link, { page: "tasks", id: GOAL });
  });
});

test("pick card: a task without variants.json gets today's item, byte for byte, whatever its job", async () => {
  let craft;
  let plain;
  await withPick({ variants: null }, async (h) => { craft = await itemOf(h); });
  await withPick({ variants: null, template: "sales/call-write-up" }, async (h) => { plain = await itemOf(h); });
  assert.equal(craft.kind, "result");
  assert.deepEqual(craft.actions.map((a) => a.id), ["acknowledge", "reopen"]);
  // The department is the task model's own decoration, from the job (routes/inbox.mjs), not the source's item.
  delete craft.department;
  delete plain.department;
  assert.equal(JSON.stringify(craft), JSON.stringify(plain));
});

test("pick card: a broken variants.json gives today's actions and says why, in plain words", async () => {
  await withPick({ variants: { ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "type-led" }] } }, async (h) => {
    const item = await itemOf(h);
    assert.equal(item.kind, "result");
    assert.deepEqual(item.actions.map((a) => a.id), ["acknowledge", "reopen"]);
    assert.match(item.details.at(-1).value, /same direction/);
  });
});

// ---- the three actions

test("pick: one action accepts; writes the acknowledged record, the verdict, the pick record and acted; no board write; the taste file gets the line", async () => {
  await withPick({}, async (h) => {
    const before = decisionsOf(h);
    const boardBefore = writes(h.board).length;
    const note = "Warmer, and the picture carries it.";
    const r = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "b", note });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message, "Picked. Your choice and note are kept for next time.");
    const after = decisionsOf(h);
    assert.deepEqual(changed(before, after), [`acknowledged:goal:${GOAL}`, `acted:${GOAL}`, `pick:${GOAL}`, `verdicts:${GOAL}`].sort());
    assert.equal(writes(h.board).length, boardBefore, "the pick changes nothing on the board");
    const [p] = after[`pick:${GOAL}`];
    assert.deepEqual({ ...p, at: "-" }, {
      round: 1, variant: "b", direction: "picture-led", note, at: "-", action: "pick",
      versions: [{ id: "a", direction: "type-led", total: 52 }, { id: "b", direction: "picture-led", total: 46 }, { id: "c", direction: "diagram-led", total: null }],
      scores: { brand: 5, hierarchy: 6, composition: 7, finish: 7, idea: 8, voice: 7, kind: 6 },
    });
    assert.deepEqual(after[`verdicts:${GOAL}`].map((v) => [v.verdict, v.note, v.at]), [["accepted", null, p.at]]);
    assert.ok(!JSON.stringify(after[`pick:${GOAL}`]).includes("teal"), "no reason the Art director wrote");
    assert.ok(!(await inbox(h)).items.some((i) => i.id === ITEM), "no second step");
    const taste = readFileSync(tasteFile(h), "utf8");
    assert.match(taste, /\n## Carousel\n- \d{1,2} [A-Z][a-z]{2,3} \d{4}: picked "Picture led" over "Type led" and "Diagram led"\. Your note: "Warmer, and the picture carries it\."\n/);
    // A second click: already handled, nothing more written.
    const again = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action: "pick", variant: "b", version: "x" } });
    assert.equal(again.status, 409);
    assert.deepEqual(decisionsOf(h), after);
  });
});

test("another round: posts ANOTHER ROUND and the note, sets the task to todo, records the choice; no verdict, not accepted", async () => {
  await withPick({}, async (h) => {
    const before = decisionsOf(h);
    const r = await actAsSeen(h.url, { id: ITEM, action: "another", note: "Try darker." });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(lastWrites(h, 2), [
      [`POST /api/issues/${GOAL}/comments`, { body: "ANOTHER ROUND\n\nTry darker." }],
      [`PATCH /api/issues/${GOAL}`, { status: "todo" }],
    ]);
    const after = decisionsOf(h);
    assert.deepEqual(changed(before, after), [`acted:${GOAL}`, `pick:${GOAL}`].sort());
    const [p] = after[`pick:${GOAL}`];
    assert.deepEqual([p.action, p.variant, p.direction, p.note, p.scores, p.versions.map((v) => v.direction)],
      ["another", null, null, "Try darker.", null, ["type-led", "picture-led", "diagram-led"]]);
    assert.match(readFileSync(tasteFile(h), "utf8"), /: asked for another round\. Your note: "Try darker\."\n/);
  });
  // Without a note: the fixed line alone.
  await withPick({}, async (h) => {
    const r = await actAsSeen(h.url, { id: ITEM, action: "another" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(lastWrites(h, 2)[0], [`POST /api/issues/${GOAL}/comments`, { body: "ANOTHER ROUND" }]);
    assert.match(readFileSync(tasteFile(h), "utf8"), /: asked for another round\.\n/);
  });
});

test("send all back: needs a note; posts it, sets the task to todo, records the verdict and the choice, as Send back does", async () => {
  await withPick({}, async (h) => {
    const before = decisionsOf(h);
    const none = await actAsSeen(h.url, { id: ITEM, action: "reopen" });
    assert.equal(none.status, 400);
    assert.equal(none.json.error.code, "needs_note");
    assert.deepEqual(decisionsOf(h), before);
    const r = await actAsSeen(h.url, { id: ITEM, action: "reopen", note: "None of these feel like us." });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message, "Sent back with your note. The Chief of staff will pick it up.");
    assert.deepEqual(lastWrites(h, 2), [
      [`POST /api/issues/${GOAL}/comments`, { body: "None of these feel like us." }],
      [`PATCH /api/issues/${GOAL}`, { status: "todo" }],
    ]);
    const after = decisionsOf(h);
    assert.deepEqual(changed(before, after), [`acted:${GOAL}`, `pick:${GOAL}`, `verdicts:${GOAL}`].sort());
    const [p] = after[`pick:${GOAL}`];
    assert.deepEqual([p.action, p.variant, p.note], ["back", null, "None of these feel like us."]);
    assert.deepEqual(after[`verdicts:${GOAL}`].map((v) => [v.verdict, v.note, v.at]), [["sent-back", "None of these feel like us.", p.at]]);
    assert.match(readFileSync(tasteFile(h), "utf8"), /: sent all three back\. Your note: "None of these feel like us\."\n/);
  });
});

// ---- refusals that write nothing

test("a pick on a card that changed since it was read is refused with the versions sentence and writes nothing", async () => {
  // A piece's file changed.
  await withPick({}, async (h, goal) => {
    const seen = await itemOf(h);
    writeFileSync(join(goal, "slides", "launch-b", "contact.png"), PNG(10));
    const before = decisionsOf(h);
    const boardBefore = writes(h.board).length;
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action: "pick", variant: "b", version: seen.version } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.message, PICK_CHANGED);
    assert.equal(PICK_CHANGED, "These versions changed since you looked. Read them again.");
    assert.deepEqual(decisionsOf(h), before);
    assert.equal(writes(h.board).length, boardBefore);
    assert.ok(!existsSync(tasteFile(h)));
  });
  // A new review was written.
  await withPick({}, async (h) => {
    const seen = await itemOf(h);
    h.board.state.comments.push({ id: "cd000000-0000-4000-8000-000000000002", issueId: GOAL, body: REVIEW.replace("kind 6;", "kind 9;"), authorAgentId: AD, authorUserId: null, createdAt: later(6) });
    const before = decisionsOf(h);
    for (const action of ["pick", "another"]) {
      const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action, ...(action === "pick" ? { variant: "a" } : {}), version: seen.version } });
      assert.equal(r.status, 409, action);
      assert.equal(r.json.error.message, PICK_CHANGED);
    }
    assert.deepEqual(decisionsOf(h), before);
  });
});

test("variant d, a number, a pick without a variant, a variant on an ordinary item, a version that is not shown: refused, nothing written", async () => {
  await withPick({ ids: ["a", "b"] }, async (h) => {
    const item = await itemOf(h);
    assert.deepEqual(item.missing, ["c"]);
    assert.equal(item.details[0].value, "2 to choose from; 1 has missing files");
    const before = decisionsOf(h);
    const boardBefore = writes(h.board).length;
    const act = (body) => call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, version: item.version, ...body } });
    const d = await act({ action: "pick", variant: "d" });
    assert.equal(d.status, 400);
    assert.equal(d.json.error.code, "bad_variant");
    assert.equal((await act({ action: "pick", variant: 2 })).status, 400);
    assert.equal((await act({ action: "pick", variant: "B" })).status, 400);
    const none = await act({ action: "pick" });
    assert.equal(none.status, 400);
    assert.equal(none.json.error.code, "needs_variant");
    const gone = await act({ action: "pick", variant: "c" });
    assert.equal(gone.status, 400);
    assert.equal(gone.json.error.message, "That version is not one of those shown.");
    const onAnother = await act({ action: "another", variant: "a" });
    assert.equal(onAnother.status, 400);
    assert.equal(onAnother.json.error.code, "bad_variant");
    // An ordinary finished task (STH-23) takes no variant.
    const plain = await itemOf(h, `goal:${PLAIN}`);
    assert.equal(plain.kind, "result");
    const ordinary = await call(h.url, "POST", "/api/inbox/act", { body: { id: plain.id, action: "acknowledge", variant: "a", version: plain.version } });
    assert.equal(ordinary.status, 400);
    assert.equal(ordinary.json.error.code, "bad_variant");
    const pickThere = await call(h.url, "POST", "/api/inbox/act", { body: { id: plain.id, action: "pick", variant: "a", version: plain.version } });
    assert.equal(pickThere.status, 400);
    assert.deepEqual(decisionsOf(h), before);
    assert.equal(writes(h.board).length, boardBefore);
    assert.ok(!existsSync(tasteFile(h)));
  });
});

test("a pick with no note keeps none; a note of 5,000 characters is refused and writes nothing; a long note is kept as one capped line", async () => {
  await withPick({}, async (h) => {
    const r = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "a" });
    assert.equal(r.status, 200, r.text);
    const [p] = decisionsOf(h)[`pick:${GOAL}`];
    assert.equal(p.note, null);
    assert.match(readFileSync(tasteFile(h), "utf8"), /: picked "Type led" over "Picture led" and "Diagram led"\.\n/);
  });
  await withPick({}, async (h) => {
    const before = decisionsOf(h);
    const r = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "a", note: "x".repeat(5000) });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "note_too_long");
    assert.deepEqual(decisionsOf(h), before);
    assert.ok(!existsSync(tasteFile(h)));
    const long = `${"Warmer light.\n## Not a heading\n".repeat(100)}`.slice(0, 3900);
    const ok = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "c", note: long });
    assert.equal(ok.status, 200, ok.text);
    const [p] = decisionsOf(h)[`pick:${GOAL}`];
    assert.ok(p.note.length <= 300);
    assert.doesNotMatch(p.note, /\n/);
    const taste = readFileSync(tasteFile(h), "utf8");
    assert.equal(taste.split("\n").filter((l) => l.startsWith("## ")).length, 1, "a note never makes a heading");
  });
});

test("the act route takes a variant only from the home screen's own POST", async () => {
  await withPick({}, async (h) => {
    const item = await itemOf(h);
    const before = decisionsOf(h);
    const bare = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action: "pick", variant: "a", version: item.version }, bare: true, headers: { "content-type": "application/json" } });
    assert.equal(bare.status, 403);
    const other = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action: "pick", variant: "a", version: item.version }, headers: { origin: "http://evil.example" } });
    assert.equal(other.status, 403);
    assert.deepEqual(decisionsOf(h), before);
  });
});

test("the pieces' files are never removed or changed by an action", async () => {
  await withPick({}, async (h, goal) => {
    const r = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "a" });
    assert.equal(r.status, 200);
    for (const id of ["a", "b", "c"]) assert.ok(existsSync(join(goal, "slides", `launch-${id}`, "contact.png")));
    assert.equal(JSON.parse(readFileSync(join(goal, "variants.json"), "utf8")).name, "launch");
    rmSync(join(goal, "variants.json"));
  });
});

test("pick card: thousands of junk files keep the card's version steady between lists, show no scores, and a pick still works", async () => {
  await withPick({}, async (h, goal) => {
    mkdirSync(join(goal, "content"), { recursive: true });
    for (let i = 0; i < 3100; i += 1) writeFileSync(join(goal, "content", `junk-${i}.md`), "x");
    const first = await itemOf(h);
    const second = await itemOf(h);
    assert.equal(first.version, second.version);
    assert.deepEqual(first.variants.map((v) => v.review), [null, null, null]);
    assert.ok(first.details.some((d) => d.label === "Scores" && /too many files/.test(d.value)));
    const r = await actAsSeen(h.url, { id: ITEM, action: "pick", variant: "a" });
    assert.equal(r.status, 200, r.text);
  });
});
