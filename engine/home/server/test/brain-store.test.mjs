// The company brain's store (CONTRACTS-V3 32.2), on a temp folder: names, kinds by ending and first bytes,
// limits, no overwrite, links refused, tokens only for listed files, versions on move/remove/replace,
// nothing executable, and its own search index.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainError, brainToken, cleanName, createBrain } from "../brain/store.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

function withBrain(fn, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "uuu-brain-store-"));
  const config = {
    engineDir: join(root, "engine"),
    minFreeDiskGb: options.minFreeDiskGb ?? 0,
    paths: { knowledgeDocs: join(root, "state", "knowledge", "docs"), homeData: join(root, "state", "home"), state: join(root, "state") },
  };
  mkdirSync(config.paths.knowledgeDocs, { recursive: true });
  const brain = createBrain(config, { freeBytes: options.freeBytes || (() => 500 * 1024 ** 3) });
  try { return fn({ brain, config, docs: config.paths.knowledgeDocs, root }); } finally { rmSync(root, { recursive: true, force: true }); }
}

// The code of the BrainError fn throws.
function codeOf(fn) {
  try { fn(); } catch (e) { assert.ok(e instanceof BrainError, String(e)); return `${e.status} ${e.code}`; }
  return "no error";
}

const notExecutable = (p) => (statSync(p).mode & 0o111) === 0;
const noTemp = (dir) => readdirSync(dir).filter((n) => n.startsWith(".")).length === 0;

test("cleanName: path parts, dots, a NUL and odd characters are dropped; endings are lower-cased; a long name is capped", () => {
  const cases = [
    ["../x.md", "x.md"], ["brand/../../etc/passwd", "passwd.md"], ["..\\..\\y.txt", "y.txt"], [".hidden.md", "hidden.md"],
    ["a\0b.md", "ab.md"], ["Photo.JPG", "Photo.jpg"], ["prices", "prices.md"], ["list.CSV", "list.csv"], ["v1.2", "v1.2.md"],
  ];
  for (const [input, want] of cases) assert.equal(cleanName(input), want, input);
  const long = cleanName(`${"a".repeat(300)}.png`);
  assert.ok(long.length <= 100 && long.endsWith(".png"));
  for (const bad of ["..", "", "***", ".", "/"]) assert.equal(codeOf(() => cleanName(bad)), "400 name_empty", bad);
  assert.equal(codeOf(() => cleanName(5)), "400 name_missing");
});

test("only the endings of 32.2: SVG, HTML, scripts, archives, audio and video are refused by name", () => {
  for (const n of ["logo.svg", "page.html", "page.htm", "run.sh", "x.js", "a.zip", "a.tar.gz", "song.mp3", "clip.mp4", "x.exe", "x.json"]) {
    assert.equal(codeOf(() => cleanName(n)), "400 name_type", n);
  }
  withBrain(({ brain, docs }) => {
    assert.equal(codeOf(() => brain.add({ folder: "brand", name: "logo.svg", text: "<svg onload=alert(1)>" })), "400 name_type");
    assert.equal(codeOf(() => brain.add({ folder: "brand", name: "x.html", bytes: Buffer.from("<html></html>") })), "400 name_type");
    assert.equal(existsSync(join(docs, "brand", "logo.svg")), false);
  });
});

test("add text: written in place, mode 0644, never executable, no temp file left, and it fits the brain-file shape", () => {
  withBrain(({ brain, docs }) => {
    const f = brain.add({ folder: "brand", name: "voice.md", text: "We sound warm and plain." });
    assert.deepEqual(sameShape(readShape("brain-file"), f), []);
    assert.equal(f.path, "brand/voice.md");
    assert.equal(f.token, brainToken("brand/voice.md"));
    assert.equal(f.kind, "text");
    assert.equal(f.rawUrl, null);
    assert.equal(f.downloadUrl, `/api/brain/raw/${f.token}?download=1`);
    const p = join(docs, "brand", "voice.md");
    assert.equal(readFileSync(p, "utf8"), "We sound warm and plain.");
    assert.equal(statSync(p).mode & 0o777, 0o644);
    assert.ok(notExecutable(p));
    assert.ok(noTemp(join(docs, "brand")));
  });
});

