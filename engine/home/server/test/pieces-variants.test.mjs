// PLAN-V5 K7, K9: a task's versions on disk (lib/variants.mjs), read as hostile files. No home: a temp
// project folder stands in for tasks/company-work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftBody, placeOf, previewOf, readVariants } from "../lib/variants.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);

function withGoal(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-pieces-v-"));
  const project = join(root, "company-work");
  const goal = join(project, "STH-12");
  mkdirSync(goal, { recursive: true });
  const config = { paths: { projectFolder: project, state: root } };
  try { return fn({ root, project, goal, config, at: (...p) => join(goal, ...p) }); } finally { rmSync(root, { recursive: true, force: true }); }
}

const VARIANTS = { kind: "carousel", name: "launch", round: 1, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "picture-led" }, { id: "c", direction: "diagram-led" }] };

function carousel(g, doc = VARIANTS) {
  writeFileSync(g.at("variants.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
  for (const id of ["a", "b", "c"]) {
    mkdirSync(g.at("slides", `launch-${id}`), { recursive: true });
    writeFileSync(g.at("slides", `launch-${id}`, "contact.png"), PNG);
  }
}

const problemOf = (g, doc, kind = "carousel") => {
  writeFileSync(g.at("variants.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
  return readVariants(g.config, "STH-12", kind);
};

test("variants: a good variants.json gives three versions, their directions from the repo and their places", () => {
  withGoal((g) => {
    carousel(g);
    const v = readVariants(g.config, "STH-12", "carousel");
    assert.equal(v.problem, null);
    assert.equal(v.present, true);
    assert.equal(v.round, 1);
    assert.deepEqual(v.missing, []);
    assert.deepEqual(v.variants.map((x) => [x.id, x.direction.id, x.direction.title, x.rel, x.dir]), [
      ["a", "type-led", "Type led", "slides/launch-a", true],
      ["b", "picture-led", "Picture led", "slides/launch-b", true],
      ["c", "diagram-led", "Diagram led", "slides/launch-c", true],
    ]);
    // An alias kind uses its kind's directions; a draft kind's places are files.
    assert.deepEqual(placeOf("newsletter", "launch", "b"), { rel: "drafts/launch-b.md", dir: false, report: "draft", reportName: "launch-b" });
    assert.equal(placeOf("carousel", "../x", "a"), null);
    assert.equal(placeOf("carousel", "launch", "d"), null);
  });
});

test("variants: no variants.json is a single piece; no goal folder is nothing", () => {
  withGoal((g) => {
    assert.deepEqual(readVariants(g.config, "STH-12", "carousel"), { present: false, name: null, round: null, variants: [], missing: [], problem: null });
    assert.equal(readVariants(g.config, "STH-99", "carousel").present, false);
    assert.equal(readVariants(g.config, "../STH-12", "carousel").present, false);
  });
});

test("variants: a link, 1 MB, a fourth id, an unknown or repeated direction, or a name with a slash is a plain problem", () => {
  withGoal((g) => {
    const cases = [
      [{ ...VARIANTS, variants: [...VARIANTS.variants, { id: "d", direction: "split" }] }, /one to three versions/],
      [{ ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "d", direction: "split" }] }, /an id other than a, b or c/],
      [{ ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "neon-glow" }] }, /not in the list for this kind/],
      [{ ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "editorial" }] }, /not in the list for this kind/],
      [{ ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "type-led" }] }, /same direction/],
      [{ ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "a", direction: "split" }] }, /listed twice/],
      [{ ...VARIANTS, name: "launch/../../x" }, /not a plain name/],
      [{ ...VARIANTS, name: "Launch" }, /not a plain name/],
      [{ ...VARIANTS, kind: "film" }, /another kind/],
      [{ ...VARIANTS, variants: [] }, /one to three versions/],
      [{ ...VARIANTS, variants: "abc" }, /shape/],
      [[1, 2, 3], /shape/],
      ["{ not json", /not valid JSON/],
    ];
    for (const [doc, want] of cases) {
      const v = problemOf(g, doc);
      assert.match(v.problem || "", want, JSON.stringify(doc).slice(0, 80));
      assert.equal(v.present, true);
      assert.deepEqual(v.variants, []);
      assert.ok(v.problem.endsWith(".") && v.problem.length < 160 && !v.problem.includes("{"), v.problem);
    }
    assert.match(problemOf(g, VARIANTS, null).problem, /not started from a job that makes versions/);

    writeFileSync(g.at("variants.json"), `${JSON.stringify(VARIANTS)}${" ".repeat(1024 * 1024)}`);
    assert.match(readVariants(g.config, "STH-12", "carousel").problem, /larger than 16 KB/);

    rmSync(g.at("variants.json"));
    const outside = join(g.root, "elsewhere.json");
    writeFileSync(outside, JSON.stringify(VARIANTS));
    symlinkSync(outside, g.at("variants.json"));
    const linked = readVariants(g.config, "STH-12", "carousel");
    assert.match(linked.problem, /not a plain file \(it may be a link\)/);
    assert.deepEqual(linked.variants, []);
  });
});

