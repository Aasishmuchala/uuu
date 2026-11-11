import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBench } from "./bench.mjs";
import { startStubBoard } from "./board.mjs";
import { BENCH_KEYS, benchSeed, boardSeedV2, copyStateSeedV2, decisionsV3, IDS, IDS_V3 } from "./seed.mjs";
import { parseCheck, roundsOf } from "../../home/server/lib/staged.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = path.join(here, "state-seed");
const work = path.join(seed, "tasks", "company-work");
const byKey = (s, key) => s.issues.find((i) => i.identifier === key);
const commentsOf = (s, key) => s.comments.filter((c) => c.issueId === IDS_V3.issues[key]);
const pngSize = (buf) => (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString("ascii", 12, 16) === "IHDR"
  ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);

async function bench(seedOptions) {
  const b = await startStubBench({ seed: benchSeed({ now: new Date("2026-11-11T09:00:00Z"), ...seedOptions }) });
  const get = async (key, p) => {
    const res = await fetch(b.url + p, { headers: { authorization: `token ${key}` } });
    return { status: res.status, json: await res.json() };
  };
  return { b, get };
}

// ---- board seed

test("v3 seed: STH-19 to STH-25 have the titles and states of section 38", () => {
  const s = boardSeedV2();
  const want = {
    "STH-19": ["done", "What is our returns policy, and when did it last change?"],
    "STH-20": ["done", "Call write-up: Asha Kitchens"],
    "STH-21": ["in_progress", "Proposal from a call write-up"],
    "STH-22": ["in_progress", "Do we charge for delivery?"],
    "STH-23": ["done", "Five concepts before any design: Diwali offer"],
    "STH-24": ["done", "A carousel from one concept"],
    "STH-25": ["done", "An animated title card"],
  };
  for (const [k, [status, title]] of Object.entries(want)) {
    const i = byKey(s, k);
    assert.ok(i, k);
    assert.equal(i.status, status, k);
    assert.equal(i.title, title, k);
    assert.equal(i.id, IDS_V3.issues[k], k);
    assert.equal(i.parentId, null, k);
    assert.equal(i.assigneeAgentId, IDS.agents["chief-of-staff"], k);
    if (status === "done") assert.ok(i.startedAt && i.completedAt, k);
  }
  assert.equal(s.companies[0].issueCounter, 25);
  assert.equal(s.issues.length, 25);
  assert.equal(new Set(s.issues.map((i) => i.id)).size, s.issues.length);
  assert.equal(new Set(s.comments.map((c) => c.id)).size, s.comments.length);
  assert.equal(new Set(s.heartbeatRuns.map((r) => r.id)).size, s.heartbeatRuns.length);
  assert.deepEqual(boardSeedV2(), boardSeedV2());
});

