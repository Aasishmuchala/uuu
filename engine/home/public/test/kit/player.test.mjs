// The kit's player part (T35 of PLAN-COOK): a take, its transport and its stills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FakeElement, KIT, elements, fire, html, installDom, render, settle, show, textOf, withClass } from "./_dom.mjs";
import { ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "player.js")).href);
const { Player, PLAYER_WORDS, timeWords, nearestStill } = mod;

test("player.js loads in Node and exports its parts as functions", () => {
  for (const name of ["Player", "timeWords", "nearestStill"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

ROOTS.player = "k-player";
newSheetTest("player");

const STILLS = [0, 1, 2, 3, 4, 5].map((i) => `/api/view/still-${i}`);
const CLIP = "/api/studio/films/STH-41/sent/job-1";
const byTag = (root, t) => elements(root).filter((e) => e.localName === t);
const labelled = (root, words) => elements(root).find((e) => e.getAttribute("aria-label") === words);
// A fake <video> that remembers what it was asked to do.
function wire(video) {
  video.calls = [];
  video.paused = true;
  video.currentTime = 0;
  video.play = () => { video.calls.push("play"); return Promise.resolve(); };
  video.pause = () => { video.calls.push("pause"); };
  return video;
}

test("timeWords: seconds as m:ss, and anything else as 0:00", () => {
  assert.equal(timeWords(0), "0:00");
  assert.equal(timeWords(4), "0:04");
  assert.equal(timeWords(65), "1:05");
  assert.equal(timeWords("x"), "0:00");
  assert.equal(timeWords(4.9), "0:04", "a part second is not rounded up");
  assert.equal(timeWords(-3), "0:00");
  assert.equal(timeWords(Infinity), "0:00");
  assert.equal(timeWords(undefined), "0:00");
});

test("nearestStill: the still nearest the time, spread evenly over the length", () => {
  assert.equal(nearestStill(4, 5, 6), 4);
  assert.equal(nearestStill(0, 5, 6), 0);
  assert.equal(nearestStill(5, 5, 6), 5);
  assert.equal(nearestStill(1, 0, 6), 0);
  assert.equal(nearestStill(9, 5, 6), 5, "past the end is the last");
  assert.equal(nearestStill(2, 5, 1), 0, "one still is always the one");
  assert.equal(nearestStill("x", 5, 6), 0);
});

test("a clip: a 16:9 video with no autoplay and no loop, the transport and the stills", async () => {
  const root = await show(Player, { src: CLIP, stills: STILLS, seconds: 5, label: "Shot 1, take 1", tags: ["Shot 1, take 1", "16:9"] });
  const [video] = byTag(root, "video");
  assert.ok(video, "a video");
  assert.equal(video.src ?? video.getAttribute("src"), CLIP);
  assert.equal(video.preload ?? video.getAttribute("preload"), "metadata");
  assert.ok((video.playsinline ?? video.getAttribute("playsinline")) != null, "playsinline");
  for (const k of ["autoplay", "loop", "controls"]) assert.ok(!video[k] && video.getAttribute(k) == null, `no ${k}`);
  assert.equal(withClass(root, "k-player").length, 1);
  const play = labelled(root, PLAYER_WORDS.play);
  assert.equal(play?.localName, "button", "a Play button");
  assert.ok(play.getAttribute("class").includes("k-player__play"));
  assert.ok(labelled(root, "Mute"), "mute");
  assert.ok(labelled(root, "Full screen"), "full screen");
  const time = withClass(root, "k-player__time")[0];
  assert.equal(textOf(time), "0:00 / 0:05");
  const [range] = byTag(root, "input");
  assert.equal(range.type ?? range.getAttribute("type"), "range");
  assert.equal(String(range.max ?? range.getAttribute("max")), "5");
  assert.equal(range.getAttribute("aria-valuetext"), "0:00 of 0:05");
  const stills = withClass(root, "k-player__still");
  assert.deepEqual(stills.map((b) => b.getAttribute("aria-label")), ["Still at 0:00", "Still at 0:01", "Still at 0:02", "Still at 0:03", "Still at 0:04", "Still at 0:05"]);
  assert.deepEqual(stills.map((b) => b.getAttribute("aria-current")), ["true", null, null, null, null, null], "the first is outlined");
  assert.equal(textOf(withClass(root, "k-player__tag")[0]), "Shot 1, take 1 · 16:9", "the tags, as text");
  assert.equal(withClass(root, "k-player__track").length, 1, "one scrubber");
});

test("pressing a still pauses and seeks to it, and the outline and the time follow", async () => {
  const root = await show(Player, { src: CLIP, stills: STILLS, seconds: 5 });
  const video = wire(byTag(root, "video")[0]);
  fire(labelled(root, "Still at 0:03"), "click");
  await settle();
  assert.deepEqual(video.calls, ["pause"]);
  assert.equal(video.currentTime, 3);
  assert.equal(labelled(root, "Still at 0:03").getAttribute("aria-current"), "true");
  assert.equal(labelled(root, "Still at 0:00").getAttribute("aria-current"), null);
  assert.equal(textOf(withClass(root, "k-player__now")[0]), "0:03");
  assert.equal(textOf(withClass(root, "k-player__head-time")[0]), "0:03", "the time on the playhead");
});

test("pressing a point on the range pauses and seeks there", async () => {
  const root = await show(Player, { src: CLIP, stills: STILLS, seconds: 5 });
  const video = wire(byTag(root, "video")[0]);
  const [range] = byTag(root, "input");
  range.value = "2.5";
  fire(range, "input");
  await settle();
  assert.deepEqual(video.calls, ["pause"]);
  assert.equal(video.currentTime, 2.5);
  assert.equal(textOf(withClass(root, "k-player__now")[0]), "0:02");
});

test("Space plays and pauses from the range and the play button; Left and Right move a second", async () => {
  const root = await show(Player, { src: CLIP, stills: STILLS, seconds: 5 });
  const video = wire(byTag(root, "video")[0]);
  const player = withClass(root, "k-player")[0];
  const [range] = byTag(root, "input");
  let stopped = 0;
  fire(player, "keydown", { key: " ", target: range, preventDefault: () => stopped++ });
  assert.deepEqual(video.calls, ["play"]);
  fire(video, "play");
  await settle();
  assert.ok(labelled(root, "Pause"), "the button now says Pause");
  fire(player, "keydown", { key: " ", target: labelled(root, "Pause"), preventDefault: () => stopped++ });
  assert.deepEqual(video.calls, ["play", "pause"]);
  assert.equal(stopped, 2, "the page does not scroll and the button is not pressed twice");
  // A still keeps Space as its own press.
  fire(player, "keydown", { key: " ", target: labelled(root, "Still at 0:02") });
  assert.deepEqual(video.calls, ["play", "pause"]);
  video.currentTime = 2;
  fire(player, "keydown", { key: "ArrowRight", target: range });
  assert.equal(video.currentTime, 3);
  fire(player, "keydown", { key: "ArrowLeft", target: range });
  fire(player, "keydown", { key: "ArrowLeft", target: range });
  assert.equal(video.currentTime, 1);
  video.currentTime = 4.5;
  fire(player, "keydown", { key: "ArrowRight", target: range });
  assert.equal(video.currentTime, 5, "not past the end");
});

test("with no src: the stills alone in the frame, the transport without play", async () => {
  const root = await show(Player, { stills: STILLS, seconds: 5, label: "Shot 2, take 1" });
  assert.equal(byTag(root, "video").length, 0);
  assert.equal(labelled(root, "Play"), undefined, "no play");
  assert.equal(labelled(root, "Mute"), undefined, "no mute without a clip");
  const picture = () => withClass(root, "k-player__picture")[0];
  assert.equal(picture().getAttribute("src") ?? picture().src, STILLS[0], "the first by default");
  assert.equal(textOf(withClass(root, "k-player__time")[0]), "0:00 / 0:05");
  fire(labelled(root, "Still at 0:04"), "click");
  await settle();
  assert.equal(picture().getAttribute("src") ?? picture().src, STILLS[4]);
  const player = withClass(root, "k-player")[0];
  fire(player, "keydown", { key: "ArrowLeft", target: byTag(root, "input")[0] });
  await settle();
  assert.equal(picture().getAttribute("src") ?? picture().src, STILLS[3], "Left moves a second back through the stills");
});

test("a clip that fails to load says so in the frame and keeps the stills", async () => {
  const root = await show(Player, { src: CLIP, stills: STILLS, seconds: 5 });
  fire(byTag(root, "video")[0], "error");
  await settle();
  assert.equal(textOf(withClass(root, "k-player__failed")[0]), "This clip could not be played.");
  assert.equal(PLAYER_WORDS.failed, "This clip could not be played.");
  assert.equal(byTag(root, "video").length, 0, "the broken video is gone");
  assert.equal(labelled(root, "Play"), undefined, "no play");
  assert.equal(withClass(root, "k-player__still").length, 6, "the stills are kept");
  assert.equal(withClass(root, "k-player__picture").length, 1, "a still stands in the frame");
});

test("a new clip after a failed one starts again, playable, from 0:00", async () => {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Player} src=${CLIP} stills=${STILLS} seconds=${5} />`, root);
  await settle();
  fire(byTag(root, "video")[0], "error");
  await settle();
  assert.equal(withClass(root, "k-player__failed").length, 1);
  render(html`<${Player} src="/api/studio/films/STH-41/sent/job-2" stills=${STILLS} seconds=${5} />`, root);
  await settle();
  assert.equal(withClass(root, "k-player__failed").length, 0, "the sentence is gone");
  assert.equal(byTag(root, "video").length, 1);
  assert.ok(labelled(root, "Play"));
  assert.equal(textOf(withClass(root, "k-player__now")[0]), "0:00");
});

test("no stills: one plain bar, still a real range", async () => {
  installDom();
  const root = await show(Player, { src: CLIP, seconds: 5 });
  assert.equal(withClass(root, "k-player__track--bare").length, 1);
  assert.equal(withClass(root, "k-player__still").length, 0);
  assert.equal(byTag(root, "input").length, 1);
});

test("the module's source has no autoplay, no innerHTML and builds no address", () => {
  const source = readFileSync(join(KIT, "player.js"), "utf8");
  assert.doesNotMatch(source, /autoplay/i);
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /\/api\//, "addresses come in already checked");
});
