// Viewing files agents wrote (CONTRACTS-V2 17.8): GET /api/view/<token>. Images come back with their real
// type, inline and under the sandbox policy; text only as JSON; HTML never; links and paths that leave the
// goal's folder are refused; every answer says nosniff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