test("v3 seed: the two questions end with ASK; the job tasks name their job", () => {
  const s = boardSeedV2();
  for (const k of ["STH-19", "STH-22"]) assert.ok(byKey(s, k).description.endsWith("\n\nASK"), k);
  const jobs = { "STH-20": "sales/call-write-up", "STH-21": "sales/proposal-from-a-call", "STH-23": "marketing/five-concepts",
    "STH-24": "marketing/carousel-from-a-concept", "STH-25": "studio/an-animated-title-card" };
  for (const [k, job] of Object.entries(jobs)) {
    const d = byKey(s, k).description;
    assert.ok(d.endsWith(`\nJOB: ${job}`), k);
    assert.match(d, /\nProduce: .+ in the goal's sub-folder\.\n/, k);
    assert.ok(!d.includes("ASK"), k);
  }
  assert.ok(byKey(s, "STH-21").description.startsWith("FOR: Sales\n"));
  assert.ok(byKey(s, "STH-25").description.startsWith("FOR: Artist\n"));
  assert.ok(!byKey(s, "STH-24").description.startsWith("FOR:"));
});

test("v3 seed: STH-21 has a live run by Sales; STH-22 has none", () => {
  const s = boardSeedV2();
  const sales = IDS.agents.sales;
  assert.ok(s.liveRuns.some((r) => r.agentId === sales && r.issueId === IDS_V3.issues["STH-21"] && r.status === "running"));
  assert.ok(s.heartbeatRuns.some((r) => r.agentId === sales && r.issueId === IDS_V3.issues["STH-21"] && r.status === "running"));
  assert.ok(!s.liveRuns.some((r) => r.issueId === IDS_V3.issues["STH-22"]));
  assert.equal(s.agents.find((a) => a.name === "Sales").status, "running");
  assert.equal(s.liveRuns.length, 3);
});

test("v3 seed: passing rounds by the Checker on STH-20, STH-23, STH-24 and STH-25, with the scores on STH-23", () => {
  const s = boardSeedV2();
  const checker = IDS.agents.checker;
  for (const k of ["STH-20", "STH-23", "STH-24", "STH-25"]) {
    const checks = commentsOf(s, k).filter((c) => c.authorAgentId === checker && /^VERDICT:/.test(c.body));
    assert.equal(checks.length, 1, k);
    assert.match(checks[0].body, /^VERDICT: PASS - .+\n# Check: round 1\n/, k);
    assert.ok(checks[0].body.endsWith("\nVerdict: PASS"), k);
    assert.ok(commentsOf(s, k).some((c) => c.body.startsWith("RESULT:\n")), k);
  }
  const q2 = commentsOf(s, "STH-23").find((c) => c.authorAgentId === checker).body.split("\n").find((l) => l.startsWith("2. "));
  assert.match(q2, /^2\. Does every piece score at least 8 out of 10 against the brand file, with nothing from the can't-say list\? YES - scores: concept-1 9, concept-2 8;/);
  for (const k of ["STH-19", "STH-21", "STH-22"]) assert.ok(!commentsOf(s, k).some((c) => /^VERDICT:/.test(c.body)), k);
});

test("v3 seed: the home server's own parser reads each passing round as well formed, with six questions", () => {
  const s = boardSeedV2();
  const checker = IDS.agents.checker;
  const general = { 1: "Does the work do what the brief asked?", 5: "Is it free of anything sent, published or made final without the owner?", 6: "Could the owner use it as it is?" };
  for (const k of ["STH-20", "STH-23", "STH-24", "STH-25"]) {
    const body = commentsOf(s, k).find((c) => c.authorAgentId === checker && /^VERDICT:/.test(c.body)).body;
    const check = parseCheck(body);
    assert.deepEqual(check.problems, [], k);
    assert.equal(check.wellFormed, true, k);
    assert.equal(check.outcome, "pass", k);
    assert.equal(check.round, 1, k);
    assert.deepEqual(check.checks.map((q) => [q.n, q.answer]), [1, 2, 3, 4, 5, 6].map((n) => [n, "yes"]), k);
    for (const [n, question] of Object.entries(general)) assert.equal(check.checks[n - 1].question, question, `${k} question ${n}`);
    assert.deepEqual(check.actions, [], k);
    assert.deepEqual(check.unclear, [], k);
    // every evidence path is a file of the seed's goal folder
    for (const q of check.checks) for (const p of q.evidence) assert.ok(fs.statSync(path.join(work, k, p)).isFile(), `${k} question ${q.n}: ${p}`);
    assert.ok(check.checks.slice(0, 4).every((q) => q.evidence.length >= 1), k);
    // and the task has exactly that one round, by the Checker
    const rounds = roundsOf(commentsOf(s, k), checker);
    assert.deepEqual(rounds.map((r) => [r.n, r.outcome, r.wellFormed]), [[1, "pass", true]], k);
  }
  const second = parseCheck(commentsOf(s, "STH-23").find((c) => c.authorAgentId === checker).body).checks[1];
  assert.equal(second.question, "Does every piece score at least 8 out of 10 against the brand file, with nothing from the can't-say list?");
  assert.ok(second.reason.startsWith("scores: concept-1 9, concept-2 8;"), second.reason);
  assert.match(second.reason, /^scores:\s*((?:[a-z0-9-]{1,40} (?:10|[0-9])(?:, )?)+);/);
  // the version 2 rounds still read as before
  assert.deepEqual(roundsOf([...commentsOf(s, "STH-10"), ...commentsOf(s, "STH-12")], checker).map((r) => [r.outcome, r.wellFormed]), [["fail", true], ["pass", true]]);
});

test("v3 board: the new tasks are served and the next one made is STH-26", async () => {
  const b = await startStubBoard({ seed: boardSeedV2() });
  try {
    const one = await (await fetch(`${b.url}/api/issues/STH-24`)).json();
    assert.equal(one.id, IDS_V3.issues["STH-24"]);
    const made = await fetch(`${b.url}/api/companies/${IDS.company}/issues`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "New" }) });
    assert.equal((await made.json()).identifier, "STH-26");
  } finally { await b.close(); }
});

