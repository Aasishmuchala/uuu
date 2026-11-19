// The first security review's fixes on the seats (REVIEW-DESKTOP M1, L1): a seat's note may not be one of the
// owner's priced orders ("ANOTHER ROUND", "SHOTLIST ACCEPTED:"), on a task or with any inbox action; and a seat may
// not stop a job, or a task whose goal or step has a generation batch still open. The Mac's port is unchanged.
// Free ports from 3420 up, a temporary state.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { IDS } from "../../../test/stubs/seed.mjs";
import { readBatch } from "../../../generate/state.mjs";
import { createHome } from "../lib/app.mjs";
import { removeBatch, writeBatch } from "../lib/batches.mjs";
import { HomeError } from "../lib/errors.mjs";
import { LETTERS_ONLY, seatNoteError, seatNoteRefused, seatPorts } from "../lib/seats.mjs";
import boardSource from "../inbox/board.mjs";
import { stopHasPrice, stopTask } from "../lib/stop.mjs";
import { STUB_URLS, startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const I = IDS.issues;
const FP = `SHA256:${"B".repeat(43)}`;
const MAC_HOST = "127.0.0.1:3200";
const ORIGIN = "http://127.0.0.1:3200";
const HOUR = 3600_000;
const SHOTS = [{ id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5 }];
const DONE_GOAL = "goal:e0000000-0000-4000-8000-000000000002";
const SINV = "bench:Sales Invoice:ACC-SINV-2026-00001";

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
async function freeRow(from, to) {
  for (let p = from; p + 4 <= to; p++) {
    let ok = true;
    for (let i = 0; i < 5 && ok; i++) ok = await portFree(p + i);
    if (ok) return p;
  }
  throw new Error("no five free ports in a row");
}

let h;
let app;
let ports;

const seat = (n, role) => ({ n, name: "Windows PC", role, state: "allowed", fingerprint: FP, added: "2026-11-19T10:00:00.000Z" });
const onSeat = (n, method, path, opts = {}) => call(`http://127.0.0.1:${ports[n - 1]}`, method, path,
  { ...opts, headers: { host: MAC_HOST, ...(method === "GET" || method === "HEAD" ? {} : { origin: ORIGIN, "sec-fetch-site": "same-origin" }), ...(opts.headers || {}) } });
const boardWrites = () => h.board.requests.filter((r) => r.method !== "GET").length;
const benchWrites = () => h.bench.requests.filter((r) => r.method !== "GET").length;
const statusOf = (id) => h.board.state.issues.find((i) => i.id === id).status;
const doorSays = (id) => { const r = readBatch(app.config.paths.batches, id, { slug: "artist", now: Date.now() }); return r.ok ? "open" : r.why; };

before(async () => {
  // STH-3 came from a job: the home server's own record says so.
  h = await startStubsHome({ port: 0, decisions: { [`template:${I["STH-3"]}`]: "finance/reconcile" } });
  const first = await freeRow(3420, 3459);
  const config = { ...h.config, ports: { ...h.config.ports, seats: first }, remote: { seats: 5 } };
  app = await createHome({ config, urls: { ...STUB_URLS, board: h.config.urls.board, bench: h.config.urls.bench }, seats: true, log: () => {} });
  await app.listen(0);
  ports = seatPorts(config).map((s) => s.port);
  const dir = join(h.state, "remote");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "seats.json"), JSON.stringify({ seats: [seat(1, "desk")] }), { mode: 0o600 });
});
after(async () => {
  await app.close();
  await h.close();
});

