// The Brain view of Files (PLAN-BRAIN T13): the status sentences, a search's cards, the not-found and empty lines,
// a chip that opens the link view, the grouped links, a restart for a route that is not there yet, and text from
// the server shown as text, never as markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as DOM from "../kit/_dom.mjs";
import {
  BRAIN_WORDS, BrainView, KIND_WORDS, brainHref, cleanAsk, cleanKey, notFoundLine, sourceLine, statusLines, updatedAgo,
} from "../../brain/find.js";
import { LINK_GROUPS, LINKS_WORDS, groupLinked, keyPart } from "../../brain/links-view.js";
import * as files from "../../pages/files.js";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const FIND_SRC = readFileSync(new URL("../../brain/find.js", import.meta.url), "utf8");
const LINKS_SRC = readFileSync(new URL("../../brain/links-view.js", import.meta.url), "utf8");
const FILES_SRC = readFileSync(new URL("../../pages/files.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/pages/brain-find.css", import.meta.url), "utf8");

const INDEX = {
  builtAt: "2026-11-18T09:55:00.000Z", files: 14, records: 23, passages: 60, books: "ok",
  booksAt: "2026-11-18T09:55:00.000Z", leftOut: 1, truncated: [], building: false,
};
const ACME = "customer:Acme Interiors";
const FOUND = {
  results: [
    { n: 1, kind: "file", source: "calls/acme-call.md", title: "Call with Ravi Menon, Acme Interiors", locator: "Call with Ravi Menon, Acme Interiors",
      text: "We promised Acme Interiors the drawings by Friday and a 10 percent discount on renewals.", link: { page: "files", id: "Y2FsbHMvYWNtZS1jYWxsLm1k" } },
    { n: 2, kind: "record", source: "books:Sales Invoice:ACC-SINV-2026-00003", title: "Invoice ACC-SINV-2026-00003", locator: "",
      text: "Invoice ACC-SINV-2026-00003 for Acme Interiors. Total: ₹50,000. Unpaid: ₹0. Status: Paid.", link: { page: "books", id: "ACC-SINV-2026-00003" } },
    { n: 3, kind: "file", source: "policies/old.md", title: "Old", locator: "", text: "No link for this one.", link: null },
  ],
  links: [], notFound: ["warranty"], entities: [{ key: ACME, type: "customer", name: "Acme Interiors" }], builtAt: INDEX.builtAt,
};
const VIEW = {
  entity: { type: "customer", key: ACME, name: "Acme Interiors" },
  linked: [
    { type: "invoice_of", direction: "from", entity: { type: "invoice", key: "invoice:ACC-SINV-2026-00003", name: "ACC-SINV-2026-00003" } },
    { type: "invoice_of", direction: "from", entity: { type: "invoice", key: "invoice:ACC-SINV-2026-00004", name: "ACC-SINV-2026-00004" } },
    { type: "deal_of", direction: "from", entity: { type: "deal", key: "deal:CRM-DEAL-2026-00002", name: "CRM-DEAL-2026-00002" } },
    { type: "contact_of", direction: "from", entity: { type: "person", key: "person:Ravi Menon", name: "Ravi Menon" } },
  ],
  passages: [
    { n: 1, kind: "record", source: "books:Customer:Acme Interiors", title: "Acme Interiors", locator: "",
      text: "Customer: Acme Interiors. Invoices: 2. Billed: ₹75,000. Unpaid: ₹0. Deals: 1.", link: { page: "books", id: "Acme Interiors" } },
  ],
};