test("a name with a slash, .., a leading dot or a NUL lands inside its folder under a clean name", () => {
  withBrain(({ brain, docs, root }) => {
    const names = ["../../escape.md", "/etc/hosts.md", ".dotfile.md", "nul\0name.md", "brand/../x.md"];
    const got = names.map((name) => brain.add({ folder: "calls", name, text: "notes" }).path);
    assert.deepEqual(got, ["calls/escape.md", "calls/hosts.md", "calls/dotfile.md", "calls/nulname.md", "calls/x.md"]);
    assert.equal(existsSync(join(root, "state", "escape.md")), false);
    assert.equal(existsSync(join(docs, "escape.md")), false);
  });
});

test("a folder not in the list is refused, and nothing deeper than one level is made", () => {
  withBrain(({ brain, docs }) => {
    for (const folder of ["nope", "../home", "brand/deeper", "", null, ".."]) {
      assert.equal(codeOf(() => brain.add({ folder, name: "a.md", text: "hello" })), "404 folder_not_found", String(folder));
    }
    assert.deepEqual(readdirSync(docs), []);
    const loose = brain.add({ folder: "loose", name: "root-note.md", text: "in the root" });
    assert.equal(loose.path, "root-note.md");
    assert.equal(loose.folder, "loose");
  });
});

test("a folder that is a link is refused: nothing is written through it and its files are not listed", () => {
  withBrain(({ brain, docs, root }) => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "secret.md"), "not the brain's");
    symlinkSync(elsewhere, join(docs, "brand"));
    assert.equal(codeOf(() => brain.add({ folder: "brand", name: "a.md", text: "hello" })), "404 folder_not_found");
    assert.deepEqual(readdirSync(elsewhere), ["secret.md"]);
    assert.deepEqual(brain.list(), []);
    assert.equal(codeOf(() => brain.get(brainToken("brand/secret.md"))), "404 file_not_found");
  });
});

test("a file that is a link, a dot file and an odd name are not listed, and their tokens are refused", () => {
  withBrain(({ brain, docs, root }) => {
    writeFileSync(join(root, "outside.md"), "outside the brain");
    mkdirSync(join(docs, "brand"));
    symlinkSync(join(root, "outside.md"), join(docs, "brand", "link.md"));
    writeFileSync(join(docs, "brand", ".hidden.md"), "hidden");
    writeFileSync(join(docs, "brand", "page.html"), "<script>1</script>");
    writeFileSync(join(docs, "brand", "-dash.md"), "odd");
    mkdirSync(join(docs, "brand", "deeper"));
    writeFileSync(join(docs, "brand", "deeper", "x.md"), "too deep");
    writeFileSync(join(docs, "brand", "real.md"), "a real file");
    assert.deepEqual(brain.list().map((f) => f.path), ["brand/real.md"]);
    for (const p of ["brand/link.md", "brand/.hidden.md", "brand/page.html", "brand/-dash.md", "brand/deeper/x.md"]) {
      assert.equal(codeOf(() => brain.get(brainToken(p))), "404 file_not_found", p);
      assert.equal(codeOf(() => brain.raw(brainToken(p))), "404 file_not_found", p);
    }
  });
});

test("a token is accepted only when it names a file in the current listing", () => {
  withBrain(({ brain }) => {
    const f = brain.add({ folder: "brand", name: "a.md", text: "hello there" });
    assert.equal(brain.get(f.token).text, "hello there");
    const bad = ["", "!!", brainToken("brand/missing.md"), brainToken("../a.md"), brainToken("brand/../brand/a.md"), brainToken("/brand/a.md"),
      brainToken("loose/a.md"), brainToken("brand//a.md"), `${f.token}=`, "x".repeat(500), brainToken("nope/a.md")];
    for (const t of bad) assert.equal(codeOf(() => brain.get(t)), "404 file_not_found", t);
  });
});

test("an image's first bytes must agree with its name: a PNG named .jpg is refused, a real PNG and JPEG are kept", () => {
  withBrain(({ brain, docs }) => {
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "photo.jpg", bytes: PNG })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "photo.png", bytes: Buffer.from("<html>not a png</html>") })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "photo.webp", bytes: JPEG })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "pasted.png", text: "pasted text" })), "400 kind_mismatch");
    assert.equal(existsSync(join(docs, "references", "photo.jpg")), false);
    const p = brain.add({ folder: "references", name: "photo.png", bytes: PNG });
    const j = brain.add({ folder: "references", name: "photo.jpeg", bytes: JPEG });
    assert.equal(p.kind, "image");
    assert.equal(p.rawUrl, `/api/brain/raw/${p.token}`);
    assert.equal(j.kind, "image");
    assert.equal(brain.raw(p.token).type, "image/png");
    assert.equal(brain.raw(j.token).type, "image/jpeg");
  });
});