test("variants: a version whose folder is a link out of the goal is not listed; nor is any when the kind's folder is a link", () => {
  withGoal((g) => {
    carousel(g);
    const out = join(g.root, "outside-c");
    mkdirSync(out);
    writeFileSync(join(out, "contact.png"), PNG);
    rmSync(g.at("slides", "launch-c"), { recursive: true });
    symlinkSync(out, g.at("slides", "launch-c"));
    const v = readVariants(g.config, "STH-12", "carousel");
    assert.equal(v.problem, null);
    assert.deepEqual(v.variants.map((x) => x.id), ["a", "b"]);
    assert.deepEqual(v.missing, ["c"]);

    // A file where a folder should be, and a folder missing, are left out the same way.
    rmSync(g.at("slides", "launch-b"), { recursive: true });
    writeFileSync(g.at("slides", "launch-b"), "not a folder");
    assert.deepEqual(readVariants(g.config, "STH-12", "carousel").variants.map((x) => x.id), ["a"]);

    // The whole slides folder swapped for a link to a copy outside: nothing is listed.
    const copy = join(g.root, "slides-copy");
    mkdirSync(join(copy, "launch-a"), { recursive: true });
    rmSync(g.at("slides"), { recursive: true });
    symlinkSync(copy, g.at("slides"));
    const none = readVariants(g.config, "STH-12", "carousel");
    assert.deepEqual(none.variants, []);
    assert.deepEqual(none.missing, ["a", "b", "c"]);
  });
});

test("previews: a contact sheet by its first bytes, shown through /api/view; anything else is not shown", () => {
  withGoal((g) => {
    carousel(g);
    writeFileSync(g.at("slides", "launch-b", "contact.png"), "<svg onload=alert(1)>");
    rmSync(g.at("slides", "launch-c", "contact.png"));
    symlinkSync(join(g.goal, "slides", "launch-a", "contact.png"), g.at("slides", "launch-c", "contact.png"));
    const v = readVariants(g.config, "STH-12", "carousel");
    const [a, b, c] = v.variants.map((x) => previewOf(g.config, "STH-12", "carousel", x));
    assert.equal(a.length, 1);
    assert.equal(a[0].type, "image");
    assert.equal(Buffer.from(a[0].token, "base64url").toString("utf8"), "STH-12/slides/launch-a/contact.png");
    assert.equal(a[0].url, `/api/view/${a[0].token}`);
    assert.deepEqual(b, [], "bytes that are not a PNG are not shown");
    assert.deepEqual(c, [], "a link is not shown");
    // Only places made here are looked at: a variant object with another path is still only its own place.
    assert.deepEqual(previewOf(g.config, "STH-12", "carousel", null), []);
    assert.deepEqual(previewOf(g.config, "STH-12", "unknown-kind", v.variants[0]), []);
  });
});

test("previews: a title card's poster, a film's board, a draft's body as capped plain text", () => {
  withGoal((g) => {
    mkdirSync(g.at("video", "open-a"), { recursive: true });
    writeFileSync(g.at("video", "open-a", "title-card.png"), PNG);
    const card = previewOf(g.config, "STH-12", "title-card", placeOf("title-card", "open", "a"));
    assert.equal(Buffer.from(card[0].token, "base64url").toString(), "STH-12/video/open-a/title-card.png");
    writeFileSync(g.at("video", "open-a", "poster.png"), PNG);
    assert.equal(Buffer.from(previewOf(g.config, "STH-12", "title-card", placeOf("title-card", "open", "a"))[0].token, "base64url").toString(), "STH-12/video/open-a/poster.png");

    mkdirSync(g.at("film", "walk-b", "board"), { recursive: true });
    for (const n of ["01", "02", "03", "04"]) writeFileSync(g.at("film", "walk-b", "board", `shot-${n}.png`), PNG);
    assert.equal(previewOf(g.config, "STH-12", "film", placeOf("film", "walk", "b")).length, 3);
    assert.deepEqual(previewOf(g.config, "STH-12", "page", placeOf("page", "home", "a")), []);

    mkdirSync(g.at("drafts"));
    const body = `Line one‮ of the post.\n\n\n\nLine two\u0000. ${"word ".repeat(600)}`;
    writeFileSync(g.at("drafts", "launch-c.md"), `---\ntitle: Launch\nchannel: post\nplanned: 2026-11-30\n---\n${body}`);
    const text = previewOf(g.config, "STH-12", "post", placeOf("post", "launch", "c"));
    assert.equal(text.length, 1);
    assert.equal(text[0].type, "text");
    assert.ok(text[0].text.startsWith("Line one  of the post.\n\nLine two . word"), JSON.stringify(text[0].text.slice(0, 60)));
    assert.ok(!text[0].text.includes("title: Launch"), "the header block is left out");
    assert.ok(Array.from(text[0].text).length <= 1500);
    assert.equal(draftBody("no header here"), "no header here");
    assert.equal(draftBody(null), "");
  });
});