test("seatNoteRefused: the two priced orders anywhere in the note, however dressed; never on the Mac", () => {
  const desk = { n: 1, role: "desk" };
  for (const note of [
    "ANOTHER ROUND", "ANOTHER ROUND\n\nmake three more", "another round please", "  \n\nANOTHER ROUND", "Another  Round",
    "**ANOTHER ROUND**", "> ANOTHER ROUND", "# ANOTHER ROUND", "`ANOTHER ROUND`", "​ANOTHER‍ ROUND", "ＡＮＯＴＨＥＲ ＲＯＵＮＤ",
    "\r\nANOTHER ROUND", " ANOTHER ROUND", "SHOTLIST ACCEPTED: a batch b0123456789abcdef0123", "shotlist accepted: b", "SHOTLIST\tACCEPTED:",
  ]) {
    assert.equal(seatNoteRefused(desk, note), true, JSON.stringify(note));
    assert.equal(seatNoteRefused(null, note), false, `the Mac: ${JSON.stringify(note)}`);
  }
  // The second look's cases (REVIEW-DESKTOP S1): other scripts, joiners, marks, digits, prefixes, and anywhere in the note.
  for (const note of [
    "\u0410NOTHER ROUND", "AN\u039fTHER R\u039fUND", "SHOTLIST \u0410CCEPTED: a batch 1234", "\u0430nother round",
    "ANOTHER-ROUND", "ANOTHER_ROUND", "ANOTHER. ROUND", "SHOTLIST-ACCEPTED: a batch 1234",
    "\u00c1NOTHER ROUND", "ANO\u0336THER ROUND", "\u1d00\u0274\u1d0f\u1d1b\u029c\u1d07\u0280 \u0280\u1d0f\u1d1c\u0274\u1d05", "AN0THER ROUND", "SHOT1IST ACCEPTED",
    "Owner: ANOTHER ROUND", "Re: ANOTHER ROUND", "1. ANOTHER ROUND", "<b>ANOTHER ROUND</b>",
    "Thanks.\nANOTHER ROUND\n\nmake three more", "Please do\nANOTHER ROUND", "Not another round yet",
    JSON.stringify({ answers: { q1: { optionIds: [], text: "ANOTHER ROUND" } } }),
  ]) {
    assert.equal(seatNoteRefused(desk, note), true, JSON.stringify(note));
    assert.equal(seatNoteRefused(null, note), false, `the Mac: ${JSON.stringify(note)}`);
  }
  for (const note of ["Make it warmer", "Another version, please, in the blue direction", "ANSWER: yes", "SHOTLIST READY:", "", "ANOTHER", "round"]) {
    assert.equal(seatNoteRefused(desk, note), false, JSON.stringify(note));
  }
  assert.equal(seatNoteRefused(desk, null), false);
});

// The third look's cases (REVIEW-DESKTOP T1): each is refused, either as an order or for its letters.
const T1_ORDERS = [
  // 1. JSON escapes in a question card's answer, decoded by JSON.parse before the board gets them
  '{"answers":{"q1":{"optionIds":[],"text":"\\u0041NOTHER ROUND"}}}',
  '{"answers":{"q1":{"optionIds":[],"text":"\\u0053HOTLIST ACCEPTED: a batch 1234"}}}',
  '{"answers":{"q1":{"optionIds":[],"text":"ANOTHER\\tROUND"}}}',
  // 2. the Hangul fillers
  "ANOTHERㅤROUND", "ANOㅤTHER ROUND", "ANOTHERᅟROUND", "ANOTHERᅠROUND", "ANOTHERﾠROUND",
  // 3. plain characters read as letters, an entity, and the words backwards behind a right-to-left override
  "@NOTHER ROUND", "AN()THER R()UND", "SHOT|IST ACCEPTED", "ANOTHER&nbsp;ROUND", "&#65;NOTHER ROUND", "‮DNUOR REHTONA",
  "‮DETPECCA TSILTOHS", "AN0THER R0UND", "SHOT1IST ACC3PTED",
];
const T1_LETTERS = [
  "ᎪNOTHER ROUND", "ANՕTHER RՕUND", "ANⲞTHER RⲞUND", "ꓮꓠꓳꓔꓧꓰꓣ ꓣꓳꓴꓠꓓ",
  "ANØTHER ROUND", "SHOTLIST ACCEPTEĐ", "ɑNOTHER ROUND", "SHOTLIST ACCЄPTED", "SHOTLIΣT ACCEPTED",
  "\u{1F150}\u{1F15D}\u{1F15E}\u{1F163}\u{1F157}\u{1F154}\u{1F161} \u{1F161}\u{1F15E}\u{1F164}\u{1F15D}\u{1F153}", "\u{1F170}NOTHER ROUND",
  "\u{1F1E6}NOTHER ROUND", "ANOTHER &Alpha; ROUND",
];

