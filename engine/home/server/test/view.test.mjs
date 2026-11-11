// Viewing files agents wrote (CONTRACTS-V2 17.8): GET /api/view/<token>. Images come back with their real
// type, inline and under the sandbox policy; text only as JSON; HTML never; links and paths that leave the
// goal's folder are refused; every answer says nosniff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startV2 } from "../lib/testing-v2.mjs";
import { call, writes } from "../lib/testing.mjs";
import { boardSeedV2, copyStateSeedV2 } from "../../../test/stubs/seed.mjs";

const SANDBOX = "default-src 'none'; sandbox";
const token = (rel) => Buffer.from(rel, "utf8").toString("base64url");
const work = (h, ...parts) => join(h.state, "tasks", "company-work", ...parts);

async function withHome(fn) {
  const h = await startV2({ routes: ["view"], boardSeed: boardSeedV2() });
  copyStateSeedV2(h.state);
  try { return await fn(h); } finally { await h.close(); }
}

const view = (h, rel) => call(h.url, "GET", `/api/view/${token(rel)}`);

function assertNotFound(r, code) {
  assert.equal(r.status, 404);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.match(r.headers["content-type"], /^application\/json/);
  if (code) assert.equal(r.json.error.code, code);
}

test("view: the seed's sheet comes back as a PNG, inline, under the sandbox policy", async () => {
  await withHome(async (h) => {
    const r = await view(h, "STH-8/art/walker/walker-sheet.png");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.match(r.headers["content-disposition"], /^inline\b/);
    assert.equal(r.headers["content-security-policy"], SANDBOX);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.buffer.subarray(1, 4).toString("latin1"), "PNG");
    assert.deepEqual(writes(h.board), []);
  });
});

test("view: the seed's GIF comes back as a GIF under the sandbox policy", async () => {
  await withHome(async (h) => {
    const r = await view(h, "STH-8/art/walker/walker.gif");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/gif");
    assert.equal(r.headers["content-security-policy"], SANDBOX);
  });
});

test("view: a file named .png that holds HTML is not viewable", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-8", "trap.png"), "<!doctype html><script>alert(1)</script>");
    const r = await view(h, "STH-8/trap.png");
    assertNotFound(r, "not_viewable");
    assert.equal(r.json.error.message, "This file cannot be shown here.");
    assert.equal(r.json.error.next, "Download it instead.");
    assert.ok(!r.text.includes("<script"));
  });
});

test("view: a GIF named .png is not viewable (the bytes and the name must agree)", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-8", "odd.png"), Buffer.from("GIF89a........"));
    assertNotFound(await view(h, "STH-8/odd.png"), "not_viewable");
  });
});

test("view: an SVG comes back as image/svg+xml under the sandbox policy", async () => {
  await withHome(async (h) => {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><script>alert(1)</script><rect width=\"8\" height=\"8\"/></svg>";
    writeFileSync(work(h, "STH-8", "badge.svg"), svg);
    const r = await view(h, "STH-8/badge.svg");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/svg+xml");
    assert.match(r.headers["content-disposition"], /^inline\b/);
    assert.equal(r.headers["content-security-policy"], SANDBOX);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  });
});

test("view: an .svg that holds no svg element is not viewable", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-8", "fake.svg"), "<html><body>hello</body></html>");
    assertNotFound(await view(h, "STH-8/fake.svg"), "not_viewable");
  });
});

test("view: a .md file comes back as JSON with its text", async () => {
  await withHome(async (h) => {
    const r = await view(h, "STH-8/00-brief.md");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /^application\/json/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.json.name, "00-brief.md");
    assert.equal(typeof r.json.text, "string");
    assert.match(r.json.text, /^# Brief:/);
    assert.equal(r.json.truncated, false);
  });
});

test("view: text over 256 KB is cut and marked truncated; a script inside stays text", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-8", "big.txt"), `<script>x</script>${"a".repeat(300000)}`);
    const r = await view(h, "STH-8/big.txt");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /^application\/json/);
    assert.equal(r.json.truncated, true);
    assert.equal(Buffer.byteLength(r.json.text), 262144);
  });
});

test("view: an .html file and a file of any other kind are not viewable", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-8", "page.html"), "<html><body>hi</body></html>");
    writeFileSync(work(h, "STH-8", "part.step"), "ISO-10303-21;");
    for (const rel of ["STH-8/page.html", "STH-8/part.step"]) {
      const r = await view(h, rel);
      assertNotFound(r, "not_viewable");
      assert.ok(!String(r.headers["content-type"]).includes("text/html"));
    }
  });
});

test("view: a token that leaves the folder is refused", async () => {
  await withHome(async (h) => {
    writeFileSync(join(h.state, "outside.md"), "secret");
    for (const rel of ["STH-8/../../../outside.md", "../outside.md", "/etc/hosts.txt", "STH-8/./00-brief.md", "STH-8\\00-brief.md", "STH-8"]) {
      assertNotFound(await view(h, rel));
    }
    assertNotFound(await call(h.url, "GET", "/api/view/not*a*token"));
  });
});

test("view: a link is refused, as a file and as a folder on the way", async () => {
  await withHome(async (h) => {
    writeFileSync(join(h.state, "outside.md"), "secret");
    symlinkSync(join(h.state, "outside.md"), work(h, "STH-8", "link.md"));
    symlinkSync(work(h, "STH-8", "art", "walker", "walker-sheet.png"), work(h, "STH-8", "link.png"));
    mkdirSync(join(h.state, "elsewhere"));
    writeFileSync(join(h.state, "elsewhere", "x.md"), "secret");
    symlinkSync(join(h.state, "elsewhere"), work(h, "STH-8", "dir"));
    for (const rel of ["STH-8/link.md", "STH-8/link.png", "STH-8/dir/x.md"]) {
      const r = await view(h, rel);
      assertNotFound(r);
      assert.ok(!r.text.includes("secret"));
    }
  });
});

