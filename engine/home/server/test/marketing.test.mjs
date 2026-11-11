// Marketing drafts (CONTRACTS 9.8, 9.6): found in goal folders, kept as records, approved in the inbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call, writes } from "../lib/testing.mjs";

async function withHome(fn) {
  const h = await startStubsHome({ port: 0 });
  try { return await fn(h); } finally { await h.close(); }
}
const contentDir = (h) => join(h.state, "tasks", "company-work", "STH-2", "content");
const draftsDir = (h) => join(h.state, "content", "drafts");
const page = async (h) => (await call(h.url, "GET", "/api/departments/marketing")).json;
const rows = (p) => p.sections.find((s) => s.id === "calendar").rows;
const inboxContent = async (h) => (await call(h.url, "GET", "/api/inbox")).json.items.filter((i) => i.source === "marketing");
const post = (title, body = "Some words.", planned = "2026-12-01", channel = "post") =>
  `---\ntitle: ${title}\nchannel: ${channel}\nplanned: ${planned}\n---\n${body}\n`;

test("two drafts appear, the bad file is under problems", async () => {
  await withHome(async (h) => {
    const p = await page(h);
    assert.deepEqual(rows(p).map((r) => r.title), ["Our kitchen range is here", "November news from the workshop"]);
    assert.deepEqual(rows(p).map((r) => r.kind), ["Post", "Newsletter"]);
    const prob = p.sections.find((s) => s.id === "problems");
    assert.deepEqual(prob.rows.map((r) => r.file), ["bad-header.md"]);
    assert.equal(readdirSync(draftsDir(h)).length, 2);
    assert.equal(p.figures.find((f) => f.id === "drafts").value, "2");
    assert.equal((await inboxContent(h)).length, 2);
  });
});

