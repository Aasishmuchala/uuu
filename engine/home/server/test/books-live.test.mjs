// What the live Books trial (V51) taught.
// The Checker cannot open the books, so on the first trial invoice it failed round 1 on the Bookkeeper's
// report alone ("could not verify the invoice in the books"). It passed round 2 only after the Bookkeeper
// wrote the invoice, as read from the books, into the goal's folder. The Bookkeeper now does that at once.
// On the trial bill the Checker failed round 1 because the read-back did not say that nothing was paid,
// so the read-back now says whether a payment is recorded.
// The Books page's doctype and field names were right against the live books (no change to routes/books.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roles = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "company", "roles");
const bookkeeper = readFileSync(join(roles, "bookkeeper.md"), "utf8");

test("bookkeeper: leaves a read-back of each draft for the Checker, and rewrites it when the draft changes", () => {
  assert.ok(bookkeeper.includes("The Checker cannot open the books."));
  assert.ok(bookkeeper.includes("`readback-<draft name>.md`"));
  for (const what of ["GST status", "HSN or SAC code", "each tax head", "the totals", "`docstatus`", "whether any payment is recorded"]) {
    assert.ok(bookkeeper.includes(what), `read-back names ${what}`);
  }
  assert.ok(bookkeeper.includes("Rewrite that file each time the draft changes"));
});

test("bookkeeper: the list of its part is still numbered 1 to 7 and still keeps drafts only", () => {
  const part = bookkeeper.split("### Your part")[1].split("\n## ")[0];
  const numbers = part.split("\n").map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(bookkeeper.includes("Work in the system of record only as drafts. Never submit, cancel, amend or delete anything there."));
  assert.ok(bookkeeper.split("\n").some((l) => l.trim() === "{{STAGED}}"));
});