test("view: a missing file is 404 and every answer carries nosniff", async () => {
  await withHome(async (h) => {
    const r = await view(h, "STH-8/nothing-here.png");
    assertNotFound(r, "file_not_found");
  });
});

// ---- videos (C3 37.4)

const TITLE = "STH-25/video/title/title.mp4";

test("view: the seed's title card comes back as video/mp4, inline, under the sandbox policy, whole", async () => {
  await withHome(async (h) => {
    const r = await view(h, TITLE);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "video/mp4");
    assert.match(r.headers["content-disposition"], /^inline; filename="title.mp4"$/);
    assert.equal(r.headers["content-security-policy"], SANDBOX);
    assert.equal(r.headers["accept-ranges"], "bytes");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    const bytes = readFileSync(work(h, "STH-25", "video", "title", "title.mp4"));
    assert.equal(Number(r.headers["content-length"]), bytes.length);
    assert.ok(r.buffer.equals(bytes));
    assert.deepEqual(writes(h.board), []);
  });
});

test("view: an .mp4 whose bytes are not an MP4 is not viewable", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-25", "trap.mp4"), "<!doctype html><script>alert(1)</script>");
    writeFileSync(work(h, "STH-25", "empty.mp4"), "");
    for (const rel of ["STH-25/trap.mp4", "STH-25/empty.mp4"]) {
      const r = await view(h, rel);
      assertNotFound(r, "not_viewable");
      assert.ok(!r.text.includes("<script"));
    }
  });
});

test("view: a video over 300 MB is too large to show, and is not read", async () => {
  await withHome(async (h) => {
    const file = work(h, "STH-25", "big.mp4");
    writeFileSync(file, readFileSync(work(h, "STH-25", "video", "title", "title.mp4")));
    truncateSync(file, 300 * 1024 * 1024 + 1);
    const r = await view(h, "STH-25/big.mp4");
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, "too_large");
  });
});

test("view: a video that is a link, or behind a folder that is a link, is 404", async () => {
  await withHome(async (h) => {
    const real = work(h, "STH-25", "video", "title", "title.mp4");
    symlinkSync(real, work(h, "STH-25", "link.mp4"));
    mkdirSync(join(h.state, "elsewhere"));
    writeFileSync(join(h.state, "elsewhere", "clip.mp4"), readFileSync(real));
    symlinkSync(join(h.state, "elsewhere"), work(h, "STH-25", "dir"));
    symlinkSync(join(h.state, "elsewhere", "clip.mp4"), work(h, "STH-8", "outside.mp4"));
    for (const rel of ["STH-25/link.mp4", "STH-25/dir/clip.mp4", "STH-8/outside.mp4", "STH-25/../STH-25/video/title/title.mp4"]) {
      assertNotFound(await view(h, rel));
    }
  });
});

test("view: a request for several ranges is answered with the whole video", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", `/api/view/${token(TITLE)}`, { headers: { range: "bytes=0-99, 200-299" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-range"], undefined);
    assert.equal(r.buffer.length, readFileSync(work(h, "STH-25", "video", "title", "title.mp4")).length);
  });
});

test("view: ranges of a video: 0-99 and 100- are 206 from the same bytes; one past the end is 416", async () => {
  await withHome(async (h) => {
    const bytes = readFileSync(work(h, "STH-25", "video", "title", "title.mp4"));
    const size = bytes.length;
    const ranged = (range) => call(h.url, "GET", `/api/view/${token(TITLE)}`, { headers: { range } });

    const first = await ranged("bytes=0-99");
    assert.equal(first.status, 206);
    assert.equal(first.headers["content-range"], `bytes 0-99/${size}`);
    assert.equal(Number(first.headers["content-length"]), 100);
    assert.equal(first.headers["content-type"], "video/mp4");
    assert.equal(first.headers["content-security-policy"], SANDBOX);
    assert.equal(first.headers["accept-ranges"], "bytes");
    assert.equal(first.headers["x-content-type-options"], "nosniff");
    assert.ok(first.buffer.equals(bytes.subarray(0, 100)));

    const rest = await ranged("bytes=100-");
    assert.equal(rest.status, 206);
    assert.equal(rest.headers["content-range"], `bytes 100-${size - 1}/${size}`);
    assert.equal(Number(rest.headers["content-length"]), size - 100);
    assert.ok(rest.buffer.equals(bytes.subarray(100)));

    const clipped = await ranged(`bytes=${size - 10}-999999999`);
    assert.equal(clipped.status, 206);
    assert.equal(clipped.headers["content-range"], `bytes ${size - 10}-${size - 1}/${size}`);
    assert.ok(clipped.buffer.equals(bytes.subarray(size - 10)));

    const past = await ranged("bytes=999999999-");
    assert.equal(past.status, 416);
    assert.equal(past.headers["content-range"], `bytes */${size}`);
    assert.equal(past.buffer.length, 0);

    for (const range of ["bytes=-100", "bytes=99-0", "items=0-99", "bytes=0-99,200-299"]) {
      const whole = await ranged(range);
      assert.equal(whole.status, 200, range);
      assert.equal(whole.headers["content-range"], undefined, range);
      assert.ok(whole.buffer.equals(bytes), range);
    }
  });
});

test("view: a range on an image or a text file changes nothing", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", `/api/view/${token("STH-8/art/walker/walker-sheet.png")}`, { headers: { range: "bytes=0-9" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-range"], undefined);
    assert.equal(r.headers["accept-ranges"], undefined);
    assert.equal(r.buffer.subarray(1, 4).toString("latin1"), "PNG");
  });
});