// ---- records

test("v3 records: decisions.json holds the ask:, template:, from: and asked: records", () => {
  const d = decisionsV3();
  const I = IDS_V3.issues;
  for (const k of ["STH-19", "STH-22"]) assert.ok(!Number.isNaN(Date.parse(d[`ask:${I[k]}`])), k);
  assert.equal(Object.keys(d).filter((k) => k.startsWith("ask:")).length, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith("template:"))), {
    [`template:${I["STH-20"]}`]: "sales/call-write-up", [`template:${I["STH-21"]}`]: "sales/proposal-from-a-call",
    [`template:${I["STH-23"]}`]: "marketing/five-concepts", [`template:${I["STH-24"]}`]: "marketing/carousel-from-a-concept",
    [`template:${I["STH-25"]}`]: "studio/an-animated-title-card",
  });
  assert.equal(d[`from:${I["STH-21"]}`], I["STH-20"]);
  assert.equal(d[`from:${I["STH-24"]}`], I["STH-23"]);
  assert.deepEqual(d[`asked:${I["STH-23"]}`], { answers: { subject: "Diwali offer", kind: "carousel" } });
  // accepted: STH-20 and STH-24; done but not accepted: STH-19, STH-23, STH-25
  for (const k of ["STH-20", "STH-24"]) assert.ok(d[`acknowledged:goal:${I[k]}`], k);
  for (const k of ["STH-19", "STH-23", "STH-25"]) assert.equal(d[`acknowledged:goal:${I[k]}`], undefined, k);
});

test("v3 state seed: copyStateSeedV2 adds the records to the version 2 decisions and lays down the files", () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uuu-seed-v3-")), "state");
  try {
    copyStateSeedV2(dest);
    const dec = JSON.parse(fs.readFileSync(path.join(dest, "home/decisions.json"), "utf8"));
    assert.ok(dec[`acknowledged:goal:${IDS_V3.issues["STH-14"]}`]);
    for (const [k, v] of Object.entries(decisionsV3())) assert.deepEqual(dec[k], v, k);
    for (const p of ["knowledge/docs/returns-policy.md", "knowledge/docs/payment-terms.md", "knowledge/docs/brand/brand.md",
      "knowledge/docs/brand/cant-say.md", "knowledge/docs/pricing/services.md", "knowledge/docs/company/about.md",
      "knowledge/docs/calls/2026-11-10-asha-kitchens.md", "knowledge/docs/references/sample.png", "knowledge/docs/packs/carousel.md",
      "tasks/company-work/STH-19/answer.md", "tasks/company-work/STH-20/call-write-up.md", "tasks/company-work/STH-23/concepts.md",
      "tasks/company-work/STH-24/slides/launch/manifest.json", "tasks/company-work/STH-25/video/title/title.mp4",
      "art/tools/slides.py", "art/tools/video.py", "media/models/ggml-small.en.bin", "media/room/site-visit.mp4", "art/venv/bin/python"]) {
      assert.ok(fs.existsSync(path.join(dest, p)), p);
    }
    // the version 2 file itself is untouched
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(here, "state-seed-v2/home/decisions.json"), "utf8"))).length, 1);
  } finally { fs.rmSync(path.dirname(dest), { recursive: true, force: true }); }
});

