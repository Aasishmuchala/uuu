// The brain's indexer (PLAN-BRAIN T6, D1, B1, B2, B7): built in a temp state from the fixture's files and the
// stub bench's seed, published by rename, read back through `ask`. No live state, no fixed port.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStubBench } from "../../../test/stubs/bench.mjs";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { createBench } from "../lib/bench.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { createIndexer, indexFor } from "../brain/indexer.mjs";
import { ask, entityView } from "../../../brain/retrieve.mjs";
import { FILES } from "../../../brain/test/fixture.mjs";

const ADMIN = "Administrator";
const STAMP = "2026-11-11 14:30:00.000000";
const doc = (doctype, name, extra) => ({ doctype, name, owner: ADMIN, modified_by: ADMIN, docstatus: 0, creation: STAMP, modified: STAMP, ...extra });
const RAVI = doc("Contact", "Ravi Menon-Acme Interiors", { first_name: "Ravi", last_name: "Menon", company_name: "Acme Interiors" });
const FORBIDDEN = ["Asha Rao", "Rao Interiors", "Singh Homes", "Delivery is late", "buyer@example.com", "DRAFT REPLY"];

function configIn(root) {
  const state = join(root, "state");
  return {
    engineDir: join(root, "engine"),
    minFreeDiskGb: 0,
    paths: {
      state, knowledgeDocs: join(state, "knowledge", "docs"), homeData: join(state, "home"),
      brainDir: join(state, "brain"), brainIndex: join(state, "brain", "index.sqlite"),
    },
  };
}