const texts = (root) => [...DOM.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const byLabel = (root, label) => DOM.elements(root).find((e) => e.getAttribute("aria-label") === label);

// Draws the view with the routes answered by `answer(path)`; returns the root, the calls, where it navigated, and done().
async function draw(props, answer) {
  DOM.installDom();
  const stub = DOM.stubFetch((path, method) => answer(path, method));
  const went = [];
  const root = await DOM.mount(BrainView, { navigate: (h) => went.push(h), ...props });
  for (let i = 0; i < 10; i += 1) await DOM.settle(30);
  return { root, calls: stub.calls, went, done: () => { DOM.unmount(root); stub.restore(); } };
}
const routes = (over = {}) => (path) => {
  if (path === "/api/brain/index") return over.index || { status: 200, body: INDEX };
  if (path.startsWith("/api/brain/find?")) return over.find || { status: 200, body: FOUND };
  if (path.startsWith("/api/brain/links/")) return over.links ? over.links(path) : { status: 200, body: VIEW };
  if (path === "/api/brain/index/refresh") return over.refresh || { status: 200, body: INDEX };
  return { status: 404, body: { error: { message: "No such address.", code: "not_found" } } };
};
const waitFor = async (root, words) => {
  for (let i = 0; i < 20 && !DOM.textOf(root).includes(words); i += 1) await DOM.settle(30);
};

// ---- pure helpers

test("brain-find: the status sentences", () => {
  assert.deepEqual(statusLines(INDEX, NOW), ["Searchable: 14 files and 23 records from the books. Updated 5 minutes ago."]);
  assert.deepEqual(statusLines({ ...INDEX, books: "off" }, NOW),
    ["Searchable: 14 files. Updated 5 minutes ago.", "The books were not answering, so only your files are searchable."]);
  assert.deepEqual(statusLines({ ...INDEX, books: "not_installed", files: 1 }, NOW), ["Searchable: 1 file. Updated 5 minutes ago."]);
  assert.deepEqual(statusLines({ ...INDEX, truncated: ["pricing/big.md", "calls/long.txt"] }, NOW)[1],
    "Some files are long; only their first part is searchable: pricing/big.md, calls/long.txt.");
  const many = statusLines({ ...INDEX, truncated: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"] }, NOW)[1];
  assert.equal(many, "Some files are long; only their first part is searchable: a.md, b.md, c.md, d.md, e.md, and 2 more.");
  const before = { builtAt: null, files: null, records: null, passages: null, books: null, booksAt: null, leftOut: null, truncated: null, building: true };
  assert.deepEqual(statusLines(before, NOW), ["The brain is being read for the first time."]);
  assert.deepEqual(statusLines(null, NOW), [BRAIN_WORDS.first]);
});

test("brain-find: how long ago, in words", () => {
  assert.equal(updatedAgo("2026-11-18T09:59:40.000Z", NOW), "just now");
  assert.equal(updatedAgo("2026-11-18T09:59:00.000Z", NOW), "1 minute ago");
  assert.equal(updatedAgo("2026-11-18T08:00:00.000Z", NOW), "2 hours ago");
  assert.equal(updatedAgo("2026-11-17T09:00:00.000Z", NOW), "yesterday");
  assert.equal(updatedAgo("2026-11-14T09:00:00.000Z", NOW), "4 days ago");
  assert.equal(updatedAgo("not a time", NOW), "");
});

test("brain-find: source lines, the not-found line and the address", () => {
  assert.equal(sourceLine({ kind: "file", source: "pricing/services.md" }), "From your files: pricing/services.md");
  assert.equal(sourceLine({ kind: "record", source: "books:Sales Invoice:ACC-SINV-2026-00003" }), "From the books: Invoice ACC-SINV-2026-00003");
  assert.equal(sourceLine({ kind: "record", source: "books:HD Ticket:4" }), "From the books: Support request 4");
  assert.equal(sourceLine({ kind: "record", source: "books:Customer:Acme Interiors" }), "From the books: Customer Acme Interiors");
  assert.equal(notFoundLine(["warranty"]), "Not found in the brain: warranty.");
  assert.equal(notFoundLine(["zebra", "quantum"]), "Not found in the brain: zebra, quantum.");
  assert.equal(notFoundLine([]), "");
  assert.equal(brainHref({}), "#/files?tab=brain");
  assert.equal(brainHref({ ask: " what did we promise " }), "#/files?tab=brain&ask=what+did+we+promise");
  assert.equal(brainHref({ ask: "acme", entity: ACME }), "#/files?tab=brain&ask=acme&entity=customer%3AAcme+Interiors");
  assert.equal(cleanAsk("x".repeat(500)).length, 200);
  assert.equal(cleanKey("a\nb"), "");
  assert.equal(cleanKey("k".repeat(201)), "");
  assert.equal(files.filesHref({ tab: "brain" }), "#/files?tab=brain");
});

test("brain-find: linked entities are grouped in a fixed order, each once", () => {
  const groups = groupLinked([...VIEW.linked, VIEW.linked[0], { entity: { type: "planet", key: "planet:x", name: "x" } }, null]);
  assert.deepEqual(groups.map((g) => g.title), ["Invoices", "Deals", "People"]);
  assert.deepEqual(groups[0].items.map((i) => i.key), ["invoice:ACC-SINV-2026-00003", "invoice:ACC-SINV-2026-00004"]);
  assert.deepEqual(LINK_GROUPS.map((g) => g.title), ["Customers", "Invoices", "Deals", "Projects", "Support requests", "People"]);
  assert.equal(keyPart(ACME), Buffer.from(ACME, "utf8").toString("base64url"));
  assert.equal(KIND_WORDS.ticket, "Support request");
});

// ---- drawn

test("brain-find drawn: the status line, then a result card with its title, place, text and a source line that opens its link", async () => {
  const { root, calls, done } = await draw({ ask: "what did we promise Acme" }, routes());
  try {
    await waitFor(root, "We promised");
    const t = texts(root);
    assert.ok(t.includes("Searchable: 14 files and 23 records from the books. Updated 5 minutes ago.") || t.some((x) => /^Searchable: 14 files and 23 records from the books\. Updated /.test(x)));
    assert.ok(calls.some((c) => c.path === "/api/brain/find?q=what%20did%20we%20promise%20Acme"));
    const cards = DOM.byClass(root, "p-brain-find__card");
    assert.equal(cards.length, 3);
    assert.equal(DOM.textOf(DOM.byClass(cards[0], "p-brain-find__card-title")[0]), "Call with Ravi Menon, Acme Interiors");
    assert.equal(DOM.textOf(DOM.byClass(cards[0], "p-brain-find__place")[0]), "Call with Ravi Menon, Acme Interiors");
    assert.equal(DOM.textOf(DOM.byClass(cards[0], "p-brain-find__text")[0]), FOUND.results[0].text);
    const links = DOM.elements(root).filter((e) => e.localName === "a" && DOM.classesOf(e).includes("p-brain-find__source-link"));
    assert.deepEqual(links.map((a) => [DOM.textOf(a), a.getAttribute("href")]), [
      ["From your files: calls/acme-call.md", "#/files?file=Y2FsbHMvYWNtZS1jYWxsLm1k"],
      ["From the books: Invoice ACC-SINV-2026-00003", "#/dashboards/books"],
    ]);
    assert.ok(DOM.textOf(cards[2]).includes("From your files: policies/old.md"), "a source with no link is plain words");
    assert.equal(DOM.elements(cards[2]).filter((e) => e.localName === "a").length, 0);
    assert.ok(byLabel(root, "Refresh") || DOM.buttonNamed(root, "Refresh"), "a Refresh button");
  } finally { done(); }
});

test("brain-find drawn: words not found are said under the results", async () => {
  const { root, done } = await draw({ ask: "warranty for Acme" }, routes());
  try {
    await waitFor(root, "Not found");
    assert.ok(texts(root).includes("Not found in the brain: warranty."));
    assert.ok(!texts(root).includes(BRAIN_WORDS.nothing), "there are results, so no empty line");
  } finally { done(); }
});

test("brain-find drawn: nothing found says so, with the words not found", async () => {
  const empty = { status: 200, body: { results: [], links: [], notFound: ["zebra", "quantum"], entities: [], builtAt: INDEX.builtAt } };
  const { root, done } = await draw({ ask: "zebra quantum" }, routes({ find: empty }));
  try {
    await waitFor(root, BRAIN_WORDS.nothing);
    const t = texts(root);
    assert.ok(t.includes("Nothing in the brain matches this."));
    assert.ok(t.includes("Not found in the brain: zebra, quantum."));
    assert.equal(DOM.byClass(root, "p-brain-find__card").length, 0);
  } finally { done(); }
});

test("brain-find drawn: before the first build the status says so", async () => {
  const before = { status: 200, body: { builtAt: null, files: null, records: null, passages: null, books: null, booksAt: null, leftOut: null, truncated: null, building: true } };
  const { root, done } = await draw({}, routes({ index: before }));
  try {
    await waitFor(root, "first time");
    assert.ok(texts(root).includes("The brain is being read for the first time."));
  } finally { done(); }
});

test("brain-find drawn: a chip opens the link view, grouped, with its mentions; a linked row opens its own view", async () => {
  const asked = [];
  const { root, went, done } = await draw({ ask: "what did we promise Acme" }, routes({
    links: (path) => { asked.push(path); return { status: 200, body: VIEW }; },
  }));
  try {
    await waitFor(root, "We promised");
    const chip = byLabel(root, "Acme Interiors, Customer: see what is linked");
    assert.ok(chip, "a chip for the name in the question");
    assert.equal(chip.localName, "button");
    DOM.fire(chip, "click");
    await waitFor(root, LINKS_WORDS.mentioned);
    assert.deepEqual(asked, [`/api/brain/links/${Buffer.from(ACME, "utf8").toString("base64url")}`]);
    assert.equal(went.at(-1), "#/files?tab=brain&ask=what+did+we+promise+Acme&entity=customer%3AAcme+Interiors", "the address keeps the view");
    const name = DOM.elements(root).find((e) => e.localName === "h2" && DOM.classesOf(e).includes("p-brain-find__entity-name"));
    assert.equal(DOM.textOf(name), "Acme Interiors");
    assert.ok(texts(root).includes("Customer"));
    const groupTitles = DOM.byClass(root, "p-brain-find__group-title").map((e) => DOM.textOf(e));
    assert.deepEqual(groupTitles, ["Invoices", "Deals", "People"]);
    assert.equal(DOM.byClass(root, "p-brain-find__card").length, 1, "where it is mentioned, as cards");
    assert.ok(texts(root).includes("From the books: Customer Acme Interiors"));
    assert.ok(!DOM.elements(root).some((e) => e.localName === "canvas"), "no graph is drawn");
    assert.ok(DOM.elements(root).filter((e) => e.localName === "svg").every((e) => DOM.classesOf(e).includes("k-icon")), "the only drawings are the kit's icons");
    const ravi = DOM.byClass(root, "p-brain-find__linked-item").find((b) => DOM.textOf(b) === "Ravi Menon");
    assert.equal(ravi.localName, "button");
    DOM.fire(ravi, "click");
    for (let i = 0; i < 20 && asked.length < 2; i += 1) await DOM.settle(30);
    assert.equal(asked.at(-1), `/api/brain/links/${Buffer.from("person:Ravi Menon", "utf8").toString("base64url")}`);
    const back = DOM.buttonNamed(root, "Back to the search");
    assert.ok(back, "a way back to the search");
  } finally { done(); }
});

test("brain-find drawn: text from the server with <script> is shown as text", async () => {
  const evil = "<script>alert(1)</script><img src=x onerror=alert(2)>";
  const found = { status: 200, body: { ...FOUND, results: [{ ...FOUND.results[0], title: evil, locator: evil, text: `**bold** ${evil}` }],
    entities: [{ key: "customer:<b>x</b>", type: "customer", name: evil }], notFound: [evil] } };
  const { root, done } = await draw({ ask: "evil" }, routes({ find: found }));
  try {
    await waitFor(root, "alert(1)");
    const t = texts(root);
    assert.ok(t.includes(evil), "the title is one text node, as sent");
    assert.ok(t.includes(`**bold** ${evil}`), "Markdown is not read");
    assert.ok(t.includes(`Not found in the brain: ${evil.slice(0, 60)}.`));
    assert.ok(!DOM.elements(root).some((e) => ["script", "img", "b", "strong"].includes(e.localName)), "no markup from the server");
  } finally { done(); }
});

test("brain-find drawn: a route that is not there yet says the home screen must be restarted", async () => {
  const gone = { status: 404, body: { error: { message: "There is no such address.", code: "not_found" } } };
  const { root, done } = await draw({ ask: "acme" }, routes({ index: gone, find: gone }));
  try {
    await waitFor(root, "restarted");
    assert.ok(texts(root).includes("This page appears after the home screen is restarted."));
  } finally { done(); }
  const { root: r2, done: d2 } = await draw({ ask: "acme" }, routes({ find: gone }));
  try {
    await waitFor(r2, "restarted");
    assert.ok(texts(r2).includes(BRAIN_WORDS.restart), "a 404 from find says the same");
  } finally { d2(); }
});

test("brain-find drawn: an entity not in the index says so in the server's words", async () => {
  const missing = { status: 404, body: { error: { message: "That is not in the brain's index.", code: "entity_not_found" } } };
  const { root, done } = await draw({ entity: "customer:Nobody" }, routes({ links: () => missing }));
  try {
    await waitFor(root, "not in the brain");
    assert.ok(texts(root).includes("That is not in the brain's index."));
    assert.ok(!texts(root).includes(BRAIN_WORDS.restart));
  } finally { done(); }
});

test("brain-find drawn: a search of one letter is not sent; Enter sends a longer one", async () => {
  const { root, calls, went, done } = await draw({}, routes());
  try {
    const input = DOM.elements(root).find((e) => e.localName === "input" && e.getAttribute("aria-label") === BRAIN_WORDS.ask);
    assert.ok(input, "the search box is labelled");
    assert.equal(String(input.maxLength ?? input.getAttribute("maxlength") ?? input.getAttribute("maxLength")), "200");
    const form = DOM.elements(root).find((e) => e.localName === "form");
    DOM.fire(input, "input", { currentTarget: { value: "a" } });
    await DOM.settle(30);
    DOM.fire(form, "submit");
    await DOM.settle(30);
    assert.ok(texts(root).includes("Type at least two letters."));
    assert.ok(!calls.some((c) => c.path.startsWith("/api/brain/find")));
    DOM.fire(input, "input", { currentTarget: { value: "refunds" } });
    await DOM.settle(30);
    DOM.fire(form, "submit");
    await waitFor(root, "We promised");
    assert.ok(calls.some((c) => c.path === "/api/brain/find?q=refunds"));
    assert.equal(went.at(-1), "#/files?tab=brain&ask=refunds");
  } finally { done(); }
});

test("brain-find drawn: Refresh asks for a rebuild and says the server's refusal", async () => {
  const busy = { status: 429, body: { error: { message: "The brain was refreshed a moment ago.", code: "brain_busy" } } };
  const { root, calls, done } = await draw({}, routes({ refresh: busy }));
  try {
    const button = DOM.buttonNamed(root, "Refresh");
    assert.ok(button);
    DOM.fire(button, "click");
    await waitFor(root, "a moment ago");
    assert.ok(calls.some((c) => c.path === "/api/brain/index/refresh" && c.method === "POST"));
    assert.ok(texts(root).includes("The brain was refreshed a moment ago."));
  } finally { done(); }
});

// ---- the source

test("brain-find: no innerHTML; Files mounts the view behind a segmented Files or Brain", () => {
  assert.equal((FIND_SRC.match(/innerHTML/g) || []).length, 0);
  assert.equal((LINKS_SRC.match(/innerHTML/g) || []).length, 0);
  assert.doesNotMatch(FIND_SRC + LINKS_SRC, /dangerouslySetInnerHTML|DocView|docOf\(/);
  assert.match(FILES_SRC, /import \{ BRAIN_WORDS, BrainView \} from "\.\.\/brain\/find\.js";/);
  assert.match(FILES_SRC, /<\$\{Segmented\} size="sm" label="Files or the brain"/);
  assert.match(FILES_SRC, /else if \(brainMode\) body = html`<\$\{BrainView\} ask=/);
  assert.match(FIND_SRC, /class="p-brain-find"/, "the view's root carries its stylesheet's class");
});

test("brain-find: its stylesheet keeps to the page rules (one root class, tokens, no hex or rgb)", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      assert.match(sel, /^\.p-brain-find(?![\w-])/, `"${sel}" starts with .p-brain-find`);
    }
  }
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(|\bhsla?\(|font-size\s*:\s*[\d.]+px|@media|@import/);
});
