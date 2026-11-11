import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "./board.mjs";
import { boardSeed, boardSeedV2, copyStateSeedV2, IDS, IDS_V2 } from "./seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = IDS.company;
const seedV2 = path.join(here, "state-seed-v2");

async function call(base, method, p, { body, headers = {} } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
}
const agentHeaders = { authorization: `Bearer ${IDS.tokens.builder}` };
const DAILY = IDS_V2.routines["daily-brief"], WEEKLY = IDS_V2.routines["weekly-content-plan"];

// ---- board routes

test("v2 board: the routines of the seed list with their triggers and last run", async () => {
  const b = await startStubBoard({ seed: boardSeedV2() });
  try {
    const list = (await call(b.url, "GET", `/api/companies/${C}/routines`)).json;
    assert.deepEqual(list.map((r) => [r.id, r.status]), [[DAILY, "paused"], [WEEKLY, "active"]]);
    const [daily, weekly] = list;
    for (const k of ["id", "title", "description", "assigneeAgentId", "projectId", "status", "triggers", "lastRun"]) assert.ok(k in daily, k);
    assert.equal(daily.triggers[0].cronExpression, "0 9 * * *");
    assert.equal(daily.triggers[0].label, "Daily at 09:00");
    assert.equal(daily.lastRun.status, "issue_created");
    assert.equal(daily.lastRun.linkedIssue.identifier, "STH-14");
    assert.ok(daily.description.endsWith("ROUTINE: daily-brief"));
    assert.equal(weekly.lastRun, null);
    assert.equal(weekly.triggers[0].nextRunAt, "2026-11-16T04:30:00.000Z");
    assert.ok(weekly.description.startsWith("FOR: Marketer\n"));
    const one = (await call(b.url, "GET", `/api/routines/${DAILY}`)).json;
    assert.equal(one.recentRuns.length, 1);
    const runs = (await call(b.url, "GET", `/api/routines/${DAILY}/runs?limit=5`)).json;
    assert.equal(runs[0].linkedIssueId, IDS_V2.issues["STH-14"]);
    assert.deepEqual((await call(b.url, "GET", `/api/routines/${WEEKLY}/runs`)).json, []);
    assert.equal((await call(b.url, "GET", `/api/routines/nope`)).status, 404);
    assert.ok(Array.isArray(b.state.routines) && Array.isArray(b.state.routineTriggers) && Array.isArray(b.state.routineRuns));
  } finally { await b.close(); }
});

test("v2 board: creating routines and triggers, patching both", async () => {
  const b = await startStubBoard({ seed: boardSeedV2() });
  try {
    const body = { title: "Weekly price check", description: "FOR: Sales\nCheck prices.", assigneeAgentId: IDS.agents["chief-of-staff"], projectId: IDS.project, priority: "medium", status: "paused", concurrencyPolicy: "skip_if_active", catchUpPolicy: "skip_missed" };
    assert.equal((await call(b.url, "POST", `/api/companies/${C}/routines`, { body: {} })).status, 400);
    const made = await call(b.url, "POST", `/api/companies/${C}/routines`, { body });
    assert.equal(made.status, 201);
    assert.equal(made.json.status, "paused");
    assert.deepEqual(made.json.triggers, []);
    const id = made.json.id;
    const t = await call(b.url, "POST", `/api/routines/${id}/triggers`, { body: { kind: "schedule", cronExpression: "0 8 * * 1", timezone: "Asia/Kolkata", label: "Mondays at 08:00", enabled: true } });
    assert.equal(t.status, 201);
    assert.equal(t.json.cronExpression, "0 8 * * 1");
    assert.equal((await call(b.url, "POST", `/api/routines/${id}/triggers`, { body: { kind: "webhook" } })).status, 400);
    const pt = await call(b.url, "PATCH", `/api/routine-triggers/${t.json.id}`, { body: { label: "Mondays at 08:30", cronExpression: "30 8 * * 1" } });
    assert.equal(pt.json.label, "Mondays at 08:30");
    assert.equal((await call(b.url, "PATCH", `/api/routine-triggers/nope`, { body: {} })).status, 404);
    const p = await call(b.url, "PATCH", `/api/routines/${id}`, { body: { status: "active", title: "Weekly price review" } });
    assert.equal(p.json.status, "active");
    assert.equal(p.json.title, "Weekly price review");
    assert.equal(p.json.triggers[0].cronExpression, "30 8 * * 1");
    assert.equal((await call(b.url, "PATCH", `/api/routines/${id}`, { body: { status: "sleeping" } })).status, 400);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/routines`)).json.length, 3);
  } finally { await b.close(); }
});

test("v2 board: every routine write is owner only", async () => {
  const b = await startStubBoard({ seed: boardSeedV2() });
  try {
    const t = IDS_V2.issues["STH-1"];
    assert.ok(t);
    for (const [m, p, body] of [
      ["POST", `/api/companies/${C}/routines`, { title: "x" }],
      ["PATCH", `/api/routines/${DAILY}`, { status: "active" }],
      ["POST", `/api/routines/${DAILY}/triggers`, { kind: "schedule", cronExpression: "0 9 * * *" }],
      ["PATCH", `/api/routine-triggers/71000000-0000-4000-8000-000000000001`, { enabled: false }],
      ["POST", `/api/routines/${DAILY}/run`, {}],
    ]) assert.equal((await call(b.url, m, p, { body, headers: agentHeaders })).status, 403, `${m} ${p}`);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/routines`, { headers: agentHeaders })).status, 200);
    assert.equal(b.state.routineRuns.length, 1);
  } finally { await b.close(); }
});