test("text must be UTF-8 with no NUL; a PDF must start %PDF-; empty content is refused", () => {
  withBrain(({ brain }) => {
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "a.md", text: "has a \0 in it" })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "a.txt", bytes: Buffer.from([0x68, 0xff, 0xfe, 0x69]) })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "a.csv", bytes: Buffer.from("a,b\0,c") })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "doc.pdf", bytes: Buffer.from("PDF-1.4 but not quite") })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "doc.pdf", bytes: PNG })), "400 kind_mismatch");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "e.md", text: "   " })), "400 text_missing");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "e.md", bytes: Buffer.alloc(0) })), "400 text_missing");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "e.md" })), "400 bad_request");
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "e.md", text: "x", bytes: Buffer.from("x") })), "400 bad_request");
    const pdf = brain.add({ folder: "references", name: "doc.pdf", bytes: PDF });
    assert.equal(pdf.kind, "pdf");
    assert.equal(pdf.rawUrl, null);
    const csv = brain.add({ folder: "pricing", name: "list.csv", text: "name,price\nwidget,10\n" });
    assert.equal(csv.kind, "table");
  });
});

test("a file over its limit is refused: text over 2 MB, a picture or a PDF over 10 MB", () => {
  withBrain(({ brain, docs }) => {
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "big.md", text: "a".repeat(2 * 1024 * 1024 + 1) })), "413 too_large");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "big.png", bytes: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) })), "413 too_large");
    assert.equal(codeOf(() => brain.add({ folder: "references", name: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) })), "413 too_large");
    assert.ok(!existsSync(join(docs, "calls", "big.md")));
    assert.equal(brain.add({ folder: "calls", name: "edge.md", text: "a".repeat(2 * 1024 * 1024) }).size, 2 * 1024 * 1024);
  });
});

test("the 501st file is refused, and so is a file that takes the brain over 200 MB", () => {
  withBrain(({ brain, docs }) => {
    mkdirSync(join(docs, "calls"));
    for (let i = 0; i < 500; i++) writeFileSync(join(docs, "calls", `n${i}.md`), "x");
    assert.equal(brain.list().length, 500);
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "one-more.md", text: "hello" })), "409 brain_full");
    assert.equal(existsSync(join(docs, "calls", "one-more.md")), false);
  });
  withBrain(({ brain, docs }) => {
    mkdirSync(join(docs, "references"));
    // Sparse files: their size counts, they take no room on the disk.
    for (const n of ["a.pdf", "b.pdf"]) { writeFileSync(join(docs, "references", n), "%PDF-"); truncateSync(join(docs, "references", n), 100 * 1024 * 1024); }
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "one-more.md", text: "hello" })), "409 brain_full");
  });
});

test("an upload is refused when the disk would fall under the floor", () => {
  withBrain(({ brain, docs }) => {
    assert.equal(codeOf(() => brain.add({ folder: "calls", name: "a.md", text: "hello" })), "409 disk_low");
    assert.equal(existsSync(join(docs, "calls", "a.md")), false);
  }, { minFreeDiskGb: 8, freeBytes: () => 8 * 1024 ** 3 + 2 });
  withBrain(({ brain }) => {
    assert.equal(brain.add({ folder: "calls", name: "a.md", text: "hello" }).path, "calls/a.md");
  }, { minFreeDiskGb: 8, freeBytes: () => 9 * 1024 ** 3 });
});

test("a second file of the same name is 409 and the first is untouched; nothing is ever overwritten by an upload", () => {
  withBrain(({ brain, docs }) => {
    const first = brain.add({ folder: "brand", name: "brand.md", text: "the first" });
    const before = statSync(join(docs, "brand", "brand.md"));
    assert.equal(codeOf(() => brain.add({ folder: "brand", name: "brand.md", text: "the second" })), "409 file_exists");
    assert.equal(codeOf(() => brain.add({ folder: "brand", name: "../brand.md", text: "the third" })), "409 file_exists");
    assert.equal(readFileSync(join(docs, "brand", "brand.md"), "utf8"), "the first");
    const after = statSync(join(docs, "brand", "brand.md"));
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(brain.get(first.token).file.version, first.version);
    assert.ok(noTemp(join(docs, "brand")));
  });
});

