// The core, changed for one byte range (C3 37.4): the core parses the request's Range header itself and
// gives a route ctx.range (null, or { start, end } with end null for `a-`); the raw header never reaches a
// route. streamFile, offered a range, answers 206 with Content-Range, or 416 with `bytes */<size>` for a
// range that starts at or past the end, and the whole file (200) for no range; always Accept-Ranges and the
// same safe headers as today. Read from the descriptor the route opened, from bytes, or from a path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { SERVER_DIR } from "../lib/app.mjs";
import { parseRangeHeader } from "../lib/static.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const STATIC = pathToFileURL(join(SERVER_DIR, "lib", "static.mjs")).href;
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const SIZE = BYTES.length;

function moduleDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-range-"));
  mkdirSync(join(dir, "routes"));
  symlinkSync(join(SERVER_DIR, "routes", "health.mjs"), join(dir, "routes", "health.mjs"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

let h;
let dir;
let file;
before(async () => {
  dir = moduleDir({});
  file = join(dir, "data.bin");
  writeFileSync(file, BYTES);
  writeFileSync(join(dir, "empty.bin"), "");
  writeFileSync(join(dir, "big.bin"), Buffer.alloc(8 * 1024 * 1024, 7));
  writeFileSync(join(dir, "routes", "ranged.mjs"), `import { openSync } from "node:fs";
    import { fileResponse } from ${JSON.stringify(STATIC)};
    const FILE = ${JSON.stringify(file)};
    const EMPTY = ${JSON.stringify(join(dir, "empty.bin"))};
    const BIG = ${JSON.stringify(join(dir, "big.bin"))};
    const BYTES = Buffer.from(Array.from({ length: ${SIZE} }, (_, i) => i % 251));
    const H = { "content-security-policy": "default-src 'none'; sandbox" };
    export default function register(app) {
      app.get("/api/r/fd", (ctx) => fileResponse({ fd: openSync(FILE, "r"), size: ${SIZE}, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/bytes", (ctx) => fileResponse({ bytes: BYTES, size: ${SIZE}, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/path", (ctx) => fileResponse({ file: FILE, size: ${SIZE}, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/empty", (ctx) => fileResponse({ fd: openSync(EMPTY, "r"), size: 0, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/plain", () => fileResponse({ fd: openSync(FILE, "r"), size: ${SIZE}, type: "video/mp4" }, H));
      app.get("/api/r/big", (ctx) => fileResponse({ fd: openSync(BIG, "r"), size: 8 * 1024 * 1024, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/bigpath", (ctx) => fileResponse({ file: BIG, size: 8 * 1024 * 1024, type: "video/mp4", range: ctx.range }, H));
      app.get("/api/r/slow", async (ctx) => {
        const fd = openSync(BIG, "r");
        await new Promise((r) => setTimeout(r, 400));
        return fileResponse({ fd, size: 8 * 1024 * 1024, type: "video/mp4", range: ctx.range }, H);
      });
      app.get("/api/r/echo", (ctx) => ({ range: ctx.range, keys: Object.keys(ctx).sort(), headers: "headers" in ctx || "req" in ctx }));
    }\n`);
  h = await startStubsHome({ port: 0, moduleDirs: [dir], log: () => {} });
});
after(async () => {
  await h.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path, range) => call(h.url, "GET", path, range === undefined ? {} : { headers: { range } });

function assertSafe(r) {
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.equal(r.headers["content-security-policy"], "default-src 'none'; sandbox");
  assert.equal(r.headers["accept-ranges"], "bytes");
}

test("parseRangeHeader: one bytes=a-b or bytes=a-, and null for everything else", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-99"), { start: 0, end: 99 });
  assert.deepEqual(parseRangeHeader("bytes=100-"), { start: 100, end: null });
  assert.deepEqual(parseRangeHeader("bytes=5-5"), { start: 5, end: 5 });
  assert.deepEqual(parseRangeHeader("bytes=999999999-"), { start: 999999999, end: null });
  assert.deepEqual(parseRangeHeader(" bytes=0-1 "), { start: 0, end: 1 });
  for (const v of [
    undefined, null, 42, {}, ["bytes=0-1"], "", "bytes=", "bytes=-", "bytes=-500", "bytes=0-99,200-299", "bytes=0-99, 200-299",
    "bytes=99-0", "bytes=a-b", "bytes=1.5-2", "bytes=+1-2", "bytes=0x10-", "items=0-99", "Bytes=0-99", "bytes =0-99",
    "bytes=0-99 junk", "bytes=0 -99", `bytes=${"9".repeat(16)}-`, `bytes=0-${"9".repeat(16)}`, `bytes=0-1${" ".repeat(80)}`,
  ]) {
    assert.equal(parseRangeHeader(v), null, JSON.stringify(v));
  }
});

test("a route gets ctx.range, never the raw header", async () => {
  const none = await get("/api/r/echo");
  assert.equal(none.json.range, null);
  assert.equal(none.json.headers, false);
  assert.ok(none.json.keys.includes("range"));
  assert.deepEqual((await get("/api/r/echo", "bytes=3-7")).json.range, { start: 3, end: 7 });
  assert.deepEqual((await get("/api/r/echo", "bytes=3-")).json.range, { start: 3, end: null });
  assert.equal((await get("/api/r/echo", "bytes=0-1,4-5")).json.range, null);
  assert.equal((await get("/api/r/echo", "bytes=-5")).json.range, null);
});

for (const kind of ["fd", "bytes", "path"]) {
  test(`${kind}: no range is 200 with the whole file and Accept-Ranges`, async () => {
    const r = await get(`/api/r/${kind}`);
    assert.equal(r.status, 200);
    assertSafe(r);
    assert.equal(r.headers["content-type"], "video/mp4");
    assert.equal(r.headers["content-range"], undefined);
    assert.equal(Number(r.headers["content-length"]), SIZE);
    assert.ok(r.buffer.equals(BYTES));
  });

  test(`${kind}: a-b, a-, the last byte and b past the end (clipped) are 206 with the right bytes`, async () => {
    for (const [range, start, end] of [
      ["bytes=0-99", 0, 99], ["bytes=100-", 100, SIZE - 1], [`bytes=${SIZE - 1}-`, SIZE - 1, SIZE - 1],
      [`bytes=${SIZE - 1}-${SIZE - 1}`, SIZE - 1, SIZE - 1], ["bytes=990-999999999", 990, SIZE - 1], ["bytes=0-0", 0, 0],
    ]) {
      const r = await get(`/api/r/${kind}`, range);
      assert.equal(r.status, 206, range);
      assertSafe(r);
      assert.equal(r.headers["content-type"], "video/mp4", range);
      assert.equal(r.headers["content-range"], `bytes ${start}-${end}/${SIZE}`, range);
      assert.equal(Number(r.headers["content-length"]), end - start + 1, range);
      assert.ok(r.buffer.equals(BYTES.subarray(start, end + 1)), range);
    }
  });

  test(`${kind}: a range that starts at or past the end is 416 with bytes */size`, async () => {
    for (const range of [`bytes=${SIZE}-`, `bytes=${SIZE}-${SIZE + 10}`, "bytes=999999999-"]) {
      const r = await get(`/api/r/${kind}`, range);
      assert.equal(r.status, 416, range);
      assertSafe(r);
      assert.equal(r.headers["content-range"], `bytes */${SIZE}`, range);
      assert.equal(Number(r.headers["content-length"]), 0, range);
      assert.equal(r.buffer.length, 0, range);
    }
  });

  test(`${kind}: several ranges, a suffix range, another unit or a malformed one is the whole file`, async () => {
    for (const range of ["bytes=0-9,20-29", "bytes=0-9, 20-29", "bytes=-100", "bytes=50-10", "items=0-9", "bytes=x-y", "bytes=0-9;", ""]) {
      const r = await get(`/api/r/${kind}`, range);
      assert.equal(r.status, 200, range);
      assert.equal(r.headers["content-range"], undefined, range);
      assert.equal(r.headers["accept-ranges"], "bytes", range);
      assert.ok(r.buffer.equals(BYTES), range);
    }
  });
}

test("an empty file: no range is 200 and empty; any range is 416", async () => {
  const whole = await get("/api/r/empty");
  assert.equal(whole.status, 200);
  assert.equal(whole.buffer.length, 0);
  const r = await get("/api/r/empty", "bytes=0-");
  assert.equal(r.status, 416);
  assert.equal(r.headers["content-range"], "bytes */0");
});

test("a route that offers no range answers as before: 200, the whole file, no Accept-Ranges", async () => {
  const r = await get("/api/r/plain", "bytes=0-9");
  assert.equal(r.status, 200);
  assert.equal(r.headers["accept-ranges"], undefined);
  assert.equal(r.headers["content-range"], undefined);
  assert.ok(r.buffer.equals(BYTES));
});

test("static files of the interface are not ranged", async () => {
  const r = await get("/", "bytes=0-9");
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-range"], undefined);
  assert.ok(r.buffer.length > 10);
});

// The open descriptors of this process: lsof names each file, so the big file's own count is exact.
function openOf(target) {
  try {
    const out = execFileSync("/usr/sbin/lsof", ["-n", "-P", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    return out.split("\n").filter((l) => l === `n${target}` || l === `n${realpathSync(target)}`).length;
  } catch {
    return readdirSync("/dev/fd").length;
  }
}

test("20 requests that read one chunk and abort leave no descriptor open", async () => {
  const big = join(dir, "big.bin");
  // The core's own streamFile, on a file far larger than one socket buffer, so each read stream is paused.
  const before = openOf(big);
  const port = new URL(h.url).port;
  const one = (i) => new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: i % 2 ? "/api/r/big" : "/api/r/bigpath", agent: false,
      headers: { host: `127.0.0.1:${port}`, ...(i % 3 ? { range: "bytes=0-" } : {}) } }, (res) => {
      res.once("data", () => { req.destroy(); resolve(res.statusCode); });
    });
    req.on("error", () => resolve(0));
  });
  const codes = [];
  for (let i = 0; i < 20; i++) codes.push(one(i));
  const got = await Promise.all(codes);
  assert.ok(got.every((c) => c === 200 || c === 206), String(got));
  let now = openOf(big);
  for (let t = 0; t < 40 && now > before; t++) {
    await new Promise((r) => setTimeout(r, 100));
    now = openOf(big);
  }
  assert.equal(now, before, `descriptors left open on the file: ${now - before}`);
  assert.equal((await call(h.url, "GET", "/healthz")).status, 200);
});