test("the third look's ways past the check are refused: decoded JSON, invisible letters, lookalikes, entities, reversed text (T1)", () => {
  const desk = { n: 1, role: "desk" };
  for (const note of T1_ORDERS) {
    const e = seatNoteError(desk, note);
    assert.ok(e, JSON.stringify(note));
    assert.equal(e.code, "mac_only", JSON.stringify(note));
    assert.equal(seatNoteError(null, note), null, `the Mac: ${JSON.stringify(note)}`);
  }
  for (const note of T1_LETTERS) {
    const e = seatNoteError(desk, note);
    assert.ok(e, JSON.stringify(note));
    assert.equal(e.code, "mac_only");
    assert.equal(e.message, LETTERS_ONLY, JSON.stringify(note));
    assert.equal(seatNoteError(null, note), null, `the Mac: ${JSON.stringify(note)}`);
  }
  // Plain English, with marks a keyboard makes, still goes through from a seat.
  for (const note of ["Make it warmer, please.", "Use the 2nd photo (the blue one) & crop 10%. Under $5?", "The café sign, naïve style", "SHOTLIST READY:"]) {
    assert.equal(seatNoteError(desk, note), null, JSON.stringify(note));
  }
});

test("a question card's answer from a seat is checked again as it is sent, before the board is asked (T1)", async () => {
  const posted = [];
  const ctx = {
    seat: { n: 1, role: "desk" }, board: { post: async (path) => { posted.push(path); return {}; } },
    decisions: { get: () => null, set: () => {} },
    item: { _raw: { sourceKind: "issue_thread_interaction", subject: { id: "i1", metadata: { interactionId: "i1", issueId: "x1" } },
      _questions: [{ id: "q1", mode: "text", allowText: true, required: true, options: [] }] } },
  };
  for (const note of [T1_ORDERS[0], T1_ORDERS[1], T1_ORDERS[2]]) {
    await assert.rejects(boardSource.act(ctx, "board:issue_thread_interaction:i1", "answer", note), (e) => e instanceof HomeError && e.code === "mac_only");
  }
  assert.deepEqual(posted, []);
  // The Mac's answer goes as before.
  await boardSource.act({ ...ctx, seat: null }, "board:issue_thread_interaction:i1", "answer", T1_ORDERS[0]);
  assert.deepEqual(posted, ["/api/issues/x1/interactions/i1/respond"]);
});

test("the same ways through Needs you on a seat's port: 403, nothing written (T1)", async () => {
  const items = (await onSeat(1, "GET", "/api/inbox")).json.items;
  const goal = items.find((i) => i.id === DONE_GOAL);
  assert.ok(goal);
  const n = boardWrites();
  for (const note of ["ANOTHERㅤROUND, three more", "Thanks.\nAN()THER R()UND", "ᎪNOTHER ROUND"]) {
    const r = await onSeat(1, "POST", "/api/inbox/act", { body: { id: DONE_GOAL, action: "reopen", note, version: goal.version } });
    assert.equal(r.status, 403, `${JSON.stringify(note)} ${r.text}`);
    assert.equal(r.json.error.code, "mac_only");
  }
  const letters = await onSeat(1, "POST", `/api/goals/${I["STH-1"]}/note`, { body: { text: "ᎪNOTHER ROUND" } });
  assert.equal(letters.status, 403);
  assert.equal(letters.json.error.message, LETTERS_ONLY);
  assert.equal(boardWrites(), n);
});

test("a desk seat's note on a task that orders another round or accepts a shot list: 403 mac_only, the board sees no write (M1)", async () => {
  for (const text of ["ANOTHER ROUND\n\nmake three more", "SHOTLIST ACCEPTED: a batch 1234", "  **Another round**",
    "Thanks.\nANOTHER ROUND\n\nmake three more", "\u0410NOTHER-R\u039fUND", "Re: SHOTLIST_ACCEPTED: a batch 1234"]) {
    const n = boardWrites();
    const r = await onSeat(1, "POST", `/api/goals/${I["STH-2"]}/note`, { body: { text } });
    assert.equal(r.status, 403, text);
    assert.equal(r.json.error.code, "mac_only", text);
    // A lookalike from another script is refused for its letters (T1), the rest as an order.
    assert.ok(["This is done on the Mac.", LETTERS_ONLY].includes(r.json.error.message), r.json.error.message);
    assert.equal(boardWrites(), n, text);
  }
  assert.equal(statusOf(I["STH-2"]), "done");
  // Any other note from the seat goes through as before.
  const ok = await onSeat(1, "POST", `/api/goals/${I["STH-1"]}/note`, { body: { text: "Use last year's prices for the hobs." } });
  assert.equal(ok.status, 200, ok.text);
});