test("move: a stale version is 409 and nothing moves; then it moves, keeps its bytes, and never replaces a file", () => {
  withBrain(({ brain, docs }) => {
    const f = brain.add({ folder: "calls", name: "visit.md", text: "site visit notes" });
    assert.equal(codeOf(() => brain.move(f.token, "customers", "1")), "409 changed_since_seen");
    assert.equal(codeOf(() => brain.move(f.token, "customers", undefined)), "409 changed_since_seen");
    assert.ok(existsSync(join(docs, "calls", "visit.md")));
    assert.equal(codeOf(() => brain.move(f.token, "nope", f.version)), "404 folder_not_found");
    brain.add({ folder: "customers", name: "visit.md", text: "already here" });
    assert.equal(codeOf(() => brain.move(f.token, "customers", f.version)), "409 file_exists");
    assert.equal(readFileSync(join(docs, "customers", "visit.md"), "utf8"), "already here");
    assert.ok(existsSync(join(docs, "calls", "visit.md")));
    const moved = brain.move(f.token, "loose", f.version);
    assert.equal(moved.path, "visit.md");
    assert.equal(readFileSync(join(docs, "visit.md"), "utf8"), "site visit notes");
    assert.equal(existsSync(join(docs, "calls", "visit.md")), false);
    assert.ok(notExecutable(join(docs, "visit.md")));
    assert.equal(codeOf(() => brain.get(f.token)), "404 file_not_found");
  });
});

test("remove: a stale version is 409 and the file stays; the right version removes it", () => {
  withBrain(({ brain, docs }) => {
    const f = brain.add({ folder: "calls", name: "old.md", text: "old notes" });
    utimesSync(join(docs, "calls", "old.md"), new Date(), new Date(Date.now() + 5000));
    assert.equal(codeOf(() => brain.remove(f.token, f.version)), "409 changed_since_seen");
    assert.ok(existsSync(join(docs, "calls", "old.md")));
    const now = brain.get(f.token).file;
    assert.deepEqual(brain.remove(f.token, now.version), { ok: true });
    assert.equal(existsSync(join(docs, "calls", "old.md")), false);
    assert.equal(codeOf(() => brain.remove(f.token, now.version)), "404 file_not_found");
  });
});

test("replace (forms only): only at the file's version; a new file only with no version; never executable", () => {
  withBrain(({ brain, docs }) => {
    const made = brain.replace("brand/brand.md", "# Brand\n\n## Tone\n- warm\n", null);
    assert.equal(made.form, "brand");
    assert.equal(codeOf(() => brain.replace("brand/brand.md", "# Brand\n", null)), "409 changed_since_seen");
    assert.equal(codeOf(() => brain.replace("brand/brand.md", "# Brand\n", "12")), "409 changed_since_seen");
    assert.equal(readFileSync(join(docs, "brand", "brand.md"), "utf8"), "# Brand\n\n## Tone\n- warm\n");
    utimesSync(join(docs, "brand", "brand.md"), new Date(), new Date(Date.now() - 60000));
    const seen = brain.find("brand/brand.md");
    const next = brain.replace("brand/brand.md", "# Brand\n\n## Tone\n- plain\n", seen.version);
    assert.notEqual(next.version, seen.version);
    assert.equal(readFileSync(join(docs, "brand", "brand.md"), "utf8"), "# Brand\n\n## Tone\n- plain\n");
    assert.ok(notExecutable(join(docs, "brand", "brand.md")));
    assert.ok(noTemp(join(docs, "brand")));
    assert.equal(codeOf(() => brain.replace("brand/x.png", "x", null)), "400 name_empty");
    assert.equal(codeOf(() => brain.replace("../brand.md", "x", null)), "404 folder_not_found");
    assert.equal(codeOf(() => brain.replace("brand/a/b.md", "x", null)), "404 folder_not_found");
    assert.equal(codeOf(() => brain.replace("brand/n.md", "a\0b", null)), "400 kind_mismatch");
  });
});

test("get: text and tables as text (capped at 262144 bytes), pictures and PDF files with no text", () => {
  withBrain(({ brain }) => {
    const big = brain.add({ folder: "calls", name: "long.md", text: `${"é".repeat(200000)}` });
    const g = brain.get(big.token);
    assert.equal(g.truncated, true);
    assert.ok(Buffer.byteLength(g.text) <= 262144);
    assert.ok(!g.text.includes("�"));
    const img = brain.add({ folder: "references", name: "p.png", bytes: PNG });
    assert.deepEqual(brain.get(img.token), { file: img, text: null, truncated: false });
  });
});

