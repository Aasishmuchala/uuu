// The archive rules of K15 row 4, before a byte reaches the disk. Archives are built here
// byte by byte, so every kind of hostile entry can be made; nothing is ever unpacked from a
// refused archive. Temp folders only, removed at the end.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MAX_TAR_BYTES, readTar, unpack, writeTar } from "../tar.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const folder = () => { const d = mkdtempSync(join(tmpdir(), "viewer-tar-")); dirs.push(d); return d; };
const MB = 1024 * 1024;

// One raw ustar header and its data. flag: "0" file, "5" folder, "1" hard link, "2" link,
// "3"/"4" devices, "6" pipe, "x" pax, "L" GNU long name.
function entry(name, { flag = "0", data = Buffer.alloc(0), size, linkname = "", prefix = "", magic = "ustar\0", badSum = false, sizeText } = {}) {
  const h = Buffer.alloc(512);
  const put = (text, at, len) => Buffer.from(text, "latin1").copy(h, at, 0, len);
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const n = size === undefined ? body.length : size;
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(sizeText || `${n.toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  h.fill(0x20, 148, 156);
  h[156] = flag.charCodeAt(0);
  put(linkname, 157, 100);
  put(magic, 257, 6);
  put(magic === "ustar\0" ? "00" : " \0", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  put(`${(badSum ? sum + 1 : sum).toString(8).padStart(6, "0")}\0 `, 148, 8);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([h, body, pad]);
}
const end = () => Buffer.alloc(1024);
const tar = (...parts) => Buffer.concat([...parts, end()]);
const index = () => entry("index.html", { data: "<!doctype html><title>x</title>" });
const pax = (records) => {
  const body = records.map(([k, v]) => {
    const rest = ` ${k}=${v}\n`;
    let len = rest.length + 1;
    while (`${len}${rest}`.length !== len) len = `${len}${rest}`.length;
    return `${len}${rest}`;
  }).join("");
  return entry("PaxHeader", { flag: "x", data: body });
};

function refused(buf, pattern) {
  const r = readTar(buf);
  assert.equal(r.ok, false, `should be refused: ${pattern}`);
  if (pattern) assert.match(r.reason, pattern);
  return r;
}

test("a plain site is read: files, folders, sizes; ./ in front is how tar writes this folder", () => {
  const r = readTar(tar(entry("./", { flag: "5" }), entry("./index.html", { data: "<h1>hi</h1>" }), entry("css/", { flag: "5" }),
    entry("css/site.css", { data: "body{}" }), entry("img/logo.svg", { data: "<svg/>" })));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, ["index.html", "css/site.css", "img/logo.svg"]);
  assert.equal(r.bytes, 11 + 6 + 6);
  assert.deepEqual(r.entries.map((e) => [e.name, e.type]), [["index.html", "file"], ["css", "dir"], ["css/site.css", "file"], ["img/logo.svg", "file"]]);
  assert.equal(r.entries[0].data.toString(), "<h1>hi</h1>");
});

test("gzip is read the same; the ustar prefix field and a pax path are names too", () => {
  const deep = "a1/b2/c3/d4/e5";
  const plain = tar(index(), entry("page.html", { prefix: deep, data: "x" }), pax([["path", "about/team.html"], ["mtime", "1"]]), entry("ignored-name", { data: "y" }));
  const r = readTar(gzipSync(plain));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, ["index.html", `${deep}/page.html`, "about/team.html"]);
});

test("writeTar writes what readTar reads, long names through pax", () => {
  const long = `${"a".repeat(70)}/${"b".repeat(70)}/${"c".repeat(70)}/${"d".repeat(70)}.html`;
  const files = [{ name: "index.html", data: Buffer.from("<p>1</p>") }, { name: long, data: Buffer.from("2") }, { name: "x/y.png", data: Buffer.alloc(1000, 7) }];
  const r = readTar(writeTar(files));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, files.map((f) => f.name));
  assert.deepEqual(r.entries.find((e) => e.name === "x/y.png").data, Buffer.alloc(1000, 7));
});

test("names: absolute, .., a space, odd characters, too deep, a .php ending, no index.html", () => {
  refused(tar(index(), entry("/etc/passwd.txt", { data: "x" })), /absolute/);
  refused(tar(index(), entry("../x.html", { data: "x" })), /\.\./);
  refused(tar(index(), entry("a/../../x.html", { data: "x" })), /\.\./);
  refused(tar(index(), pax([["path", "../../escape.html"]]), entry("fine.html", { data: "x" })), /\.\./);
  refused(tar(index(), entry("my page.html", { data: "x" })), /not plain/);
  refused(tar(index(), entry("café.html", { data: "x" })), /not plain/);
  refused(tar(index(), entry(".hidden.css", { data: "x" })), /not plain/);
  refused(tar(index(), entry("._index.html", { data: "x" })), /not plain/);
  refused(tar(index(), entry("a\\b.html", { data: "x" })), /not plain/);
  refused(tar(index(), entry("a/b/c/d/e/f/g.html", { data: "x" })), /deep/);
  refused(tar(index(), entry(`${"n".repeat(81)}.html`, { data: "x" })), /not plain/);
  refused(tar(index(), entry("shell.php", { data: "<?php" })), /ending/);
  refused(tar(index(), entry("run.sh", { data: "x" })), /ending/);
  refused(tar(index(), entry("noending", { data: "x" })), /ending/);
  refused(tar(entry("about.html", { data: "x" })), /index\.html/);
  refused(tar(entry("site/index.html", { data: "x" })), /index\.html/);
  refused(tar(index(), entry("Index.HTML", { data: "x" })), /twice/);
  refused(tar(index(), entry("a.html", { data: "x" }), entry("a.html/b.css", { data: "x" })), /file and a folder/);
  refused(tar(index(), entry("ctl\u0001.html", { data: "x" })), /not plain/);
});

test("only plain files and folders: links, hard links, devices, pipes, GNU long names", () => {
  refused(tar(index(), entry("hosts.txt", { flag: "2", linkname: "/etc/hosts" })), /a link/);
  refused(tar(index(), entry("hard.txt", { flag: "1", linkname: "index.html" })), /hard link/);
  refused(tar(index(), entry("dev.txt", { flag: "3" })), /device/);
  refused(tar(index(), entry("blk.txt", { flag: "4" })), /device/);
  refused(tar(index(), entry("fifo.txt", { flag: "6" })), /pipe/);
  refused(tar(index(), entry("././@LongLink", { flag: "L", data: "x.html" })), /long-name/);
});

test("limits: 300 entries, 10 MB a file, 20 MB in all, 20 MB as sent", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => entry(`f${i}.txt`, { data: "x" }));
  assert.equal(readTar(tar(index(), ...many(299))).ok, true);
  refused(tar(index(), ...many(300)), /300 entries/);
  refused(tar(index(), ...Array.from({ length: 300 }, (_, i) => entry(`d${i}`, { flag: "5" }))), /300 entries/);
  assert.equal(readTar(tar(index(), entry("ten.png", { data: Buffer.alloc(10 * MB) }))).ok, true);
  refused(tar(index(), entry("eleven.png", { data: Buffer.alloc(11 * MB) })), /over 10 MB/);
  refused(tar(index(), entry("a.png", { data: Buffer.alloc(9 * MB) }), entry("b.png", { data: Buffer.alloc(9 * MB) }),
    entry("c.png", { data: Buffer.alloc(3 * MB) })), /over 20 MB/);
  refused(Buffer.alloc(20 * MB + 1), /over 20 MB/);
});

test("a gzip bomb is stopped at the cap, without unpacking it whole", () => {
  // 1 GB of zeros compresses to about 1 MB: refused once the cap is passed
  const bomb = gzipSync(Buffer.alloc(200 * MB), { level: 9 });
  assert.ok(bomb.length < 1 * MB);
  const before = process.memoryUsage().rss;
  refused(bomb, /over 20 MB unpacked/);
  assert.ok(process.memoryUsage().rss - before < 150 * MB, "memory stayed bounded");
  assert.ok(MAX_TAR_BYTES < 22 * MB);
  refused(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3]), /damaged/);
});

test("damaged archives: checksum, size field, cut short, not ustar, empty", () => {
  refused(tar(entry("index.html", { data: "x", badSum: true })), /checksum/);
  refused(tar(entry("index.html", { data: "x", sizeText: "\x80\0\0\0\0\0\0\0\0\0\0\x01" })), /size/);
  refused(index().subarray(0, 600), /middle/);
  refused(tar(entry("index.html", { data: "x", magic: "abcde\0" })), /ustar/);
  refused(Buffer.alloc(0), /not a tar/);
  refused(Buffer.from("not a tar at all"), /not a tar/);
  refused(tar(entry("index.html", { flag: "5", size: 4, data: "abcd" })), /folder has a size/);
  refused(tar(index(), pax([["path", "x.html"]])), /extended header/);
  refused("a string", /bytes/);
});

test("unpack writes files 0600 in 0700 folders into a fresh folder, and nothing else", () => {
  const r = readTar(tar(index(), entry("css/a.css", { data: "a{}" }), entry("empty", { flag: "5" })));
  const root = join(folder(), "site");
  unpack(r.entries, root);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, "css")).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, "css/a.css")).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(root, "empty")).isDirectory(), true);
  assert.equal(readFileSync(join(root, "css/a.css"), "utf8"), "a{}");
  assert.deepEqual(readdirSync(root).sort(), ["css", "empty", "index.html"]);
  assert.throws(() => unpack(r.entries, root), /EEXIST/, "never into a folder that exists");
});

test("a refused archive leaves nothing on disk (the check comes before any write)", () => {
  const d = folder();
  const r = readTar(tar(index(), entry("ok.css", { data: "x" }), entry("../evil.html", { data: "x" })));
  assert.equal(r.ok, false);
  assert.equal(r.entries, undefined, "no entries handed out");
  assert.deepEqual(readdirSync(d), []);
  assert.equal(existsSync(join(d, "..", "evil.html")), false);
});
