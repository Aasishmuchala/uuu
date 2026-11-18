// The fixture of PLAN-BRAIN B7: five brain files and the records B3 makes from the stub bench's
// seed (plus one Contact), written into an index by the DDL by hand, without the indexer. Every
// test of retrieval, indexing, notes and the door starts from this. "Today" is 2026-11-18, so the
// seed's dates are: older 2026-10-04, today 2026-11-18, later 2026-12-18.
import { chmodSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DDL } from "../schema.mjs";

export const BUILT_AT = "2026-11-18T06:00:00.000Z";
export const BASICS = ["pricing/services.md"];

export const FILES = Object.freeze({
  "pricing/services.md": "# Services\n## Site visit\nPrice: ₹2,500 per visit. Free for Acme Interiors until 2026-03-31.\n## Design package\nPrice: ₹40,000. Delivery in three weeks.\n",
  "policies/refunds.md": "# Refunds\nRefund window: 7 days.\n\nRefunds are paid within seven days.\n",
  "policies/terms.md": "# Terms\nRefund window: 14 days.\n",
  "calls/acme-call.md": "# Call with Ravi Menon, Acme Interiors\nWe promised Acme Interiors the drawings by Friday and a 10 percent discount on renewals.\n",
  "people/team.md": "# Team\nPriya Nair runs the workshop.\n",
});

// The passages B4 cuts from FILES, with the files' times and the names each one mentions.
const FILE_PASSAGES = [
  { source: "pricing/services.md", title: "Services", locator: "Services > Site visit", ord: 0, text: "Price: ₹2,500 per visit. Free for Acme Interiors until 2026-03-31.", at: "2026-11-01T09:00:00.000Z", mentions: ["customer:Acme Interiors"] },
  { source: "pricing/services.md", title: "Services", locator: "Services > Design package", ord: 1, text: "Price: ₹40,000. Delivery in three weeks.", at: "2026-11-01T09:00:00.000Z", mentions: [] },
  { source: "policies/refunds.md", title: "Refunds", locator: "Refunds", ord: 0, text: "Refund window: 7 days.\n\nRefunds are paid within seven days.", at: "2026-10-20T09:00:00.000Z", mentions: [] },
  { source: "policies/terms.md", title: "Terms", locator: "Terms", ord: 0, text: "Refund window: 14 days.", at: "2026-10-21T09:00:00.000Z", mentions: [] },
  { source: "calls/acme-call.md", title: "Call with Ravi Menon, Acme Interiors", locator: "Call with Ravi Menon, Acme Interiors", ord: 0, text: "We promised Acme Interiors the drawings by Friday and a 10 percent discount on renewals.", at: "2026-11-15T09:00:00.000Z", mentions: ["customer:Acme Interiors", "person:Ravi Menon"] },
  { source: "people/team.md", title: "Team", locator: "Team", ord: 0, text: "Priya Nair runs the workshop.", at: "2026-09-01T09:00:00.000Z", mentions: ["person:HR-EMP-00001"] },
];

const REC_AT = "2026-11-18T05:00:00.000Z";
const rec = (doctype, id, title, text, entity, links = []) => ({
  doctype, id, passage: { source: `books:${doctype}:${id}`, title, text, at: REC_AT }, entity, links,
});
const ent = (type, id, name, aliases = []) => ({ type, key: `${type}:${id}`, name, aliases });