test("10 requests given up while the route still waits after opening the file leave no descriptor open", async () => {
  const big = join(dir, "big.bin");
  const before = openOf(big);
  const port = new URL(h.url).port;
  const one = () => new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/r/slow", agent: false, headers: { host: `127.0.0.1:${port}` } });
    req.on("error", () => resolve());
    setTimeout(() => { req.destroy(); resolve(); }, 100);
  });
  await Promise.all(Array.from({ length: 10 }, one));
  await new Promise((r) => setTimeout(r, 1000));
  let now = openOf(big);
  for (let t = 0; t < 40 && now > before; t++) {
    await new Promise((r) => setTimeout(r, 100));
    now = openOf(big);
  }
  assert.equal(now, before, `descriptors left open on the file: ${now - before}`);
  assert.equal((await call(h.url, "GET", "/healthz")).status, 200);
});

test("the home screen still answers after many ranged requests (descriptors are closed)", async () => {
  const all = [];
  for (let i = 0; i < 60; i++) all.push(get("/api/r/fd", i % 2 ? `bytes=${i}-` : "bytes=999999-"));
  const out = await Promise.all(all);
  assert.ok(out.every((r) => r.status === 206 || r.status === 416));
  assert.equal((await call(h.url, "GET", "/healthz")).status, 200);
});