test("the same orders in the note of an inbox action a desk seat may take: 403 mac_only, nothing written (M1)", async () => {
  const items = (await onSeat(1, "GET", "/api/inbox")).json.items;
  const goal = items.find((i) => i.id === DONE_GOAL);
  const sinv = items.find((i) => i.id === SINV);
  assert.ok(goal && sinv, "the seeded items are listed");
  const nb = boardWrites();
  const nbench = benchWrites();
  const reopen = await onSeat(1, "POST", "/api/inbox/act", { body: { id: DONE_GOAL, action: "reopen", note: "ANOTHER ROUND\n\nmake three more", version: goal.version } });
  assert.equal(reopen.status, 403, reopen.text);
  assert.equal(reopen.json.error.code, "mac_only");
  const back = await onSeat(1, "POST", "/api/inbox/act", { body: { id: SINV, action: "send_back", note: "SHOTLIST ACCEPTED: a batch 1234", version: sinv.version } });
  assert.equal(back.status, 403, back.text);
  assert.equal(back.json.error.code, "mac_only");
  assert.equal(boardWrites(), nb);
  assert.equal(benchWrites(), nbench);
  assert.equal(statusOf(I["STH-2"]), "done");
});

test("the Mac's own port still takes the same note (M1 leaves the owner's port unchanged)", async () => {
  const n = boardWrites();
  const r = await call(app.url, "POST", `/api/goals/${I["STH-1"]}/note`, { body: { text: "ANOTHER ROUND\n\nmake three more" } });
  assert.equal(r.status, 200, r.text);
  assert.ok(boardWrites() > n);
});

test("a desk seat may not stop a job, nor a task whose step has a generation batch open; it may stop one with neither (L1)", async () => {
  const job = await onSeat(1, "POST", `/api/goals/${I["STH-3"]}/stop`, { body: {} });
  assert.equal(job.status, 403, job.text);
  assert.equal(job.json.error.code, "mac_only");
  assert.equal(statusOf(I["STH-3"]), "blocked");

  const batch = writeBatch(app.config, { task: I["STH-4"], shots: SHOTS, takes: 2, now: Date.now() - HOUR }).id;
  try {
    const n = boardWrites();
    const film = await onSeat(1, "POST", `/api/goals/${I["STH-1"]}/stop`, { body: {} });
    assert.equal(film.status, 403, film.text);
    assert.equal(film.json.error.code, "mac_only");
    assert.equal(boardWrites(), n);
    assert.equal(statusOf(I["STH-1"]), "in_progress");
    assert.equal(doorSays(batch), "open", "the owner's approval is left as it was");
  } finally {
    removeBatch(app.config, batch);
  }
  const plain = await onSeat(1, "POST", `/api/goals/${I["STH-1"]}/stop`, { body: {} });
  assert.equal(plain.status, 200, plain.text);
  assert.equal(statusOf(I["STH-1"]), "cancelled");
  // The Mac stops a job as before.
  const mac = await call(app.url, "POST", `/api/goals/${I["STH-3"]}/stop`, { body: {} });
  assert.equal(mac.status, 200, mac.text);
  assert.equal(statusOf(I["STH-3"]), "cancelled");
});

test("stopTask refuses a seat before the board is asked, for every place that offers Stop (L1)", async () => {
  const asked = [];
  const board = { patch: async (p) => { asked.push(p); return {}; }, get: async (p) => { asked.push(p); return {}; } };
  const records = { [`template:${I["STH-3"]}`]: "finance/reconcile" };
  const decisions = { get: (k) => (Object.hasOwn(records, k) ? records[k] : null) };
  const issues = [{ id: I["STH-3"], identifier: "STH-3", status: "blocked", description: "Reconcile." },
    { id: I["STH-1"], identifier: "STH-1", status: "in_progress", description: "Write it.\n\nJOB: marketing/price-list" }];
  const ctx = { seat: { n: 1, role: "desk" }, board, decisions, config: app.config, log: () => {} };
  for (const id of [I["STH-3"], I["STH-1"]]) {
    await assert.rejects(stopTask(ctx, id, { issues }), (e) => e instanceof HomeError && e.code === "mac_only");
  }
  assert.deepEqual(asked, []);
  assert.equal(stopHasPrice({ decisions, config: app.config }, issues[1], [I["STH-1"]]), true, "a JOB line counts too");
  assert.equal(stopHasPrice({ decisions, config: app.config }, null, [I["STH-5"]]), false);
});
