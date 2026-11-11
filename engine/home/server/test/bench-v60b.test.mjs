// V60b: plain words in Needs you (role names, leave, the books' own refusal) and the Customers notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { agentRef, leaveText, refusalText } from "../inbox/bench.mjs";
import { plainLines, plainSummary } from "../inbox/goals.mjs";
import { validationReason } from "../lib/bench.mjs";
import { noteLine } from "../routes/customers.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}
const LEAVE = "bench:Leave Application:HR-LAP-2026-00001";

test("agentRef: all ten agents as the company file names them", () => {
  const ten = ["Chief of staff", "Builder", "Checker", "Bookkeeper", "Sales", "Support", "People", "Marketer", "Drafter", "Artist"];
  const want = ["The Chief of staff", "The Builder", "The Checker", "The Bookkeeper", "Sales", "Support", "People", "The Marketer", "The Drafter", "The Artist"];
  assert.deepEqual(ten.map((n) => agentRef(n)), want);
  assert.equal(agentRef("Checker", { start: false }), "the Checker");
  assert.equal(agentRef("People", { start: false }), "People");
});

test("leaveText: type and dates", () => {
  assert.equal(leaveText("Casual Leave", "2026-11-14", "2026-11-15", 2026), "Casual Leave, 14 to 15 November");
  assert.equal(leaveText("Casual Leave", "2026-11-14", "2026-11-14", 2026), "Casual Leave, 14 November");
  assert.equal(leaveText("Sick Leave", "2026-11-30", "2026-12-02", 2026), "Sick Leave, 30 November to 2 December");
  assert.equal(leaveText("", "2027-01-04", "2027-01-05", 2026), "4 to 5 January 2027");
});

test("validationReason: plain words from the real answer's shape", () => {
  const msg = "<b>No Holiday_List</b> found for <a href='/x'>HR-EMP-00001</a>&nbsp;or company.<br>Traceback (most recent call last):\n File \"x.py\"";
  const body = { exception: "frappe.exceptions.ValidationError: x", _server_messages: JSON.stringify([JSON.stringify({ message: msg })]) };
  const r = validationReason(body);
  assert.equal(r, "No Holiday List found for HR-EMP-00001 or company.");
  assert.doesNotMatch(r, /[<>_]|Traceback|File|417/);
  assert.equal(validationReason({ exception: "frappe.exceptions.ValidationError: Rate is wrong\nTraceback (most recent call last):" }), "Rate is wrong");
  assert.equal(validationReason(null), "");
});

test("refusalText: leave names the holiday list, others carry the books' words", () => {
  assert.match(refusalText("Leave Application", "No Holiday List found").message, /needs a holiday list in the books\. The draft is kept\./);
  assert.match(refusalText("Sales Invoice", "Rate is wrong").message, /Rate is wrong/);
  assert.doesNotMatch(refusalText("Sales Invoice", "").message, /Try again in a minute/);
});

test("approve refused by the books: the reason and the draft is kept", async () => {
  await withHome(async (h) => {
    h.bench.state.submitRefusals["Leave Application"] = "Please set a <b>Holiday_List</b> for the company";
    await call(h.url, "GET", "/api/inbox");
    const r = await actAsSeen(h.url, { id: LEAVE, action: "approve" });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /holiday list in the books/);
    assert.match(r.json.error.message, /draft is kept/);
    assert.doesNotMatch(JSON.stringify(r.json), /417|Traceback|minute/);
    assert.equal(h.bench.state.docs["Leave Application"][0].docstatus, 0);
  });
});

test("a leave item shows type and dates, not Status; summaries use the right names", async () => {
  const s = benchSeed();
  const l = s.docs["Leave Application"][0];
  l.leave_type = "Casual Leave"; l.from_date = "2026-11-14"; l.to_date = "2026-11-15";
  await withHome(async (h) => {
    const items = (await call(h.url, "GET", "/api/inbox")).json.items;
    const leave = items.find((i) => i.id === LEAVE);
    assert.ok(!leave.details.some((d) => d.label === "Status"));
    assert.deepEqual(leave.details.find((d) => d.label === "Leave"), { label: "Leave", value: "Casual Leave, 14 to 15 November" });
    assert.match(leave.summary, /^People made a draft leave request/);
    assert.match(items.find((i) => i.source === "support").summary, /^Support wrote a reply/);
  }, { benchSeed: s });
});

test("plainSummary: marks removed, words kept", () => {
  const md = "## Done\n\nI wrote **three** files in `STH-1/`:\n\n- the [brief](http://x/y)\n- a *plan*\n\n| Name | Size |\n|---|---|\n| a.md | 2 |\n\n```\ncode\n```";
  const out = plainSummary(md);
  assert.equal(out, "Done. I wrote three files in STH-1/: the brief. a plan. Name, Size. a.md, 2. code");
  assert.doesNotMatch(out, /[`*|#\[\]]|- /);
  assert.equal(plainSummary(""), "");
});

test("plainLines: marks removed, lines kept, list items as bullets", () => {
  const md = "## Lead recorded; one field refused\n\nRecorded the **trial** lead.\n\n\n- `DRAFT: CRM Lead CRM-LEAD-1` - Asha\n1. a [note](http://x)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n```\nx\n```\n---";
  const out = plainLines(md);
  assert.equal(out, "Lead recorded; one field refused\n\nRecorded the trial lead.\n\n• DRAFT: CRM Lead CRM-LEAD-1 - Asha\n• a note\n\nA, B\n1, 2\nx");
  assert.doesNotMatch(out, /[`*|#\[\]]|^- /m);
  assert.equal(plainLines(""), "");
});

test("noteLine: first line, plain, about 120 characters", () => {
  assert.equal(noteLine("<div><p>Asked for a call on <b>Friday</b></p><p>second</p></div>"), "Asked for a call on Friday");
  const long = noteLine(`<p>${"word ".repeat(60)}</p>`);
  assert.ok(long.length <= 120 && long.endsWith("…"));
  assert.equal(noteLine("", "A title"), "A title");
});

test("customers: notes and open follow-ups per lead; nothing shown when there are none", async () => {
  await withHome(async (h) => {
    const none = (await call(h.url, "GET", "/api/departments/customers")).json;
    assert.ok(!none.sections.some((x) => x.id === "lead_notes"));
    const lead = h.bench.state.docs["CRM Lead"].find((l) => l.converted === 0);
    const doc = (doctype, extra) => ({ doctype, owner: "sales@engine.localhost", docstatus: 0, reference_doctype: "CRM Lead", reference_docname: lead.name, ...extra });
    h.bench.state.docs["FCRM Note"] = [
      doc("FCRM Note", { name: "N1", title: "old", content: "<p>Old note</p>", creation: "2026-11-01 10:00:00" }),
      doc("FCRM Note", { name: "N2", title: "new", content: "<p>Call back on Friday</p><p>more</p>", creation: "2026-11-10 10:00:00" }),
    ];
    h.bench.state.docs["CRM Task"] = [
      doc("CRM Task", { name: "T1", status: "Todo", creation: "2026-11-10 10:00:00" }),
      doc("CRM Task", { name: "T2", status: "Done", creation: "2026-11-10 10:00:00" }),
    ];
    const p = (await call(h.url, "GET", "/api/departments/customers")).json;
    const s = p.sections.find((x) => x.id === "lead_notes");
    assert.equal(s.rows.length, 1);
    assert.deepEqual(s.rows[0], { name: lead.lead_name || lead.name, follow_ups: "1 open follow-up", notes: "2 notes", latest: "Call back on Friday" });
    assert.equal(p.sections.find((x) => x.id === "leads").rows.length, 4);
  });
});
