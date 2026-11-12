// The company brain's new file and readiness (CONTRACTS-V3 30 "Files", 32.3, 32.4, 33.6): the pure parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FORM_NOTE, NewFile, STALE, checkNew, cleanName, draftKey, fieldOfMessage, formTarget, limitFor, newHref, parseMode, refusalOf, requestFor,
} from "../../brain/new-file.js";
import { Readiness, readinessOf } from "../../brain/readiness.js";

const LIMITS = { imageBytes: 10485760, textBytes: 2097152, endings: [".md", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"] };
const BRAND = {
  id: "brand", folder: "brand", file: "brand.md", title: "Brand",
  fields: [
    { id: "tone", label: "Three to five words for how you sound", kind: "list", required: true, max: 5 },
    { id: "colours", label: "Your colours", kind: "colour", required: true, max: 5 },
  ],
};

test("brain: both modules load in Node and export their components", () => {
  assert.equal(typeof NewFile, "function");
  assert.equal(typeof Readiness, "function");
});

test("brain: the modes of the address", () => {
  assert.deepEqual(parseMode("paste"), { kind: "paste", form: null });
  assert.deepEqual(parseMode("upload"), { kind: "upload", form: null });
  assert.deepEqual(parseMode("form"), { kind: "form", form: null });
  assert.deepEqual(parseMode("form:cant-say"), { kind: "form", form: "cant-say" });
  for (const bad of ["", "form:", "form:../x", "form:Brand", "delete", null, 3]) assert.equal(parseMode(bad), null, String(bad));
  assert.equal(newHref("paste", "calls"), "#/files/calls?new=paste");
  assert.equal(newHref("form:brand"), "#/files?new=form:brand");
  assert.equal(newHref("nothing", "nowhere"), "#/files");
});

test("brain: which folder a form saves to", () => {
  assert.deepEqual(formTarget(BRAND), { folder: "brand", file: "brand.md", path: "brand/brand.md" });
  // Without a sound folder and file of its own, the pinned table of 32.3 decides.
  assert.deepEqual(formTarget({ id: "services" }), { folder: "pricing", file: "services.md", path: "pricing/services.md" });
  assert.deepEqual(formTarget(null, "team"), { folder: "people", file: "team.md", path: "people/team.md" });
  assert.deepEqual(formTarget({ id: "refunds", folder: "../etc", file: "x.md" }), { folder: "policies", file: "refunds.md", path: "policies/refunds.md" });
  assert.deepEqual(formTarget({ id: "about", folder: "company", file: "../about.md" }).path, "company/about.md");
  assert.equal(formTarget({ id: "unknown" }), null);
});

test("brain: what is sent for pasted text", () => {
  const r = requestFor("paste", { folder: "calls", name: "Call with a new customer", text: "Wants a kitchen." });
  assert.deepEqual(r, { method: "POST", path: "/api/brain/files", body: { folder: "calls", name: "Call with a new customer.md", text: "Wants a kitchen." } });
  assert.equal(requestFor("paste", { folder: "pricing", name: "prices.csv", text: "a,b" }).body.name, "prices.csv");
});

test("brain: what is sent for a file, and for a form with its version", () => {
  const up = requestFor("upload", { folder: "references", name: "logo.png", base64: "iVBORw0KGgo=", size: 8 });
  assert.deepEqual(up, { method: "POST", path: "/api/brain/files", body: { folder: "references", name: "logo.png", base64: "iVBORw0KGgo=" } });
  assert.ok(!("text" in up.body));
  const f = requestFor("form:brand", { values: { tone: ["warm"] }, version: 1794472200000 });
  assert.deepEqual(f, { method: "POST", path: "/api/brain/forms/brand", body: { values: { tone: ["warm"] }, version: "1794472200000" } });
  assert.equal(requestFor("form:brand", { values: {} }).body.version, null, "a form never saved is sent without a version");
  assert.equal(requestFor("form", {}), null, "the list of forms sends nothing");
  assert.equal(requestFor("bad", {}), null);
});

test("brain: names are made safe before they are sent", () => {
  assert.equal(cleanName("  ../secret/notes  "), "secret notes.md");
  assert.equal(cleanName(".hidden"), "hidden.md");
  assert.equal(cleanName("photo.JPG", "upload"), "photo.JPG");
  assert.equal(cleanName(""), "");
  const long = cleanName(`${"a".repeat(150)}.csv`);
  assert.equal(long.length, 100);
  assert.ok(long.endsWith(".csv"));
});

test("brain: a stale version shows the pinned sentence and keeps the answers", () => {
  const r = refusalOf({ code: "changed_since_seen", message: "Something else", status: 409 }, "form", BRAND);
  assert.equal(r.message, STALE);
  assert.equal(STALE, "This changed after you looked at it. Nothing was done.");
  assert.equal(r.stale, true);
  assert.equal(r.field, null);
  assert.match(r.next, /answers are still here/);
});

test("brain: every other refusal is shown in the server's words beside its field", () => {
  const exists = refusalOf({ code: "file_exists", message: "A file of that name is already there." }, "paste");
  assert.deepEqual([exists.field, exists.message], ["name", "A file of that name is already there."]);
  assert.equal(refusalOf({ code: "kind_mismatch", message: "That file is not what its name says." }, "upload").field, "file");
  assert.equal(refusalOf({ code: "too_large", message: "Too large." }, "upload").field, "file");
  assert.equal(refusalOf({ code: "folder_not_found", message: "No such folder." }, "paste").field, "folder");
  const full = refusalOf({ code: "brain_full", message: "The company brain is full.", next: "Delete a file first." }, "upload");
  assert.deepEqual([full.field, full.message, full.next], [null, "The company brain is full.", "Delete a file first."]);
  const bad = refusalOf({ code: "bad_value", message: "Your colours: write each as # and six letters." }, "form", BRAND);
  assert.deepEqual([bad.field, bad.message], ["colours", "Your colours: write each as # and six letters."]);
  assert.equal(fieldOfMessage(BRAND, "Something else is wrong."), null);
  assert.equal(refusalOf({ code: "offline", message: "The engine is not answering." }, "form", BRAND).field, null);
});

test("brain: what is checked before anything is sent", () => {
  assert.deepEqual(checkNew("paste", { folder: "calls", name: "a", text: "b" }, LIMITS), {});
  assert.deepEqual(Object.keys(checkNew("paste", { folder: "nowhere", name: "", text: " " }, LIMITS)).sort(), ["folder", "name", "text"]);
  assert.match(checkNew("paste", { folder: "calls", name: "a", text: "x".repeat(2097153) }, LIMITS).text, /too long/);
  assert.deepEqual(Object.keys(checkNew("upload", { folder: "brand" }, LIMITS)), ["file"]);
  assert.match(checkNew("upload", { folder: "brand", name: "a.md", pickedName: "a.md", base64: "eA==", size: 3000000 }, LIMITS).file, /too large/);
  assert.deepEqual(checkNew("upload", { folder: "brand", name: "a.png", pickedName: "a.png", base64: "eA==", size: 3000000 }, LIMITS), {});
  assert.equal(limitFor("table.csv", LIMITS), 2097152);
  assert.equal(limitFor("scan.pdf", LIMITS), 10485760);
});

test("brain: drafts are kept per flow, and per folder for text and files", () => {
  assert.equal(draftKey("form:brand", "calls"), "uuu.brain.new.form:brand");
  assert.equal(draftKey("paste", "calls"), "uuu.brain.new.paste:calls");
  assert.equal(draftKey("paste"), "uuu.brain.new.paste:");
  assert.notEqual(draftKey("upload", "calls"), draftKey("paste", "calls"));
  assert.equal(draftKey("nothing"), null);
});

test("brain: the readiness count from the shape", () => {
  const brain = {
    basics: {
      filled: 2, total: 9,
      items: [
        { form: "about", title: "About the company", file: "company/about.md", state: "filled", token: "Y29tcGFueS9hYm91dC5tZA" },
        { form: "brand", title: "Brand", file: "brand/brand.md", state: "filled" },
        { form: "terms", title: "Terms", file: "pricing/terms.md", state: "empty" },
        { form: "team", title: "Team", file: "people/team.md", state: "missing" },
      ],
    },
  };
  const r = readinessOf(brain);
  assert.equal(r.filled, 2);
  assert.equal(r.total, 9);
  assert.equal(r.label, "2 of 9 basics filled");
  assert.deepEqual(r.items.map((i) => i.action), ["Filled", "Filled", "Fill it in", "Fill it in"]);
  assert.equal(r.items[0].href, "#/files?file=Y29tcGFueS9hYm91dC5tZA");
  assert.equal(r.items[1].href, "#/files?file=YnJhbmQvYnJhbmQubWQ", "a missing token is made from the file's path");
  assert.equal(r.items[2].href, "#/files?new=form:terms");
  assert.equal(r.items[3].state, "missing");
});

test("brain: readiness without rows, and with a broken shape", () => {
  assert.deepEqual(readinessOf({ basics: { filled: 4, total: 9 } }), { filled: 4, total: 9, label: "4 of 9 basics filled", items: [] });
  assert.equal(readinessOf(null).label, "0 of 9 basics filled");
  assert.equal(readinessOf({ basics: { filled: "lots", total: -1 } }).label, "0 of 9 basics filled");
  const odd = readinessOf({ basics: { items: [{ form: "../x", state: "filled" }, { form: "brand", state: "filled", title: "<b>Brand</b>" }] } });
  assert.equal(odd.items.length, 1);
  assert.equal(odd.items[0].title, "<b>Brand</b>", "a title is kept as text, to be shown as text");
});

test("brain: the form's note, and nothing drawn from raw HTML", () => {
  assert.equal(FORM_NOTE, "Only you know these facts. Agents never fill them in.");
  for (const f of ["../../brain/new-file.js", "../../brain/readiness.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML/);
    assert.doesNotMatch(src, /https?:\/\//);
  }
});
