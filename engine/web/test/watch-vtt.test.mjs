// Captions to plain text (PLAN-V5 K11 watch; engine/web/vtt.mjs). Pure: no tool, no sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_TRANSCRIPT, vttToText } from "../vtt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("a captions file with markup gives plain text: tags, timings, ids, notes and styles dropped, repeats folded", () => {
  const { text, truncated } = vttToText(readFileSync(join(HERE, "fixtures", "watch-markup.vtt"), "utf8"));
  assert.equal(truncated, false);
  assert.equal(text, [
    "Welcome to the stand-in & site",
    "Brick houses in the morning",
    "light <3 alert(1)",
    "hidden marks",
    "unclosed",
  ].join("\n"));
  assert.doesNotMatch(text, /-->|<b>|<c|<v |WEBVTT|NOTE|::cue|align:/);
  assert.doesNotMatch(text, /[​‪-‮]/);
});

test("rolling auto-captions are folded to each line once", () => {
  const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\none\n\n00:00:01.000 --> 00:00:02.000\none\ntwo\n\n"
    + "00:00:02.000 --> 00:00:03.000\ntwo\nthree\n\n00:00:03.000 --> 00:00:04.000\nthree\nfour\n";
  assert.equal(vttToText(vtt).text, "one\ntwo\nthree\nfour");
});

test("Windows line ends, a byte-order mark and a file with no cues", () => {
  assert.equal(vttToText("﻿WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nHi there\r\n").text, "Hi there");
  assert.deepEqual(vttToText("WEBVTT\n\nNOTE only a note\n"), { text: "", truncated: false });
  assert.deepEqual(vttToText(""), { text: "", truncated: false });
  assert.deepEqual(vttToText(null), { text: "", truncated: false });
});

test("the transcript is capped and says so", () => {
  let vtt = "WEBVTT\n";
  for (let i = 0; i < 3000; i += 1) vtt += `\n00:00:00.000 --> 00:00:01.000\nline ${i} ${"word ".repeat(20)}\n`;
  const out = vttToText(vtt, { max: 5000 });
  assert.equal(out.truncated, true);
  assert.ok(out.text.length <= 5000);
  assert.equal(vttToText(vtt).text.length <= MAX_TRANSCRIPT, true);
});

test("a hostile file is read in linear time (many angle brackets, a huge line)", () => {
  const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${"<".repeat(200_000)}\n\n00:00:01.000 --> 00:00:02.000\n${"a<b>".repeat(100_000)}\n`;
  const t0 = Date.now();
  const out = vttToText(vtt);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(typeof out.text, "string");
});