test("ids are stable across scans and the draft can be read", async () => {
  await withHome(async (h) => {
    const a = (await inboxContent(h)).map((i) => i.id).sort();
    const b = (await inboxContent(h)).map((i) => i.id).sort();
    assert.deepEqual(a, b);
    assert.match(a[0], /^content:[0-9a-f]{12}$/);
    const r = await call(h.url, "GET", `/api/content/${a[0].slice(8)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.draft.status, "draft");
    assert.equal(r.json.draft.raisedBy, "Marketer");
    assert.equal((await call(h.url, "GET", "/api/content/zzzz")).status, 404);
    assert.equal((await call(h.url, "GET", "/api/content/000000000000")).status, 404);
  });
});

test("editing a draft file updates the body; a new file is a new draft", async () => {
  await withHome(async (h) => {
    const id = (await inboxContent(h)).find((i) => i.title.includes("kitchen")).id.slice(8);
    writeFileSync(join(contentDir(h), "launch-post.md"), post("Our kitchen range is here", "New words."));
    assert.equal((await call(h.url, "GET", `/api/content/${id}`)).json.draft.body, "New words.");
    writeFileSync(join(contentDir(h), "third.md"), post("Third one"));
    assert.equal(rows(await page(h)).length, 3);
  });
});

test("approve changes only the status; later edits change nothing; nothing goes to the board", async () => {
  await withHome(async (h) => {
    const item = (await inboxContent(h)).find((i) => i.title.includes("kitchen"));
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: item.id, action: "approve" } });
    assert.equal(r.status, 200);
    assert.match(r.json.message, /Nothing is published/);
    assert.equal(writes(h.board).length, 0);
    assert.equal((await inboxContent(h)).length, 1);
    writeFileSync(join(contentDir(h), "launch-post.md"), post("Changed after approval", "Different."));
    const d = (await call(h.url, "GET", `/api/content/${item.id.slice(8)}`)).json.draft;
    assert.equal(d.status, "approved");
    assert.equal(d.title, "Our kitchen range is here");
    assert.equal((await inboxContent(h)).length, 1);
    const again = await call(h.url, "POST", "/api/inbox/act", { body: { id: item.id, action: "approve" } });
    assert.ok([404, 409].includes(again.status));
    assert.equal(rows(await page(h)).find((x) => x.title === "Our kitchen range is here").status, "Approved");
  });
});

test("send back: note stored, one board task for the Marketer, item leaves; an edit brings it back", async () => {
  await withHome(async (h) => {
    const item = (await inboxContent(h)).find((i) => i.title.includes("kitchen"));
    const noNote = await call(h.url, "POST", "/api/inbox/act", { body: { id: item.id, action: "send_back" } });
    assert.equal(noNote.status, 400);
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: item.id, action: "send_back", note: "Shorter, please." } });
    assert.equal(r.status, 200);
    const w = h.board.requests.filter((x) => x.method === "POST");
    assert.equal(w.length, 1);
    assert.equal(w[0].path, `/api/companies/${IDS.company}/issues`);
    assert.equal(w[0].body.title, "Fix content draft: Our kitchen range is here");
    assert.equal(w[0].body.assigneeAgentId, IDS.agents.marketer);
    assert.match(w[0].body.description, /Shorter, please\./);
    assert.ok(!w[0].body.description.includes(h.state));
    const id = item.id.slice(8);
    const d = (await call(h.url, "GET", `/api/content/${id}`)).json.draft;
    assert.deepEqual([d.status, d.note], ["sent_back", "Shorter, please."]);
    assert.equal((await inboxContent(h)).length, 1);
    writeFileSync(join(contentDir(h), "launch-post.md"), post("Our kitchen range is here", "Shorter."));
    assert.equal((await call(h.url, "GET", `/api/content/${id}`)).json.draft.status, "draft");
    assert.equal((await inboxContent(h)).length, 2);
  });
});

test("send back with the board off leaves the draft as it was", async () => {
  await withHome(async (h) => {
    const item = (await inboxContent(h)).find((i) => i.title.includes("kitchen"));
    await h.board.close();
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: item.id, action: "send_back", note: "x" } });
    assert.equal(r.status, 502);
    assert.equal((await call(h.url, "GET", `/api/content/${item.id.slice(8)}`)).json.draft.status, "draft");
  });
});

test("the publishing switch is off, with plain words, and no route turns it on", async () => {
  await withHome(async (h) => {
    const p = await page(h);
    assert.deepEqual(p.switches, [{ id: "publishing", label: "Publish posts and newsletters", on: false, explain: "Connect an account to turn this on." }]);
    for (const path of ["/api/departments/marketing", "/api/content/x", "/api/departments/marketing/publishing"]) {
      const r = await call(h.url, "POST", path, { body: { on: true } });
      assert.ok([404, 405].includes(r.status), path);
    }
    assert.equal((await page(h)).switches[0].on, false);
  });
});

test("untrusted files: links out, oversize files and markup stay inert", async () => {
  await withHome(async (h) => {
    const outside = join(h.state, "..", "outside.md");
    writeFileSync(outside, post("Secret from outside"));
    symlinkSync(outside, join(contentDir(h), "link.md"));
    writeFileSync(join(contentDir(h), "big.md"), post("Big", "x".repeat(200 * 1024)));
    const other = join(h.state, "tasks", "company-work", "STH-9");
    mkdirSync(other, { recursive: true });
    symlinkSync(join(h.state, "knowledge"), join(other, "content"));
    writeFileSync(join(contentDir(h), "markup.md"), post("<img src=x onerror=alert(1)>", "<script>1</script>"));
    const p = await page(h);
    const titles = rows(p).map((r) => r.title);
    assert.ok(!titles.includes("Secret from outside"));
    assert.ok(!titles.includes("Big"));
    assert.ok(titles.includes("<img src=x onerror=alert(1)>"));
    assert.ok(p.sections.find((s) => s.id === "problems").rows.some((r) => r.file === "big.md" && /100 KB/.test(r.problem)));
    assert.equal(rows(p).length, 3);
    const s = await call(h.url, "GET", "/api/search?q=script");
    assert.equal(s.json.groups.find((g) => g.source === "marketing").results[0].title, "<img src=x onerror=alert(1)>");
  });
});

test("search finds drafts by title and by text", async () => {
  await withHome(async (h) => {
    const g = (await call(h.url, "GET", "/api/search?q=workshop")).json.groups.find((x) => x.source === "marketing");
    assert.equal(g.label, "Marketing");
    assert.equal(g.results.length, 2);
    assert.deepEqual(g.results[0].link.page, "marketing");
    const none = (await call(h.url, "GET", "/api/search?q=zebra")).json.groups.find((x) => x.source === "marketing");
    assert.ok(!none || none.results.length === 0);
  });
});

test("the module files carry no network or publishing code", async () => {
  const dir = join(import.meta.dirname, "..");
  for (const f of ["content/store.mjs", "content/context.mjs", "routes/marketing.mjs", "inbox/content.mjs", "search/content.mjs"]) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.ok(!/node:(http|https|net|dgram|tls|dns)|child_process|fetch\(|https?:\/\//.test(src), f);
  }
});
