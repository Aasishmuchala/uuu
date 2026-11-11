// What the live Customers trial (V52) taught. The CRM shows Sales only the leads and deals it owns
// (crm.permissions.org_hierarchy: `lead_owner` / `deal_owner`), so a lead made without its owner set is
// lost to Sales at once: it cannot read it, qualify it or move it to another stage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roles = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "company", "roles");
const sales = readFileSync(join(roles, "sales.md"), "utf8");

test("sales: told to own every lead and deal it makes, in the create call", () => {
  assert.ok(sales.includes('"lead_owner": "sales@engine.localhost"'), "lead_owner");
  assert.ok(sales.includes('"deal_owner": "sales@engine.localhost"'), "deal_owner");
});

test("sales: never asks the owner for more rights, never makes test records", () => {
  assert.ok(sales.includes("Never ask the owner to give you more rights"));
  assert.ok(sales.includes("Never make test records"));
});
