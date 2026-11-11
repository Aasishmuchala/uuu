// V53, the live Support trial, pinned against the stub bench: the records exactly as the live books made them
// (a request named "0002", a reply comment with a random name and no `commented_by`), the reply under Needs you
// and on the Support page, approving it writes nothing to the books, and the role tells Support where the
// customer's words are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPLY = "Dear Meera, thank you for writing in, and I am sorry to hear your delivery has not arrived yet. I understand this is frustrating. I am checking with our delivery team now to find out what has happened, and I will come back to you as soon as I have an update. Thank you for your patience.";
const ID = "bench:HD Ticket Comment:vvqrh2cqsm";

// The two records of the trial, field for field as the live books answered.
function liveSeed() {
  const s = benchSeed();
  s.docs["HD Ticket"].push({
    doctype: "HD Ticket", name: "0002", owner: "Administrator", docstatus: 0, subject: "Trial request (delete me)",
    raised_by: "meera.trial@example.invalid", status: "Open", creation: "2026-11-11 07:11:35.542476", modified: "2026-11-11 07:11:35.652464",
  });
  s.docs["HD Ticket Comment"].push({
    doctype: "HD Ticket Comment", name: "vvqrh2cqsm", owner: "support@engine.localhost", docstatus: 0, reference_ticket: "0002",
    commented_by: null, content: `DRAFT REPLY: ${REPLY}`, creation: "2026-11-11 07:32:52.261551", modified: "2026-11-11 07:32:52.261551",
  });
  return s;
}

const page = async (h) => (await call(h.url, "GET", "/api/departments/support")).json;
const sec = (p, id) => p.sections.find((s) => s.id === id);

test("a live-shaped reply shows under Needs you and on the Support page", async () => {
  const h = await startStubsHome({ port: 0, benchSeed: liveSeed() });
  try {
    const item = (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.id === ID);
    assert.ok(item, "the reply is under Needs you");
    assert.equal(item.source, "support");
    assert.equal(item.kind, "draft");
    assert.equal(item.raisedBy, "Support");
    assert.equal(item.title, "Reply to request 0002");
    assert.equal(item.version, "2026-11-11 07:32:52.261551");
    assert.deepEqual(item.details, [{ label: "Request", value: "#0002" }, { label: "Reply", value: REPLY }]);

    const p = await page(h);
    assert.equal(p.connected, true);
    const row = sec(p, "draft_replies").rows.find((r) => r.inboxId === ID);
    assert.equal(row.request, "#0002 Trial request (delete me)");
    assert.equal(row.reply.length, 140);
    assert.ok(REPLY.startsWith(row.reply.slice(0, -1)));
    assert.ok(sec(p, "open_requests").rows.some((r) => r.subject === "Trial request (delete me)" && r.from === "meera.trial@example.invalid"));
  } finally {
    await h.close();
  }
});

test("approving the reply records it only: nothing is written to the books and the message says sending is off", async () => {
  const h = await startStubsHome({ port: 0, benchSeed: liveSeed() });
  try {
    const before = h.bench.requests.length;
    const r = await actAsSeen(h.url, { id: ID, action: "approve" });
    assert.equal(r.status, 200);
    assert.match(r.json.message, /Sending is switched off, so nothing was sent/);
    assert.deepEqual(h.bench.requests.slice(before).filter((q) => q.method !== "GET").map((q) => `${q.method} ${q.path}`), []);
    assert.equal((await call(h.url, "GET", "/api/inbox")).json.items.some((i) => i.id === ID), false);
    const p = await page(h);
    assert.equal(sec(p, "draft_replies").rows.some((x) => x.inboxId === ID), false);
    assert.equal((await actAsSeen(h.url, { id: ID, action: "approve", version: "2026-11-11 07:32:52.261551" })).status, 409);
  } finally {
    await h.close();
  }
});

test("the Support role reads the customer's words: its example read asks for the description", () => {
  const role = readFileSync(join(ENGINE_DIR, "company", "roles", "support.md"), "utf8");
  const example = role.split("\n").find((l) => l.includes("/api/resource/HD%20Ticket?fields="));
  assert.ok(example, "the role has an example read of requests");
  assert.match(example, /\\"description\\"/);
  assert.match(role, /customer's own words are in `description`/);
});