test("v2 board: a manual run makes a task, a run and a wake; an archived routine refuses", async () => {
  const b = await startStubBoard({ seed: boardSeedV2() });
  try {
    const r = await call(b.url, "POST", `/api/routines/${WEEKLY}/run`, { body: {} });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "issue_created");
    assert.equal(r.json.source, "manual");
    assert.equal(r.json.linkedIssue.identifier, "STH-26");
    const issue = (await call(b.url, "GET", `/api/issues/STH-26`)).json;
    assert.equal(issue.title, "Weekly content plan");
    assert.equal(issue.originKind, "routine_execution");
    assert.equal(issue.originId, WEEKLY);
    assert.equal(issue.assigneeAgentId, IDS.agents["chief-of-staff"]);
    assert.equal(issue.projectId, IDS.project);
    assert.ok(issue.description.endsWith("ROUTINE: weekly-content-plan"));
    assert.deepEqual(b.state.wakes.map((w) => [w.agentId, w.reason]), [[IDS.agents["chief-of-staff"], "assigned"]]);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/routines`)).json.find((x) => x.id === WEEKLY).lastRun.linkedIssueId, issue.id);
    // a paused routine still runs by hand
    assert.equal((await call(b.url, "POST", `/api/routines/${DAILY}/run`, { body: {} })).status, 201);
    await call(b.url, "PATCH", `/api/routines/${WEEKLY}`, { body: { status: "archived" } });
    assert.equal((await call(b.url, "POST", `/api/routines/${WEEKLY}/run`, { body: {} })).status, 409);
    assert.equal(b.state.routineRuns.length, 3);
    // an ordinary task may carry the origin keys and times
    const made = await call(b.url, "POST", `/api/companies/${C}/issues`, { body: { title: "T", originKind: "routine_execution", originId: DAILY, startedAt: "2026-11-11T01:00:00.000Z" } });
    assert.equal(made.json.originId, DAILY);
    assert.equal(made.json.startedAt, "2026-11-11T01:00:00.000Z");
  } finally { await b.close(); }
});

test("v2 board: version 1 seed and its numbers are unchanged", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    assert.equal(b.state.agents.length, 9);
    assert.equal(b.state.issues.length, 6);
    assert.deepEqual(b.state.routines, []);
    assert.equal((await call(b.url, "POST", `/api/companies/${C}/issues`, { body: { title: "New" } })).json.identifier, "STH-7");
    assert.equal("originKind" in (await call(b.url, "GET", "/api/issues/STH-1")).json, false);
  } finally { await b.close(); }
});

// ---- board seed

test("v2 seed: ten agents with the artist, and every role has something happening", () => {
  const s = boardSeedV2();
  assert.equal(s.agents.length, 10);
  const artist = s.agents.find((a) => a.name === "Artist");
  assert.equal(artist.id, "a0000000-0000-4000-8000-000000000010");
  assert.equal(artist.status, "idle");
  assert.equal(artist.role, "designer");
  assert.equal(artist.reportsTo, IDS.agents["chief-of-staff"]);
  assert.equal(s.agents.find((a) => a.name === "Marketer").status, "running");
  for (const a of s.agents) {
    assert.ok(s.heartbeatRuns.some((r) => r.agentId === a.id), `${a.name} has a run`);
    assert.ok(s.memberGrants[a.membershipId].length > 0);
    assert.ok(s.instructions[a.id]);
  }
  assert.equal(s.companies[0].issueCounter, 25);
  assert.equal(s.attention.length, 4);
  assert.equal(s.liveRuns.length, 3);
  assert.ok(s.liveRuns.some((r) => r.agentId === IDS.agents.marketer && r.issueId === IDS_V2.issues["STH-16"]));
});

const byKey = (s, key) => s.issues.find((i) => i.identifier === key);
const commentsOf = (s, key) => s.comments.filter((c) => c.issueId === IDS_V2.issues[key]);

test("v2 seed: STH-7 to STH-18 are in the states section 22 lists", () => {
  const s = boardSeedV2();
  const want = {
    "STH-7": ["blocked", "Open a second showroom page on the website"], "STH-8": ["done", "Make a walking sprite for the mascot"],
    "STH-9": ["done"], "STH-10": ["done"], "STH-11": ["done"], "STH-12": ["done"], "STH-13": ["blocked", "Plan the Diwali offer"],
    "STH-14": ["done", "Daily brief"], "STH-15": ["in_progress", "Write three captions for the showroom photos"], "STH-16": ["in_progress"],
    "STH-17": ["cancelled", "Old idea: a paper catalogue"], "STH-18": ["blocked", "Reprice the kitchen range"],
  };
  for (const [k, [status, title]] of Object.entries(want)) {
    const i = byKey(s, k);
    assert.equal(i.status, status, k);
    if (title) assert.equal(i.title, title, k);
    assert.equal(i.id, IDS_V2.issues[k]);
  }
  assert.equal(new Set(s.issues.map((i) => i.id)).size, s.issues.length);
  assert.equal(new Set(s.comments.map((c) => c.id)).size, s.comments.length);
  assert.ok(byKey(s, "STH-7").description.endsWith("\nPLAN FIRST"));
  assert.ok(byKey(s, "STH-15").description.startsWith("FOR: Marketer\n"));
  assert.ok(byKey(s, "STH-14").description.endsWith("ROUTINE: daily-brief"));
  assert.equal(byKey(s, "STH-14").originKind, "routine_execution");
  assert.equal(byKey(s, "STH-14").originId, DAILY);
  const parent = (k, p, who) => { assert.equal(byKey(s, k).parentId, IDS_V2.issues[p], k); assert.equal(byKey(s, k).assigneeAgentId, IDS_V2.agents[who], k); };
  parent("STH-9", "STH-8", "artist"); parent("STH-10", "STH-8", "checker"); parent("STH-11", "STH-8", "artist");
  parent("STH-12", "STH-8", "checker"); parent("STH-16", "STH-15", "marketer");
  for (const i of s.issues) { assert.ok(!i.completedAt || i.startedAt, i.identifier); }
  assert.ok(byKey(s, "STH-8").completedAt);
});

test("v2 seed: comments carry the markers of section 15.1", () => {
  const s = boardSeedV2();
  const chief = IDS.agents["chief-of-staff"];
  const first = (k) => commentsOf(s, k)[0];
  for (const [k, re] of [["STH-7", /^SIZE: M - .+/], ["STH-8", /^SIZE: M - .+/], ["STH-13", /^SIZE: L - .+/]]) {
    assert.match(first(k).body, re, k);
    assert.equal(first(k).authorAgentId, chief);
  }
  assert.ok(commentsOf(s, "STH-7").some((c) => /^PLAN READY: .+/.test(c.body)));
  assert.ok(commentsOf(s, "STH-8").some((c) => /^RESULT:\n.+/.test(c.body)));
  const stopped = commentsOf(s, "STH-18");
  assert.equal(stopped.filter((c) => c.body.startsWith("VERDICT: FAIL - ")).length, 5);
  assert.equal(stopped.filter((c) => c.body.startsWith("VERDICT: PASS")).length, 0);
  assert.equal(stopped.at(-1).body.split("\n")[0], "STOPPED: five check rounds did not pass");
  assert.equal(stopped.at(-1).authorAgentId, chief);
});

// The parser of section 15.5, as a test helper.
function parseCheck(text) {
  const lines = text.split("\n");
  const q = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([1-6])\.\s+(.+\?)\s+(YES|NO)\s+-\s+(.+)$/.exec(lines[i]);
    if (m) q.push({ n: +m[1], answer: m[3], evidence: /^\s+evidence:\s*(.+)$/.exec(lines[i + 1] || "")?.[1].split(",").map((x) => x.trim()) ?? [] });
  }
  return { q, first: lines[0], last: lines.at(-1), sections: lines.filter((l) => l.startsWith("## ")) };
}

test("v2 seed: STH-8 has two check rounds in the tree, FAIL then PASS, in the format of 15.5", () => {
  const s = boardSeedV2();
  const tree = new Set(["STH-8", "STH-9", "STH-10", "STH-11", "STH-12"].map((k) => IDS_V2.issues[k]));
  const rounds = s.comments.filter((c) => tree.has(c.issueId) && c.body.startsWith("VERDICT:"));
  assert.equal(rounds.length, 2);
  const [r1, r2] = rounds.map((c) => parseCheck(c.body));
  assert.match(r1.first, /^VERDICT: FAIL - .+/);
  assert.match(r2.first, /^VERDICT: PASS - .+/);
  assert.equal(r1.last, "Verdict: FAIL");
  assert.equal(r2.last, "Verdict: PASS");
  for (const r of [r1, r2]) {
    assert.deepEqual(r.q.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(r.sections, ["## Questions", "## Actions", "## Anything unclear"]);
  }
  assert.ok(r1.q.some((x) => x.answer === "NO"));
  assert.ok(r2.q.every((x) => x.answer === "YES"));
  assert.match(rounds[0].body, /4\. Do the exported frames equal the tagged frame ranges\?/);
  assert.equal(rounds[0].authorAgentId, IDS.agents.checker);
  assert.ok(rounds[0].createdAt < rounds[1].createdAt);
  // every evidence path of the checks exists in the seed's goal folder
  for (const r of [r1, r2]) for (const x of r.q) for (const e of x.evidence) assert.ok(fs.existsSync(path.join(seedV2, "tasks/company-work/STH-8", e)), e);
});

// ---- state seed

const goalDir = (k) => path.join(seedV2, "tasks/company-work", k);
const readSections = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const out = {};
  let cur = null;
  for (const l of text.split("\n").slice(1)) { if (l.startsWith("## ")) { cur = l.slice(3); out[cur] = []; } else if (cur) out[cur].push(l); }
  return { title: text.split("\n")[0], sections: out };
};

test("v2 state seed: the staged documents have the exact headings of 15.2 to 15.4", () => {
  const brief = ["The goal in the owner's words", "What done looks like", "Must-haves", "Nice-to-haves", "Anything unclear"];
  for (const k of ["STH-7", "STH-8", "STH-13"]) {
    const d = readSections(path.join(goalDir(k), "00-brief.md"));
    assert.match(d.title, /^# Brief: .+/);
    assert.deepEqual(Object.keys(d.sections), brief, k);
  }
  const unclear = (k) => readSections(path.join(goalDir(k), "00-brief.md")).sections["Anything unclear"].map((l) => l.replace(/^- /, "")).filter((l) => l.trim());
  assert.deepEqual(unclear("STH-7"), ["None."]);
  assert.equal(unclear("STH-13").length, 2);
  for (const k of ["STH-7", "STH-8"]) {
    const d = readSections(path.join(goalDir(k), "01-plan.md"));
    assert.match(d.title, /^# Plan: .+/);
    assert.deepEqual(Object.keys(d.sections), ["Approach", "What will be produced", "Steps", "Anything unclear"], k);
  }
  const steps = (k) => {
    const lines = readSections(path.join(goalDir(k), "01-plan.md")).sections.Steps.filter((l) => l.trim());
    const out = [];
    for (const l of lines) {
      const m = /^(\d+)\.\s+(.+?)\s+-\s+(.+)$/.exec(l);
      if (m) out.push({ n: +m[1], who: m[3] }); else assert.match(l, /^\s+needs:\s*(.+)$/);
    }
    return out;
  };
  assert.deepEqual(steps("STH-7").map((x) => x.who), ["Marketer", "Artist", "Checker"]);
  assert.deepEqual(steps("STH-8").map((x) => x.who), ["Artist", "Checker"]);
  const sum = readSections(path.join(goalDir("STH-8"), "04-summary.md"));
  assert.match(sum.title, /^# Summary: .+/);
  assert.deepEqual(Object.keys(sum.sections), ["What was done", "Files", "What is left"]);
  for (const l of sum.sections.Files.filter((x) => x.trim())) {
    const m = /^- (\S+): .+/.exec(l);
    assert.ok(m, l);
    assert.ok(fs.existsSync(path.join(goalDir("STH-8"), m[1])), m[1]);
  }
  assert.equal(fs.existsSync(path.join(goalDir("STH-13"), "01-plan.md")), false);
});

test("v2 state seed: brief.md has a fixed date and three items with by: and about:", () => {
  const lines = fs.readFileSync(path.join(goalDir("STH-14"), "brief.md"), "utf8").split("\n");
  assert.equal(lines[0], "# Daily brief: 2026-11-11");
  const heads = lines.map((l, i) => (l.startsWith("## ") ? i : -1)).filter((i) => i >= 0);
  assert.equal(heads.length, 3);
  for (const i of heads) {
    assert.match(lines[i + 1], /^by: (Marketer|Bookkeeper|Support|Chief of staff)$/);
    assert.match(lines[i + 2], /^about: (STH-\d+|books|customers|support|people|marketing|studio|general|company)$/);
    assert.ok(lines[i + 3].trim().length > 0);
  }
  assert.match(lines.join("\n"), /₹1,18,000/);
});

function sniffPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
// gifFrameCount as pinned in 17.8.
function gifFrames(buf) {
  if (!/^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return null;
  let p = 13;
  if (buf[10] & 0x80) p += 3 * (1 << ((buf[10] & 7) + 1));
  const skip = () => { while (buf[p] !== 0) { if (p >= buf.length) return false; p += buf[p] + 1; } p += 1; return true; };
  let n = 0;
  for (;;) {
    if (p >= buf.length) return null;
    const b = buf[p];
    if (b === 0x3b) return n;
    if (b === 0x21) { p += 2; if (!skip()) return null; }
    else if (b === 0x2c) {
      n++;
      const flags = buf[p + 9];
      p += 10;
      if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
      p += 1;
      if (!skip()) return null;
    } else return null;
  }
}

test("v2 state seed: the walker sprite is on disk in the pinned layout", () => {
  const dir = path.join(goalDir("STH-8"), "art/walker");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", "walker-sheet.png", "walker.gif", "walker.json", "walker.py"]);
  const png = fs.readFileSync(path.join(dir, "walker-sheet.png"));
  assert.deepEqual(sniffPng(png), { w: 64, h: 16 });
  assert.ok(png.length < 2000);
  // decode the pixels: four frames, only four or five flat colours
  const raw = zlib.inflateSync(Buffer.concat((() => {
    const out = []; let p = 8;
    while (p < png.length) { const len = png.readUInt32BE(p); if (png.toString("ascii", p + 4, p + 8) === "IDAT") out.push(png.subarray(p + 8, p + 8 + len)); p += len + 12; }
    return out;
  })()));
  assert.equal(raw.length, (64 * 4 + 1) * 16);
  const colours = new Set();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) {
    const o = y * 257 + 1 + x * 4;
    if (raw[o + 3] === 255) colours.add(raw.subarray(o, o + 3).toString("hex"));
  }
  assert.ok(colours.size >= 4 && colours.size <= 5, `colours ${colours.size}`);
  const frameHash = (f) => { let h = ""; for (let y = 0; y < 16; y++) h += raw.subarray(y * 257 + 1 + f * 64, y * 257 + 1 + f * 64 + 64).toString("hex"); return h; };
  assert.equal(new Set([0, 1, 2, 3].map(frameHash)).size, 4, "four different frames");
  const gif = fs.readFileSync(path.join(dir, "walker.gif"));
  assert.equal(gifFrames(gif), 4);
  assert.equal(gifFrames(gif.subarray(0, 30)), null);
  assert.equal(gif.readUInt16LE(6), 1);
  assert.ok(fs.readFileSync(path.join(dir, "walker.py"), "utf8").split("\n").length >= 3);

  const data = JSON.parse(fs.readFileSync(path.join(dir, "walker.json"), "utf8"));
  assert.deepEqual(Object.keys(data), ["frames", "meta"]);
  assert.equal(data.frames.length, 4);
  data.frames.forEach((f, n) => {
    assert.deepEqual(f.frame, { x: n * 16, y: 0, w: 16, h: 16 });
    assert.deepEqual(f.sourceSize, { w: 16, h: 16 });
    assert.equal(f.rotated, false); assert.equal(f.trimmed, false);
    assert.ok(f.duration >= 10 && f.duration <= 60000);
  });
  assert.equal(data.meta.image, "walker-sheet.png");
  assert.deepEqual(data.meta.size, { w: 64, h: 16 });
  assert.deepEqual(data.meta.frameTags, [{ name: "walk", from: 0, to: 3, direction: "forward" }]);

  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m), ["name", "title", "kind", "sheet", "data", "gif", "frames", "frameSize", "tags", "palette", "script", "made_at"]);
  assert.equal(m.kind, "sprite"); assert.equal(m.frames, 4); assert.deepEqual(m.tags, ["walk"]);
  assert.deepEqual(m.frameSize, { w: 16, h: 16 });
  assert.deepEqual([...m.palette].sort(), [...colours].map((c) => "#" + c).sort());
  assert.match(m.made_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("v2 state seed: ids, decisions, lessons and the two installed marks", () => {
  const ids = JSON.parse(fs.readFileSync(path.join(seedV2, "ids.json"), "utf8"));
  assert.deepEqual(ids.agents, IDS_V2.agents);
  assert.deepEqual(ids.routines, IDS_V2.routines);
  assert.equal(ids.companyId, IDS.company);
  // the version 1 ids.json is untouched
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(here, "state-seed/ids.json"), "utf8")).agents).length, 9);
  const dec = JSON.parse(fs.readFileSync(path.join(seedV2, "home/decisions.json"), "utf8"));
  assert.deepEqual(Object.keys(dec), [`acknowledged:goal:${IDS_V2.issues["STH-14"]}`]);
  assert.ok(!Number.isNaN(Date.parse(Object.values(dec)[0])));
  for (const f of ["chief-of-staff", "marketer"]) {
    const lines = fs.readFileSync(path.join(seedV2, "lessons", `${f}.md`), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^- \d{4}-\d{2}-\d{2}: .+/);
  }
  for (const p of ["cad/venv/bin/python", "art/venv/bin/python"]) assert.equal(fs.statSync(path.join(seedV2, p)).size, 0, p);
});

test("v2 state seed: copyStateSeedV2 lays version 2 over version 1 and fills in the state path", () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uuu-seed-v2-")), "state");
  try {
    copyStateSeedV2(dest);
    const ids = JSON.parse(fs.readFileSync(path.join(dest, "ids.json"), "utf8"));
    assert.equal(ids.projectFolder, `${dest}/tasks/company-work`);
    assert.equal(ids.agents.artist, IDS_V2.agents.artist);
    for (const p of ["knowledge/docs/payment-terms.md", "lessons/builder.md", "lessons/marketer.md", "proof/last.json",
      "tasks/company-work/STH-2/cad/bracket.step", "tasks/company-work/STH-8/art/walker/manifest.json", "art/venv/bin/python"]) {
      assert.ok(fs.existsSync(path.join(dest, p)), p);
    }
  } finally { fs.rmSync(path.dirname(dest), { recursive: true, force: true }); }
});

test("v2 seed: dates and amounts are stable from run to run", () => {
  assert.deepEqual(boardSeedV2(), boardSeedV2());
  const text = JSON.stringify(boardSeedV2());
  assert.ok(text.includes("₹"));
  assert.ok(!/Date\.now|undefined/.test(text));
});