// In the shape of T3's `pullRecords(ctx).records`.
export const RECORDS = Object.freeze([
  rec("Customer", "Acme Interiors", "Acme Interiors",
    "Customer: Acme Interiors. Invoices: 2. Billed: ₹ 75,000.00. Unpaid: ₹ 0.00. Deals: 1.",
    ent("customer", "Acme Interiors", "Acme Interiors", ["acme interiors"])),
  rec("Customer", "Northwind Traders", "Northwind Traders",
    "Customer: Northwind Traders. Invoices: 1. Billed: ₹ 1,18,000.00. Unpaid: ₹ 1,18,000.00. Deals: 0.",
    ent("customer", "Northwind Traders", "Northwind Traders", ["northwind traders"])),
  rec("Sales Invoice", "ACC-SINV-2026-00003", "Invoice ACC-SINV-2026-00003",
    "Invoice ACC-SINV-2026-00003 for Acme Interiors. Date: 2026-10-04. Total: ₹ 50,000.00. Unpaid: ₹ 0.00. Status: Paid.",
    ent("invoice", "ACC-SINV-2026-00003", "ACC-SINV-2026-00003"), [{ type: "invoice_of", toKey: "customer:Acme Interiors" }]),
  rec("Sales Invoice", "ACC-SINV-2026-00004", "Invoice ACC-SINV-2026-00004",
    "Invoice ACC-SINV-2026-00004 for Northwind Traders. Date: 2026-11-18. Total: ₹ 1,18,000.00. Unpaid: ₹ 1,18,000.00. Status: Unpaid.",
    ent("invoice", "ACC-SINV-2026-00004", "ACC-SINV-2026-00004"), [{ type: "invoice_of", toKey: "customer:Northwind Traders" }]),
  rec("Sales Invoice", "ACC-SINV-2026-00005", "Invoice ACC-SINV-2026-00005",
    "Invoice ACC-SINV-2026-00005 for Acme Interiors. Date: 2026-11-18. Total: ₹ 25,000.00. Unpaid: ₹ 0.00. Status: Paid.",
    ent("invoice", "ACC-SINV-2026-00005", "ACC-SINV-2026-00005"), [{ type: "invoice_of", toKey: "customer:Acme Interiors" }]),
  rec("CRM Deal", "CRM-DEAL-2026-00001", "Deal CRM-DEAL-2026-00001",
    "Deal CRM-DEAL-2026-00001. Stage: Qualification. Value: ₹ 2,50,000.00.", null),
  rec("CRM Deal", "CRM-DEAL-2026-00002", "Deal CRM-DEAL-2026-00002",
    "Deal CRM-DEAL-2026-00002 with Acme Interiors. Stage: Won. Value: ₹ 90,000.00.",
    ent("deal", "CRM-DEAL-2026-00002", "CRM-DEAL-2026-00002"), [{ type: "deal_of", toKey: "customer:Acme Interiors" }]),
  rec("HD Ticket", "1", "Support request 1", "Support request 1. Status: Open.", null),
  rec("HD Ticket", "2", "Support request 2", "Support request 2. Status: Open.", null),
  rec("HD Ticket", "3", "Support request 3", "Support request 3. Status: Closed.", null),
  rec("Contact", "Ravi Menon", "Ravi Menon", "Contact: Ravi Menon of Acme Interiors.",
    ent("person", "Ravi Menon", "Ravi Menon", ["ravi menon"]), [{ type: "contact_of", toKey: "customer:Acme Interiors" }]),
  rec("Employee", "HR-EMP-00001", "Priya Nair", "Staff: Priya Nair, Carpenter.", ent("person", "HR-EMP-00001", "Priya Nair", ["priya nair"])),
  rec("Employee", "HR-EMP-00002", "Rohan Das", "Staff: Rohan Das, Designer.", ent("person", "HR-EMP-00002", "Rohan Das", ["rohan das"])),
  rec("Employee", "HR-EMP-00003", "Sana Khan", "Staff: Sana Khan, Accountant.", ent("person", "HR-EMP-00003", "Sana Khan", ["sana khan"])),
]);

// A row of a trust no reader knows. It matches the fixture's questions on purpose; it must never
// come back from `ask`, `entityView` or a not-found count.
export const PLANTED = Object.freeze({
  kind: "file", trust: "outside", source: "outside/planted.md", title: "Planted", locator: "Planted", ord: 0,
  text: "PLANTED ROW: we promised Acme Interiors refunds, a warranty and Ravi a zebra quantum.", at: "2026-11-18T07:00:00.000Z",
  mentions: ["customer:Acme Interiors"],
});

// Writes the fixture index to `file` (replacing it), mode 0600, journal DELETE, closed.
// Returns the passage ids by "<source>#<ord>" and the entity ids by key.
export function buildFixtureIndex(file) {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  const passages = {};
  const entities = {};
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    for (const s of DDL) db.exec(s);
    db.exec("BEGIN");
    const insP = db.prepare("INSERT INTO passages (kind, trust, source, title, locator, ord, text, at, entity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insF = db.prepare("INSERT INTO fts (rowid, title, text) VALUES (?, ?, ?)");
    const insE = db.prepare("INSERT INTO entities (type, key, name) VALUES (?, ?, ?)");
    const insA = db.prepare("INSERT INTO aliases (entity, alias) VALUES (?, ?)");
    const insL = db.prepare("INSERT INTO links (src, dst, type) VALUES (?, ?, ?)");
    const insM = db.prepare("INSERT INTO mentions (passage, entity) VALUES (?, ?)");
    const passage = (p, kind, trust, entity) => {
      const id = Number(insP.run(kind, trust, p.source, p.title, p.locator ?? "", p.ord ?? 0, p.text, p.at ?? null, entity ?? null).lastInsertRowid);
      insF.run(id, p.title, p.text);
      passages[`${p.source}#${p.ord ?? 0}`] = id;
      return id;
    };

    for (const r of RECORDS) {
      if (!r.entity) continue;
      entities[r.entity.key] = Number(insE.run(r.entity.type, r.entity.key, r.entity.name).lastInsertRowid);
      for (const a of r.entity.aliases) insA.run(entities[r.entity.key], a);
    }
    for (const r of RECORDS) {
      passage(r.passage, "record", "books", r.entity ? entities[r.entity.key] : null);
      for (const l of r.links) insL.run(entities[r.entity.key], entities[l.toKey], l.type);
    }
    for (const p of [...FILE_PASSAGES, { ...PLANTED }]) {
      const id = passage(p, p.kind ?? "file", p.trust ?? "owner", null);
      for (const k of p.mentions) insM.run(id, entities[k]);
    }

    const counts = { files: Object.keys(FILES).length, records: RECORDS.length, passages: FILE_PASSAGES.length + RECORDS.length };
    const meta = {
      builtAt: BUILT_AT, fingerprint: "0".repeat(64), books: "ok", booksAt: BUILT_AT,
      files: String(counts.files), records: String(counts.records), passages: String(counts.passages),
      leftOut: "0", truncated: "[]", basics: JSON.stringify(BASICS),
    };
    const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  chmodSync(file, 0o600);
  return { file, passages, entities };
}
