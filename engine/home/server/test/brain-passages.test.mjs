// Cutting a brain file into passages (contract B4): the vectors, the limits, and linear time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutFile } from "../brain/passages.mjs";

const md = (text, name = "services.md") => cutFile({ path: `pricing/${name}`, name, kind: "text", text });

test("headings split a file; the locator is the heading path", () => {
  const r = md("# Services\n## Site visit\nPrice: ₹2,500 per visit. Free for Acme Interiors until 2026-03-31.\n## Design package\nPrice: ₹40,000. Delivery in three weeks.\n");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { title: "Services", locator: "Services > Site visit", ord: 0, text: "Price: ₹2,500 per visit. Free for Acme Interiors until 2026-03-31." });
  assert.equal(r[1].locator, "Services > Design package");
  assert.equal(r[1].ord, 1);
});

test("a long line with no space is cut at 900; the title is the file name", () => {
  const r = cutFile({ path: "notes/long.txt", name: "long.txt", kind: "text", text: "a".repeat(2000) });
  assert.deepEqual(r.map((p) => p.text.length), [900, 900, 200]);
  assert.equal(r[0].title, "long");
  assert.equal(r[0].locator, "");
});

test("line ends are normalised and blank-line paragraphs stay together", () => {
  const r = cutFile({ path: "x.txt", name: "x.txt", kind: "text", text: "a\r\n\r\nb" });
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "a\n\nb");
});

test("a file of only a title gives nothing", () => {
  assert.deepEqual(md("# Title"), []);
  assert.deepEqual(md(""), []);
});

test("csv: header plus twenty rows a passage", () => {
  const rows = ["name,qty"]; for (let i = 1; i <= 45; i++) rows.push(`item${i},${i}`);
  const r = cutFile({ path: "t.csv", name: "t.csv", kind: "table", text: rows.join("\n") + "\n" });
  assert.deepEqual(r.map((p) => p.locator), ["rows 2 to 21", "rows 22 to 41", "rows 42 to 46"]);
  for (const p of r) assert.ok(p.text.startsWith("name,qty\n"));
  assert.equal(r[0].text.split("\n").length, 21);
  assert.equal(r[2].text.split("\n").length, 6);
});

test("csv gives at most 50 passages", () => {
  const rows = ["h"]; for (let i = 0; i < 2000; i++) rows.push(`r${i}`);
  assert.equal(cutFile({ path: "t.csv", name: "t.csv", kind: "table", text: rows.join("\n") }).length, 50);
});

test("a # line inside a fence is text, not a heading", () => {
  const r = md("# Doc\n## Part\n```\n# not a heading\nx\n```\nafter\n");
  assert.equal(r.length, 1);
  assert.equal(r[0].locator, "Doc > Part");
  assert.ok(r[0].text.includes("# not a heading"));
});

test("pictures and PDFs give one empty passage, found by name", () => {
  for (const kind of ["image", "pdf"]) {
    const r = cutFile({ path: "brand/logo.png", name: "logo.png", kind, text: null });
    assert.deepEqual(r, [{ title: "logo", locator: "", ord: 0, text: "" }]);
  }
});

test("a NUL anywhere gives nothing", () => {
  assert.deepEqual(md("# T\nab\0c"), []);
});

test("paragraphs are packed to 900; long ones cut at a sentence end or space", () => {
  const para = (n) => `${"w".repeat(n)}`;
  const r = md(`${para(500)}\n\n${para(500)}\n\n${para(100)}`);
  assert.deepEqual(r.map((p) => p.text.length), [500, 602]);
  const sentence = "Sentence one is here. ".repeat(60).trim();
  const s = md(sentence);
  assert.ok(s.length >= 2);
  assert.ok(s[0].text.endsWith("."));
  assert.ok(s.every((p) => p.text.length <= 900));
  const words = md("word ".repeat(500).trim());
  assert.ok(words.every((p) => p.text.length <= 900 && !p.text.startsWith(" ") && !p.text.endsWith(" ")));
});

test("title is the first # line, at most 80 characters; passages cap at 400", () => {
  const r = md(`## Intro\ntext\n# ${"T".repeat(120)}\nmore`);
  assert.equal(r[0].title.length, 80);
  const many = md(Array.from({ length: 600 }, (_, i) => `## S${i}\nbody ${i}`).join("\n"));
  assert.equal(many.length, 400);
});

test("a 262,144-character line with no space is cut in under 200 ms of CPU", () => {
  const text = "a".repeat(262144);
  const before = process.cpuUsage();
  const r = cutFile({ path: "big.txt", name: "big.txt", kind: "text", text });
  const used = process.cpuUsage(before);
  assert.ok((used.user + used.system) / 1000 < 200, `${(used.user + used.system) / 1000} ms`);
  assert.equal(r.length, 292);
});