function writeDoc(config, rel, text) {
  const file = join(config.paths.knowledgeDocs, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}

// A temp state with the fixture's files, a stub bench with the seed plus Ravi Menon, and a ctx that logs.
async function withHome(fn, { change = () => {}, files = FILES } = {}) {
  const root = mkdtempSync(join(tmpdir(), "brain-indexer-"));
  const bench = await startStubBench({ seed: benchSeed() });
  try {
    bench.state.docs.Contact = [structuredClone(RAVI)];
    change(bench.state);
    const config = configIn(root);
    mkdirSync(config.paths.knowledgeDocs, { recursive: true });
    mkdirSync(config.paths.homeData, { recursive: true });
    for (const [rel, text] of Object.entries(files)) writeDoc(config, rel, text);
    mkdirSync(join(root, "books", "bench"), { recursive: true });
    const keyFile = join(root, "owner-key.txt");
    writeFileSync(keyFile, "owner\nowner\n", { mode: 0o600 });
    const lines = [];
    const ctx = { bench: createBench({ baseUrl: bench.url, site: "test.localhost", keyFile, booksDir: join(root, "books") }), log: (l) => lines.push(l) };
    return await fn({ root, config, bench, ctx, lines });
  } finally {
    await bench.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function withIndex(indexer, fn) {
  const ix = indexer.open();
  assert.ok(ix, "the index opens");
  try { return fn(ix.db, ix); } finally { ix.db.close(); }
}

const sources = (r) => r.results.map((x) => x.source);
const allText = (r) => JSON.stringify(r);
const temps = (config) => readdirSync(config.paths.brainDir).filter((n) => n.endsWith(".tmp") || n.endsWith("-journal"));

// A clock the test moves by hand.
const clock = (start = Date.parse("2026-11-18T06:00:00.000Z")) => {
  let t = start;
  const now = () => t;
  now.add = (ms) => { t += ms; };
  return now;
};

test("indexFor gives one indexer per config", () => {
  const a = configIn("/nowhere-a");
  const b = configIn("/nowhere-b");
  assert.equal(indexFor(a), indexFor(a));
  assert.notEqual(indexFor(a), indexFor(b));
  for (const k of ["ensureFresh", "rebuild", "status", "open"]) assert.equal(typeof indexFor(a)[k], "function", k);
});

test("before the first build the status is all null and not building", async () => {
  await withHome(async ({ config }) => {
    const s = indexFor(config).status();
    assert.deepEqual(s, { builtAt: null, files: null, records: null, passages: null, books: null, booksAt: null, leftOut: null, truncated: null, building: false });
    assert.equal(indexFor(config).open(), null);
  });
});

test("the fixture's files and the seed give an index on which every Expected line of B7 holds", async () => {
  await withHome(async ({ config, ctx, lines }) => {
    const ix = indexFor(config);
    const s = await ix.rebuild(ctx);
    assert.equal(s.building, false);
    assert.equal(s.books, "ok");
    assert.equal(s.files, 5);
    assert.equal(s.records, 14);
    assert.equal(s.leftOut, 0);
    assert.deepEqual(s.truncated, []);
    assert.match(s.builtAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(s.booksAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(lines, []);
    withIndex(ix, (db, opened) => {
      assert.equal(opened.builtAt, s.builtAt);
      const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
      assert.deepEqual(JSON.parse(meta.basics), BASICS.map((b) => b.file));
      assert.match(meta.fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(Number(meta.passages), s.passages);

      const promise = ask(db, "what did we promise Acme");
      assert.equal(promise.results[0].source, "calls/acme-call.md");
      assert.ok(sources(promise).includes("books:Customer:Acme Interiors"));
      assert.ok(promise.links.some((l) => l.from.type === "invoice" && l.from.name === "ACC-SINV-2026-00003"
        && l.type === "invoice_of" && l.to.type === "customer" && l.to.name === "Acme Interiors"), JSON.stringify(promise.links));
      assert.deepEqual(promise.notFound, []);

      const warranty = ask(db, "warranty for Acme");
      assert.deepEqual(warranty.notFound, ["warranty"]);
      assert.ok(warranty.results.length > 0);

      assert.deepEqual(ask(db, "zebra quantum"), { results: [], links: [], notFound: ["zebra", "quantum"] });

      const refunds = ask(db, "refunds");
      assert.ok(sources(refunds).includes("policies/refunds.md"));
      assert.ok(sources(refunds).includes("policies/terms.md"));
      const count = {};
      for (const src of sources(refunds)) count[src] = (count[src] || 0) + 1;
      assert.ok(Object.values(count).every((c) => c <= 2));

      assert.ok(sources(ask(db, "Ravi")).includes("calls/acme-call.md"));
      const view = entityView(db, "customer:Acme Interiors");
      assert.ok(view.linked.some((l) => l.entity.name === "Ravi Menon" && l.type === "contact_of" && l.direction === "from"));
      assert.ok(view.linked.length >= 3);
      assert.equal(view.passages[0].source, "books:Customer:Acme Interiors");

      for (const q of ["what did we promise Acme", "warranty for Acme", "refunds", "Ravi", "Acme Interiors", "Asha Rao",
        "Singh Homes", "Delivery is late", "buyer@example.com", "draft reply", "support request", "deal"]) {
        const text = allText(ask(db, q));
        for (const bad of FORBIDDEN) assert.ok(!text.includes(bad), `${q}: ${bad}`);
      }
      // Nothing the books hold outside the trust rule is in the index at all.
      const everything = JSON.stringify(db.prepare("SELECT title, text FROM passages").all()) + JSON.stringify(db.prepare("SELECT name FROM entities").all());
      for (const bad of FORBIDDEN) assert.ok(!everything.includes(bad), bad);
    });
  });
});

test("the index file is 0600 and its folder 0700; no temp file is left", async () => {
  await withHome(async ({ config, ctx }) => {
    await indexFor(config).rebuild(ctx);
    const st = lstatSync(config.paths.brainIndex);
    assert.ok(st.isFile());
    assert.equal(st.mode & 0o777, 0o600);
    assert.equal(statSync(config.paths.brainDir).mode & 0o777, 0o700);
    assert.deepEqual(temps(config), []);
  });
});

test("a second build leaves no .tmp, and stale temp files of its own naming are removed", async () => {
  await withHome(async ({ config, ctx }) => {
    const ix = indexFor(config);
    const first = await ix.rebuild(ctx);
    writeFileSync(join(config.paths.brainDir, "index.0123456789abcdef.tmp"), "stale");
    writeFileSync(join(config.paths.brainDir, "index.0123456789abcdef.tmp-journal"), "stale");
    writeFileSync(join(config.paths.brainDir, "keep.tmp"), "not ours");
    await new Promise((r) => setTimeout(r, 5));
    const second = await ix.rebuild(ctx, { books: false });
    assert.notEqual(second.builtAt, first.builtAt);
    assert.deepEqual(temps(config), ["keep.tmp"]);
    assert.equal(second.records, first.records, "the last good pull's records are kept");
  });
});

test("a second call while a build runs gets the same promise, and the status says building", async () => {
  await withHome(async ({ config, ctx }) => {
    const ix = indexFor(config);
    const a = ix.rebuild(ctx);
    const b = ix.rebuild(ctx, { books: false });
    assert.equal(a, b);
    assert.equal(ix.status().building, true);
    const s = await a;
    assert.equal(s.building, false);
    assert.equal(ix.status().building, false);
  });
});

test("ensureFresh builds when there is no index, returns at once, and rebuilds after a file is added", async () => {
  await withHome(async ({ config, ctx }) => {
    const now = clock();
    const ix = createIndexer(config, { now });
    const first = ix.ensureFresh(ctx);
    assert.equal(first.building, true);
    assert.equal(first.builtAt, null);
    await ix.rebuild(ctx); // the build ensureFresh started
    const built = ix.status().builtAt;
    assert.ok(built);

    // Nothing changed: no build.
    now.add(6000);
    assert.equal(ix.ensureFresh(ctx).building, false);

    const added = writeDoc(config, "company/about.md", "# About\nWe make zebra-striped cabinets in Pune.\n");
    utimesSync(added, new Date(), new Date());
    // Within 5 seconds of the last check the listing is not looked at.
    now.add(1000);
    assert.equal(ix.ensureFresh(ctx).building, false);
    now.add(5000);
    assert.equal(ix.ensureFresh(ctx).building, true);
    const after = await ix.rebuild(ctx);
    assert.notEqual(after.builtAt, built);
    assert.equal(after.files, 6);
    withIndex(ix, (db) => assert.ok(sources(ask(db, "zebra cabinets")).includes("company/about.md")));
  });
});

test("ensureFresh pulls the books at most once in 15 minutes", async () => {
  await withHome(async ({ config, ctx, bench }) => {
    const now = clock();
    const ix = createIndexer(config, { now });
    ix.ensureFresh(ctx);
    await ix.rebuild(ctx);
    const pulls = () => bench.requests.filter((r) => r.path === "/api/resource/Customer").length;
    assert.equal(pulls(), 1);
    writeDoc(config, "company/about.md", "# About\nA new file.\n");
    now.add(6000);
    ix.ensureFresh(ctx);
    await ix.rebuild(ctx);
    assert.equal(pulls(), 1, "a file change rebuilds without asking the books");
    assert.equal(ix.status().records, 14);
    now.add(15 * 60 * 1000);
    assert.equal(ix.ensureFresh(ctx).building, true);
    await ix.rebuild(ctx);
    assert.equal(pulls(), 2);
  });
});

test("the books switched off: books is off, the files still answer, and the last good pull is kept", async () => {
  await withHome(async ({ config, ctx, bench }) => {
    const ix = indexFor(config);
    const good = await ix.rebuild(ctx);
    await bench.close();
    const off = await ix.rebuild(ctx);
    assert.equal(off.books, "off");
    assert.equal(off.records, good.records);
    assert.equal(off.booksAt, good.booksAt);
    withIndex(ix, (db) => {
      assert.equal(ask(db, "refunds").results[0].source.startsWith("policies/"), true);
      assert.ok(sources(ask(db, "Acme Interiors")).includes("books:Customer:Acme Interiors"));
    });
  });
});

test("the books off from the start: books is off, no records, the files answer", async () => {
  await withHome(async ({ config, ctx, bench }) => {
    await bench.close();
    const s = await indexFor(config).rebuild(ctx);
    assert.equal(s.books, "off");
    assert.equal(s.records, 0);
    assert.equal(s.booksAt, "");
    assert.equal(s.files, 5);
    withIndex(indexFor(config), (db) => assert.equal(ask(db, "what did we promise Acme").results[0].source, "calls/acme-call.md"));
  });
});

test("an agent-made customer never appears and is counted in leftOut", async () => {
  const change = (state) => {
    state.docs.Customer.push(doc("Customer", "Zed Fabrications", { customer_name: "Zed Fabrications", owner: "sales@example.com", modified_by: "sales@example.com" }));
  };
  await withHome(async ({ config, ctx }) => {
    const s = await indexFor(config).rebuild(ctx);
    assert.equal(s.leftOut, 1);
    withIndex(indexFor(config), (db) => {
      assert.equal(ask(db, "Zed Fabrications").results.length, 0);
      const all = JSON.stringify(db.prepare("SELECT source, title, text FROM passages").all()) + JSON.stringify(db.prepare("SELECT key, name FROM entities").all());
      assert.ok(!all.includes("Zed"));
    });
  }, { change });
});

test("<state>/brain planted as a link: no index and one log line", async () => {
  await withHome(async ({ root, config, ctx, lines }) => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, config.paths.brainDir);
    const s = await indexFor(config).rebuild(ctx);
    assert.equal(s.builtAt, null);
    assert.equal(indexFor(config).open(), null);
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.match(lines[0], /^brain index:/);
  });
});

test("a brain folder that is a plain file is refused the same way", async () => {
  await withHome(async ({ config, ctx, lines }) => {
    writeFileSync(config.paths.brainDir, "not a folder");
    const s = await indexFor(config).rebuild(ctx);
    assert.equal(s.builtAt, null);
    assert.equal(lines.length, 1);
  });
});

test("a file the store cut short is named in truncated", async () => {
  const big = `# Big\n${"word ".repeat(70000)}\n`; // over the store's 262,144 bytes
  await withHome(async ({ config, ctx }) => {
    const s = await indexFor(config).rebuild(ctx);
    assert.deepEqual(s.truncated, ["references/big.txt"]);
    withIndex(indexFor(config), (db) => {
      assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'truncated'").get().value), ["references/big.txt"]);
    });
  }, { files: { ...FILES, "references/big.txt": big } });
});

test("a picture is found by its name; a link in the knowledge folder is never read", async () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  await withHome(async ({ root, config, ctx }) => {
    writeFileSync(join(config.paths.knowledgeDocs, "brand", "logo-mark.png"), PNG);
    const secret = join(root, "outside.md");
    writeFileSync(secret, "# Outside\nThe secret word is pomegranate.\n");
    symlinkSync(secret, join(config.paths.knowledgeDocs, "brand", "linked.md"));
    const s = await indexFor(config).rebuild(ctx);
    assert.equal(s.files, 7, "the five, brand.md and the picture; not the link");
    withIndex(indexFor(config), (db) => {
      assert.ok(sources(ask(db, "logo mark")).includes("brand/logo-mark.png"));
      assert.deepEqual(ask(db, "pomegranate").results, []);
    });
  }, { files: { ...FILES, "brand/brand.md": "# Brand\nPlain words.\n" } });
});

test("ensureFresh never throws, even with no books and a broken ctx", async () => {
  await withHome(async ({ config }) => {
    const lines = [];
    const ix = createIndexer(config, { now: clock() });
    const s = ix.ensureFresh({ log: (l) => lines.push(l) }); // no bench at all
    assert.equal(typeof s, "object");
    const done = await ix.rebuild({});
    assert.equal(done.books, "off");
    assert.equal(done.files, 5);
    assert.ok(lines.some((l) => l.startsWith("brain index:")));
    assert.doesNotThrow(() => ix.ensureFresh(null));
  });
});

test("a status read after a restart comes from the index on disk", async () => {
  await withHome(async ({ config, ctx }) => {
    const s = await createIndexer(config).rebuild(ctx);
    const fresh = createIndexer(config).status();
    assert.equal(fresh.builtAt, s.builtAt);
    assert.equal(fresh.passages, s.passages);
    assert.equal(fresh.building, false);
    assert.ok(existsSync(config.paths.brainIndex));
  });
});
