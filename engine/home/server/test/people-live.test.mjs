// What the live People trial (V54) taught.
// 1. The books keep a leave request as a draft with no holiday list anywhere, but refuse to make it final
//    (HRMS on_submit asks for the person's or the company's holiday list), so the owner's Approve fails.
//    People must look first and tell the owner before the owner tries to approve.
// 2. The Checker cannot reach the system of record, so a report alone failed the first check round.
//    People must leave a read-back of each record in the goal's folder for the Checker to read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roles = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "company", "roles");
const people = readFileSync(join(roles, "people.md"), "utf8");

test("people: looks for a holiday list before leave and tells the owner when there is none", () => {
  assert.ok(people.includes("`holiday_list`") && people.includes("`default_holiday_list`"), "both fields named");
  assert.ok(people.includes("The owner must set a holiday list before this leave can be approved."));
  assert.ok(people.includes("Do not make a holiday list yourself."));
});

test("people: leaves a read-back of each record for the Checker, without private details", () => {
  assert.ok(people.includes("The Checker cannot reach the system of record."));
  assert.ok(people.includes("`readback-<name>.md`"));
  assert.ok(people.includes("with no private details"));
});

test("people: still never submits, and the staged text is still folded in", () => {
  assert.ok(people.includes("Never submit, cancel or delete anything there."));
  assert.ok(people.split("\n").some((l) => l.trim() === "{{STAGED}}"));
});