test("raw: a picture whose bytes do not match its name gets no image type (it is sent as a download)", () => {
  withBrain(({ brain, docs }) => {
    mkdirSync(join(docs, "references"));
    writeFileSync(join(docs, "references", "fake.png"), "<html><script>alert(1)</script></html>");
    const f = brain.list().find((x) => x.name === "fake.png");
    assert.equal(brain.raw(f.token).type, null);
  });
});

test("the listing: newest first, the form a basic came from, files in the root under loose", () => {
  withBrain(({ brain, docs }) => {
    writeFileSync(join(docs, "returns-policy.md"), "Returns within 30 days.");
    utimesSync(join(docs, "returns-policy.md"), new Date(), new Date(Date.now() - 3600000));
    brain.add({ folder: "brand", name: "brand.md", text: "# Brand" });
    const list = brain.list();
    assert.deepEqual(list.map((f) => f.path), ["brand/brand.md", "returns-policy.md"]);
    assert.equal(list[0].form, "brand");
    assert.equal(list[1].form, null);
    assert.equal(list[1].folder, "loose");
    assert.equal(brain.folders().length, 10);
  });
});

test("search: words in text and tables, pictures and PDF files by name only, never broken by what is typed", () => {
  withBrain(({ brain, config }) => {
    brain.add({ folder: "policies", name: "warranty.md", text: "Our warranty lasts 27 months on every cabinet." });
    brain.add({ folder: "pricing", name: "list.csv", text: "item,price\nhinge,40\n" });
    brain.add({ folder: "references", name: "kitchen-photo.png", bytes: PNG });
    brain.add({ folder: "references", name: "brochure.pdf", bytes: Buffer.from("%PDF-1.4 cabinet hinge warranty") });
    const w = brain.search("warranty");
    assert.deepEqual(w.map((r) => r.path), ["policies/warranty.md"]);
    assert.match(w[0].snippet, /27 months/);
    assert.equal(w[0].token, brainToken("policies/warranty.md"));
    assert.deepEqual(brain.search("hinge").map((r) => r.path), ["pricing/list.csv"]);
    assert.deepEqual(brain.search("kitchen").map((r) => r.path), ["references/kitchen-photo.png"]);
    assert.deepEqual(brain.search("brochure").map((r) => r.path), ["references/brochure.pdf"]);
    for (const q of ['"', "AND (", "*", 'NEAR("x" "y")', "name:warranty*", "'; DROP TABLE brain_fts; --", "^", "日本"]) {
      assert.ok(Array.isArray(brain.search(q)), q);
    }
    assert.deepEqual(brain.search(""), []);
    assert.ok(existsSync(join(config.paths.homeData, "brain.sqlite")));
    for (let i = 0; i < 30; i++) brain.add({ folder: "calls", name: `call-${i}.md`, text: "cabinet call" });
    assert.equal(brain.search("cabinet").length, 20);
  });
});

test("the index is a cache: a damaged index file is thrown away and rebuilt", () => {
  withBrain(({ brain, config }) => {
    brain.add({ folder: "policies", name: "warranty.md", text: "warranty words" });
    assert.equal(brain.search("warranty").length, 1);
    writeFileSync(join(config.paths.homeData, "brain.sqlite"), "not a database at all");
    assert.equal(brain.search("warranty").length, 1);
  });
});

test("a file swapped for a link after it was listed is neither moved nor removed, and the link's target is untouched", () => {
  withBrain(({ brain, docs, root }) => {
    const f = brain.add({ folder: "calls", name: "swap.md", text: "the owner's notes" });
    const target = join(root, "target.md");
    writeFileSync(target, "outside");
    rmSync(join(docs, "calls", "swap.md"));
    symlinkSync(target, join(docs, "calls", "swap.md"));
    assert.equal(codeOf(() => brain.remove(f.token, f.version)), "404 file_not_found");
    assert.equal(codeOf(() => brain.move(f.token, "customers", f.version)), "404 file_not_found");
    assert.equal(readFileSync(target, "utf8"), "outside");
    assert.equal(existsSync(join(docs, "customers", "swap.md")), false);
  });
});
