// sitefiles.mjs (the rules, collectSite, the served site's headers) and zip.mjs. Temp
// folders only, removed at the end.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITE_HEADERS, SITE_POLICY, TYPES, checkEntries, collectSite, nameProblem, siteHandler, typeFor } from "../sitefiles.mjs";
import { writeZip } from "../zip.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const folder = () => { const d = mkdtempSync(join(tmpdir(), "viewer-site-")); dirs.push(d); return d; };
const MB = 1024 * 1024;

test("every ending has one fixed type, and nothing else is served", () => {
  assert.deepEqual(Object.keys(TYPES).sort(), ["avif", "css", "gif", "html", "ico", "jpeg", "jpg", "js", "json", "mjs", "mp4", "otf", "png", "svg", "ttf", "txt", "webm", "webp", "woff", "woff2"]);
  assert.equal(typeFor("a/b.HTML"), "text/html; charset=utf-8");
  assert.equal(typeFor("x.js"), "text/javascript; charset=utf-8");
  for (const n of ["x.php", "x.htm", "x.shtml", "x.xhtml", "x.wasm", "x.pdf", "x", "x.html.exe"]) assert.equal(typeFor(n), null, n);
});

test("the content policy is K15's, with the other headers", () => {
  assert.equal(SITE_POLICY, "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'");
  assert.equal(SITE_HEADERS["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(SITE_HEADERS["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(SITE_HEADERS["Referrer-Policy"], "no-referrer");
  assert.equal(SITE_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.equal(Object.keys(SITE_HEADERS).some((k) => /cookie/i.test(k)), false);
});

test("checkEntries applies the same rules as the archive", () => {
  const f = (name, size = 1) => ({ name, type: "file", size });
  assert.equal(checkEntries([f("index.html"), f("a/b.css")]).ok, true);
  assert.equal(checkEntries([f("a.html")]).ok, false);
  assert.match(checkEntries([f("index.html"), { name: "l.txt", type: "link", size: 0 }]).reason, /plain files/);
  assert.match(checkEntries([f("index.html"), f("x.png", 10 * MB + 1)]).reason, /10 MB/);
  assert.match(checkEntries(Array.from({ length: 301 }, (_, i) => f(i ? `f${i}.txt` : "index.html"))).reason, /300/);
  assert.equal(nameProblem("a/b/c/d/e/f.html", "file"), null);
  assert.match(nameProblem("a/b/c/d/e/f/g.html", "file"), /deep/);
  assert.match(nameProblem("x..y.html", "file"), /\.\./);
});

test("collectSite leaves out a link to /etc/hosts, hidden files and odd names, and reads the rest", () => {
  const d = join(folder(), "site");
  mkdirSync(join(d, "css"), { recursive: true });
  writeFileSync(join(d, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(d, "css", "a.css"), "a{}");
  writeFileSync(join(d, ".DS_Store"), "x");
  writeFileSync(join(d, "notes.md"), "x");
  writeFileSync(join(d, "my page.html"), "x");
  symlinkSync("/etc/hosts", join(d, "hosts.txt"));
  symlinkSync("/etc", join(d, "etc"));
  const r = collectSite(d);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files.map((f) => f.name), ["css/a.css", "index.html"]);
  assert.equal(r.files.some((f) => f.data.toString().includes("localhost")), false);
  assert.deepEqual(r.left.map((l) => l.name).sort(), [".DS_Store", "etc", "hosts.txt", "my page.html", "notes.md"]);
  assert.equal(r.left.find((l) => l.name === "hosts.txt").why, "a link");
});

test("collectSite refuses a site folder that is a link, has no index.html, or is too big", () => {
  const base = folder();
  const real = join(base, "real");
  mkdirSync(real);
  writeFileSync(join(real, "index.html"), "x");
  symlinkSync(real, join(base, "link"));
  assert.equal(collectSite(join(base, "link")).ok, false);
  assert.equal(collectSite(join(base, "none")).ok, false);
  const noIndex = join(base, "noindex");
  mkdirSync(noIndex);
  writeFileSync(join(noIndex, "a.html"), "x");
  assert.match(collectSite(noIndex).reason, /index\.html/);
  writeFileSync(join(real, "big.png"), Buffer.alloc(10 * MB + 1));
  assert.match(collectSite(real).reason, /10 MB/);
});

test("the served site: listed files only, fixed types, every header, a query ignored, nothing decoded", async () => {
  const files = new Map([["index.html", Buffer.from("<h1>i</h1>")], ["a/b.css", Buffer.from("b{}")], ["a/index.html", Buffer.from("sub")]]);
  const missing = [];
  const server = http.createServer(siteHandler(() => files, { onMissing: (n) => missing.push(n) }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.equal(await home.text(), "<h1>i</h1>");
    for (const [k, v] of Object.entries(SITE_HEADERS)) assert.equal(home.headers.get(k), v, k);
    assert.equal(home.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(home.headers.get("set-cookie"), null);
    const css = await fetch(`${base}/a/b.css?v=2`);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(await (await fetch(`${base}/a/`)).text(), "sub");
    for (const p of ["/x.css", "/a%2fb.css", "/../index.html", "/%2e%2e/etc/hosts"]) {
      // sent as written: fetch() would tidy "/../" away before it left
      const r = await new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: server.address().port, path: p, agent: false }, (res) => { res.resume(); resolve(res); }).on("error", reject);
      });
      assert.equal(r.statusCode, 404, p);
      assert.equal(r.headers["content-security-policy"], SITE_POLICY);
    }
    assert.equal((await fetch(`${base}/index.html`, { method: "POST", body: "x" })).status, 405);
    assert.deepEqual(missing, ["x.css"]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("writeZip makes a zip the system's unzip reads back, and refuses a bad name", () => {
  const files = [{ name: "index.html", data: Buffer.from("<h1>hello</h1>".repeat(50)) }, { name: "img/a.png", data: Buffer.alloc(300, 9) }];
  const zip = writeZip(files, { now: Date.UTC(2026, 10, 12) });
  const d = folder();
  writeFileSync(join(d, "site.zip"), zip);
  const list = execFileSync("/usr/bin/unzip", ["-Z1", join(d, "site.zip")], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(list, ["index.html", "img/a.png"]);
  const out = execFileSync("/usr/bin/unzip", ["-p", join(d, "site.zip"), "index.html"]);
  assert.equal(out.toString(), files[0].data.toString());
  execFileSync("/usr/bin/unzip", ["-tq", join(d, "site.zip")]);
  assert.throws(() => writeZip([...files, { name: "../evil.html", data: Buffer.from("x") }]), /\.\./);
  assert.throws(() => writeZip([{ name: "a.html", data: Buffer.from("x") }]), /index\.html/);
});