// ---- bench

test("v3 bench: Quotation lists a draft by the Bookkeeper and a final one; the permission row is there", async () => {
  const { b, get } = await bench();
  try {
    const fields = encodeURIComponent('["name","owner","docstatus","party_name","valid_till","grand_total"]');
    const list = (await get(BENCH_KEYS.owner, `/api/resource/Quotation?fields=${fields}&order_by=name%20asc`)).json.data;
    assert.deepEqual(list.map((q) => [q.name, q.owner, q.docstatus]), [
      ["SAL-QTN-2026-00001", "bookkeeper@engine.localhost", 0], ["SAL-QTN-2026-00002", "Administrator", 1],
    ]);
    assert.ok(list.every((q) => q.party_name && q.valid_till && q.grand_total > 0));
    const filters = encodeURIComponent(JSON.stringify([["parent", "=", "Quotation"], ["role", "=", "Engine Bookkeeper"]]));
    const rows = (await get(BENCH_KEYS.owner, `/api/resource/Custom%20DocPerm?filters=${filters}&fields=${encodeURIComponent('["parent","role","create","submit"]')}`)).json.data;
    assert.deepEqual(rows, [{ parent: "Quotation", role: "Engine Bookkeeper", create: 1, submit: 0 }]);
    // the Bookkeeper can read quotations, and cannot read the permission rows
    assert.equal((await get(BENCH_KEYS.bookkeeper, "/api/resource/Quotation")).status, 200);
    assert.equal((await get(BENCH_KEYS.bookkeeper, "/api/resource/Custom%20DocPerm")).status, 403);
    // a new draft takes the next name
    const res = await fetch(`${b.url}/api/resource/Quotation`, { method: "POST", headers: { authorization: `token ${BENCH_KEYS.bookkeeper}`, "content-type": "application/json" }, body: JSON.stringify({ party_name: "Asha Kitchens" }) });
    assert.equal((await res.json()).data.name, "SAL-QTN-2026-00003");
  } finally { await b.close(); }
});

test("v3 bench: with quotations: false the permission row is left out", async () => {
  const { b, get } = await bench({ quotations: false });
  try {
    const filters = encodeURIComponent(JSON.stringify([["parent", "=", "Quotation"], ["role", "=", "Engine Bookkeeper"]]));
    assert.deepEqual((await get(BENCH_KEYS.owner, `/api/resource/Custom%20DocPerm?filters=${filters}`)).json.data, []);
    assert.equal((await get(BENCH_KEYS.bookkeeper, "/api/resource/Quotation")).status, 403);
    assert.equal((await get(BENCH_KEYS.owner, "/api/resource/Quotation")).json.data.length, 2);
  } finally { await b.close(); }
});

// ---- files

test("v3 files: the slides are 1080 x 1350 PNGs, the contact sheet at most 2160 wide, the manifest agrees", () => {
  const dir = path.join(work, "STH-24", "slides", "launch");
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m), ["name", "title", "kind", "slides", "size", "data", "contact", "script", "made_at"]);
  assert.equal(m.kind, "slides");
  assert.deepEqual(m.slides, ["slide-01.png", "slide-02.png", "slide-03.png"]);
  for (const f of m.slides) assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, f))), { w: 1080, h: 1350 }, f);
  assert.deepEqual(m.size, { w: 1080, h: 1350 });
  const contact = pngSize(fs.readFileSync(path.join(dir, m.contact)));
  assert.ok(contact && contact.w <= 2160, "contact sheet");
  const data = JSON.parse(fs.readFileSync(path.join(dir, m.data), "utf8"));
  assert.deepEqual(data.slides.map((x) => [x.file, x.w, x.h]), m.slides.map((f) => [f, 1080, 1350]));
  assert.ok(data.slides.every((x) => typeof x.text === "string" && x.text.length <= 600));
  assert.ok(pngSize(fs.readFileSync(path.join(seed, "knowledge/docs/references/sample.png"))));
});

