// PLAN-V5 T41c, inbox/goals.mjs: a finished film is today's ordinary item (Accept, Send back), never a pick card
// (K14 step 5, C7), with two more details hashed into its version: "Film" from the edit's manifest and "Spent" from
// the generation door's ledger only. Every other finished task's item is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDS_V3 } from "../../../test/stubs/seed.mjs";
import { appendLine } from "../../../generate/ledger.mjs";
import { forgetBrandChecks } from "../lib/brandcheck.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { shotsHash } from "../lib/shotlist.mjs";
import { forgetTasteChecks } from "../lib/taste.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const FILM_JOB = "studio/a-film-from-your-renders";
const GOAL = IDS_V3.issues["STH-25"];
const ITEM = `goal:${GOAL}`;
const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const B1 = `b${"4".repeat(20)}`;
const B2 = `b${"5".repeat(20)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const VARIANTS = { kind: "film", name: "lake", round: 1, variants: [{ id: "a", direction: "slow-approach" }, { id: "b", direction: "detail-to-whole" }, { id: "c", direction: "day-of-light" }] };
const PRICED = [{ id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5, credits: 25 }];
const later = (m) => new Date(Date.now() + m * 60000).toISOString();
const approval = (batch, budget, m) => ({ round: 1, variant: "b", direction: "detail-to-whole", batch, budget, base: budget / 2, shots: shotsHash(PRICED), at: later(m) });
const EDIT = { name: "lake-film", kind: "video", made_by: "film", film: "lake-b", seconds: 14.5, clips: [{ clip: "s01-t1" }, { clip: "s02-t2" }, { clip: "s03-t1" }, { clip: "s01-t1" }] };

// STH-25 (finished, not accepted) as a film: three treatments on disk (which alone would make a pick card), the
// owner's approvals, the door's ledger lines and, unless `edit` is false, the edit's manifest.
async function withFilm({ template = FILM_JOB, approvals = [approval(B1, 220, -120), approval(B2, 100, -60)], edit = EDIT } = {}, fn) {
  forgetBrandChecks();
  forgetTasteChecks();
  const decisions = { [`template:${GOAL}`]: template };
  if (approvals) decisions[`shotlist:${GOAL}`] = approvals;
  const h = await startV2({ routes: ["inbox"], inbox: ["goals"], decisions });
  try {
    const idsFile = join(h.state, "ids.json");
    const ids = JSON.parse(readFileSync(idsFile, "utf8"));
    ids.agents["art-director"] = AD;
    writeFileSync(idsFile, JSON.stringify(ids));
    const goal = join(h.state, "tasks", "company-work", "STH-25");
    mkdirSync(goal, { recursive: true });
    writeFileSync(join(goal, "variants.json"), JSON.stringify(VARIANTS));
    for (const id of ["a", "b", "c"]) {
      mkdirSync(join(goal, "film", `lake-${id}`, "board"), { recursive: true });
      writeFileSync(join(goal, "film", `lake-${id}`, "board", "shot-01.png"), PNG);
    }
    if (edit) {
      mkdirSync(join(goal, "video", "lake-film"), { recursive: true });
      writeFileSync(join(goal, "video", "lake-film", "manifest.json"), JSON.stringify(edit));
    }
    const line = (job, batch, credits, state, verdict) => ({ at: later(-50), job, batch, shot: "s01", slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25, state, credits, runwayTask: null, verdict });
    appendLine(h.config.paths.ledger, line("g1", B1, 25, "reserved", null));
    appendLine(h.config.paths.ledger, line("g1", B1, 25, "spent", "refused"));
    appendLine(h.config.paths.ledger, line("g2", B2, 25, "reserved", null));
    appendLine(h.config.paths.ledger, line("g2", B2, 30, "spent", "done"));
    appendLine(h.config.paths.ledger, line("g3", null, 8, "reserved", null));
    return await fn(h, goal);
  } finally {
    forgetBrandChecks();
    await h.close();
  }
}

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const itemOf = async (h) => (await inbox(h)).items.find((i) => i.id === ITEM);
const decisionsOf = (h) => JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));

test("a finished film is today's ordinary item with the Film and Spent details, never a pick card", async () => {
  await withFilm({}, async (h) => {
    const item = await itemOf(h);
    assert.ok(item, "listed");
    // The item as the source makes it (the task model's decorations, taskId, identifier and agent, come later).
    const shape = readShape("needs-you-item");
    for (const k of ["taskId", "identifier", "agent"]) delete shape[k];
    assert.deepEqual(sameShape(shape, item), []);
    assert.equal(item.kind, "result");
    assert.equal(item.title, "Finished: An animated title card");
    assert.deepEqual(item.actions.map((a) => [a.id, a.label]), [["acknowledge", "Accept"], ["reopen", "Send back"]]);
    assert.deepEqual(item.details.slice(-2), [
      { label: "Film", value: "3 clips, 14.5 seconds" },
      { label: "Spent", value: "55 of 320 credits ($0.55 of $3.20)" },
    ]);
    for (const k of ["variants", "pieceKind", "round", "missing"]) assert.ok(!(k in item), k);
  });
});

test("the two details are hashed into the version: a new ledger line or a new edit changes it; no edit says so", async () => {
  await withFilm({ edit: false }, async (h, goal) => {
    const first = await itemOf(h);
    assert.deepEqual(first.details.at(-2), { label: "Film", value: "No edit yet" });
    mkdirSync(join(goal, "video", "lake-film"), { recursive: true });
    writeFileSync(join(goal, "video", "lake-film", "manifest.json"), JSON.stringify(EDIT));
    const second = await itemOf(h);
    assert.equal(second.details.at(-2).value, "3 clips, 14.5 seconds");
    assert.notEqual(second.version, first.version);
    appendLine(h.config.paths.ledger, { at: later(0), job: "g4", batch: B2, shot: "s01", slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25, state: "reserved", credits: 25, runwayTask: null, verdict: null });
    const third = await itemOf(h);
    assert.equal(third.details.at(-1).value, "80 of 320 credits ($0.80 of $3.20)");
    assert.notEqual(third.version, second.version);
    // An edit of another treatment, or not made by `film`, is no edit of this film.
    writeFileSync(join(goal, "video", "lake-film", "manifest.json"), JSON.stringify({ ...EDIT, film: "lake-a" }));
    assert.equal((await itemOf(h)).details.at(-2).value, "No edit yet");
    writeFileSync(join(goal, "video", "lake-film", "manifest.json"), JSON.stringify({ ...EDIT, made_by: "cut" }));
    assert.equal((await itemOf(h)).details.at(-2).value, "No edit yet");
  });
});

test("Accept on a finished film: the ordinary acceptance, no pick record; a stale card is refused", async () => {
  await withFilm({}, async (h) => {
    const before = decisionsOf(h);
    const seen = await itemOf(h);
    appendLine(h.config.paths.ledger, { at: later(0), job: "g5", batch: B1, shot: "s01", slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25, state: "reserved", credits: 25, runwayTask: null, verdict: null });
    const stale = await call(h.url, "POST", "/api/inbox/act", { body: { id: ITEM, action: "acknowledge", version: seen.version } });
    assert.equal(stale.status, 409, stale.text);
    const r = await actAsSeen(h.url, { id: ITEM, action: "acknowledge" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message, "Accepted.");
    const after = decisionsOf(h);
    assert.ok(after[`acknowledged:goal:${GOAL}`]);
    assert.equal(after[`pick:${GOAL}`] ?? null, before[`pick:${GOAL}`] ?? null, "no pick record");
    assert.equal(await itemOf(h), undefined);
  });
});

test("the ledger unreadable: Spent says so; the card stays an ordinary item", async () => {
  await withFilm({}, async (h) => {
    writeFileSync(h.config.paths.ledger, "{torn", { flag: "a" });
    const item = await itemOf(h);
    assert.equal(item.kind, "result");
    assert.equal(item.details.at(-1).value, "Not known: the spending ledger cannot be read. Up to 320 credits ($3.20) were approved.");
  });
});

test("every other item is unchanged: a film with no approval, and a job that does not make films, keep today's card", async () => {
  await withFilm({ approvals: null }, async (h) => {
    const item = await itemOf(h);
    assert.equal(item.kind, "pick", "a film never approved shows its versions as today");
    assert.ok(!item.details.some((d) => d.label === "Film" || d.label === "Spent"));
  });
  await withFilm({ template: "studio/an-animated-title-card" }, async (h) => {
    const item = await itemOf(h);
    assert.ok(!item.details.some((d) => d.label === "Film" || d.label === "Spent"), "a shotlist record on a job that does not make films adds nothing");
  });
  await withFilm({}, async (h, goal) => {
    rmSync(join(goal, "variants.json"));
    const item = await itemOf(h);
    assert.equal(item.kind, "result");
    assert.equal(item.details.at(-1).label, "Spent");
  });
});
