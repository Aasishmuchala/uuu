import { test } from "node:test";
import assert from "node:assert/strict";

const { thumbStyle, checkLine } = await import("../../pages/studio.js");

const sprite = { frames: 4, frameSize: { w: 16, h: 16 }, sheet: { viewUrl: "/api/view/abc" } };

test("thumbStyle scales the first frame by a whole number and uses the sheet as a pixelated background", () => {
  const s = thumbStyle(sprite, 64);
  assert.match(s, /width:64px/);
  assert.match(s, /height:64px/);
  assert.match(s, /background-size:256px 64px/);
  assert.match(s, /background-position:0 0/);
  assert.match(s, /image-rendering:pixelated/);
  assert.match(s, /url\("\/api\/view\/abc"\)/);
});

test("thumbStyle shrinks a large frame and survives missing data", () => {
  const big = thumbStyle({ frames: 2, frameSize: { w: 128, h: 64 }, sheet: { viewUrl: "/api/view/x" } }, 64);
  assert.match(big, /width:64px/);
  assert.match(big, /height:32px/);
  assert.match(big, /background-size:128px 32px/);
  assert.match(thumbStyle(null, 64), /background-image:none/);
  assert.doesNotMatch(thumbStyle({ ...sprite, sheet: { viewUrl: '/a")b' } }, 64), /"\)b/);
});

test("checkLine words the result in plain terms", () => {
  assert.deepEqual(checkLine({ ok: true }), { ok: true, text: "Frames match the tags" });
  assert.deepEqual(checkLine({ ok: false }), { ok: false, text: "The frames and the tags do not match" });
  assert.equal(checkLine(null).ok, false);
});