test("v3 files: the MP4 has ftyp at byte 4, is under 40 KB, and the poster is a PNG of its size", () => {
  const dir = path.join(work, "STH-25", "video", "title");
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m), ["name", "title", "kind", "video", "poster", "width", "height", "fps", "seconds", "bytes", "made_by", "script", "made_at"]);
  const mp4 = fs.readFileSync(path.join(dir, m.video));
  assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
  assert.ok(mp4.length < 40 * 1024);
  assert.equal(m.bytes, mp4.length);
  assert.deepEqual([m.width, m.height], [320, 180]);
  assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, m.poster))), { w: 320, h: 180 });
  const stills = fs.readdirSync(path.join(dir, "review")).sort();
  assert.deepEqual(stills, ["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png", "frame-05.png", "frame-06.png"]);
  for (const f of stills) assert.ok(pngSize(fs.readFileSync(path.join(dir, "review", f))).w <= 640, f);
});

test("v3 files: answer.md and concepts.md are in the forms of 33.5 and 36.1", () => {
  const answer = fs.readFileSync(path.join(work, "STH-19", "answer.md"), "utf8").trimEnd().split("\n");
  assert.equal(answer[0], "# Answer");
  assert.ok(answer.includes("## Sources") && answer.includes("## Not in the files"));
  const sources = answer.filter((l) => /^(\d{1,2})\.\s+(\S.*?)(?:\s+-\s+(.+))?$/.test(l));
  assert.deepEqual(sources, ["1. returns-policy.md - Returns", "2. policies/custom-orders.md"]);
  assert.ok(fs.existsSync(path.join(seed, "knowledge/docs/returns-policy.md")));
  assert.ok(!fs.existsSync(path.join(seed, "knowledge/docs/policies/custom-orders.md")));
  const concepts = fs.readFileSync(path.join(work, "STH-23", "concepts.md"), "utf8").trimEnd().split("\n");
  assert.equal(concepts[0], "# Concepts: Diwali offer");
  const heads = concepts.map((l, i) => [l, i]).filter(([l]) => /^## \d\. /.test(l));
  assert.deepEqual(heads.map(([l]) => l.slice(3, 5)), ["1.", "2.", "3.", "4.", "5."]);
  for (const [l, i] of heads) {
    assert.ok(l.length - 6 <= 80, l);
    assert.match(concepts[i + 1], /^angle: .+/);
    assert.match(concepts[i + 2], /^why: .+/);
  }
  assert.ok(fs.readFileSync(path.join(work, "STH-20", "call-write-up.md"), "utf8").startsWith("# Call write-up"));
});

test("v3 files: the brain's seed files, about.md not filled in, the four markers", () => {
  const docs = path.join(seed, "knowledge", "docs");
  const about = fs.readFileSync(path.join(docs, "company/about.md"), "utf8");
  assert.ok(about.split("\n").filter((l) => l.startsWith("## ")).length >= 3);
  assert.ok(about.split("\n").filter((l) => l && !l.startsWith("#")).every((l) => l === "(not filled in yet)"));
  const brand = fs.readFileSync(path.join(docs, "brand/brand.md"), "utf8");
  assert.ok(brand.startsWith("# Brand\n"));
  assert.match(brand, /^- #[0-9a-f]{6}$/m);
  assert.match(fs.readFileSync(path.join(docs, "pricing/services.md"), "utf8"), /^\| Name \| Unit \| Price \| Tax rate \| Tax code \|$/m);
  for (const f of ["brand/cant-say.md", "calls/2026-11-10-asha-kitchens.md", "packs/carousel.md"]) assert.ok(fs.statSync(path.join(docs, f)).size >= 40, f);
  for (const p of ["art/tools/slides.py", "art/tools/video.py", "media/models/ggml-small.en.bin"]) assert.equal(fs.statSync(path.join(seed, p)).size, 0, p);
  const room = fs.statSync(path.join(seed, "media/room/site-visit.mp4")).size;
  assert.ok(room > 0 && room < 100);
});
