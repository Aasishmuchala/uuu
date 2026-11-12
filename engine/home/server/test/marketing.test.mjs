// Marketing drafts (CONTRACTS 9.8, 9.6): found in goal folders, kept as records, approved in the inbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { plainDay, plainRange, indiaToday } from "../content/plain-date.mjs";
import { actAsSeen, call, writes } from "../lib/testing.mjs";

const HERE_M63 = dirname(fileURLToPath(import.meta.url));

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

test("dates are plain words in India time: the week hint and the Planned for detail", async () => {
  assert.equal(plainRange("2026-11-09", "2026-11-15"), "9 to 15 November");
  assert.equal(plainRange("2026-11-30", "2026-12-06"), "30 November to 6 December");
  assert.equal(plainDay("2026-11-12"), "Thursday 12 November");
  assert.equal(indiaToday(new Date("2026-11-08T19:00:00Z")), "2026-11-09");
  await withHome(async (h) => {
    const hint = (await page(h)).figures.find((f) => f.id === "this_week").hint;
    assert.match(hint, /^\d{1,2}( [A-Z][a-z]+)? to \d{1,2} [A-Z][a-z]+$/);
    for (const i of await inboxContent(h)) {
      const v = i.details.find((x) => x.label === "Planned for").value;
      assert.match(v, /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} [A-Z][a-z]+$/);
    }
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
    const r = await actAsSeen(h.url, { id: item.id, action: "approve" });
    assert.equal(r.status, 200);
    assert.match(r.json.message, /Nothing is published/);
    assert.equal(writes(h.board).length, 0);
    assert.equal((await inboxContent(h)).length, 1);
    writeFileSync(join(contentDir(h), "launch-post.md"), post("Changed after approval", "Different."));
    const d = (await call(h.url, "GET", `/api/content/${item.id.slice(8)}`)).json.draft;
    assert.equal(d.status, "approved");
    assert.equal(d.title, "Our kitchen range is here");
    assert.equal((await inboxContent(h)).length, 1);
    const again = await actAsSeen(h.url, { id: item.id, action: "approve" });
    assert.ok([404, 409].includes(again.status));
    assert.equal(rows(await page(h)).find((x) => x.title === "Our kitchen range is here").status, "Approved");
  });
});

test("send back: note stored, one board task for the Marketer, item leaves; an edit brings it back", async () => {
  await withHome(async (h) => {
    const item = (await inboxContent(h)).find((i) => i.title.includes("kitchen"));
    const noNote = await actAsSeen(h.url, { id: item.id, action: "send_back" });
    assert.equal(noNote.status, 400);
    const r = await actAsSeen(h.url, { id: item.id, action: "send_back", note: "Shorter, please." });
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
    const r = await actAsSeen(h.url, { id: item.id, action: "send_back", note: "x" });
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

// V55: in the live trial the Chief of staff's step text asked for its own file layout, the Marketer followed it,
// and no draft reached the owner. The Marketer's instructions and the routine's ask now hold the header.
test("the Marketer keeps the draft header whatever a step's text says, and writes only drafts in content/", () => {
  const role = readFileSync(join(import.meta.dirname, "..", "..", "..", "company", "roles", "marketer.md"), "utf8");
  assert.match(role, /Keep it exactly, even when a step's text asks for another layout/);
  assert.match(role, /Write nothing but drafts in `content\/`: no schedule, index or notes file\./);
  assert.match(role, /Put sources, status notes and the week at a glance in your report, not in the files\./);
  assert.match(role, /no status line such as `DRAFT`, and no repeat of the title as its first line/);
});

test("the weekly content plan asks for the Marketer's draft layout and nothing beside the drafts", () => {
  const { ask } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "company", "routines", "weekly-content-plan.json"), "utf8"));
  assert.match(ask, /the Marketer's usual draft layout with its title, channel and planned date at the top/);
  assert.match(ask, /put nothing else beside the drafts/);
  assert.match(ask, /Nothing is to be published or sent\./);
  // Run on a Monday at 10:00, "the coming week" read as either this week or the next; the trial picked the next.
  assert.match(ask, /^Plan the content for the seven days starting today:/);
  assert.doesNotMatch(ask, /coming week/);
});

test("a file in the trial's layout (no --- header) makes no draft and is listed under problems", async () => {
  await withHome(async (h) => {
    writeFileSync(join(contentDir(h), "warranty-post.md"), "Day: Wednesday, 2026-11-18\nChannel: post\nStatus: DRAFT\nSources: warranty.md\n\nBacked for the long haul\n");
    const p = await page(h);
    assert.ok(!rows(p).some((r) => r.title === "Backed for the long haul"));
    assert.ok(p.sections.find((s) => s.id === "problems").rows.some((r) => r.file === "warranty-post.md"));
    assert.ok(!(await inboxContent(h)).some((i) => /long haul/.test(i.title)));
  });
});

// ---- version 3 (CONTRACTS-V3 36.1, 36.4): concepts, carousels and recipes on the Marketing answer.
const V3 = { routes: ["marketing"], inbox: ["content"] };
const section = (p, id) => p.sections.find((s) => s.id === id);
const conceptsFile = (h) => join(h.state, "tasks", "company-work", "STH-23", "concepts.md");
async function withV3(fn) {
  const { startV2 } = await import("../lib/testing-v2.mjs");
  const h = await startV2(V3);
  try { return await fn(h); } finally { await h.close(); }
}

test("the three new sections are there, each with its empty sentence, and the old ones stay", async () => {
  await withHome(async (h) => {
    const p = await page(h);
    assert.deepEqual(p.sections.map((s) => s.id), ["calendar", "concepts", "carousels", "recipes", "problems"]);
    for (const id of ["concepts", "carousels", "recipes"]) {
      assert.ok(section(p, id).emptyText.length > 10, id);
      assert.ok(Array.isArray(section(p, id).rows), id);
    }
    assert.equal(section(p, "recipes").rows.length, 0);
  });
});

test("concepts: the seed's STH-23 gives its five headlines and a link to the task", async () => {
  await withV3(async (h) => {
    const rows = section(await page(h), "concepts").rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identifier, "STH-23");
    assert.equal(rows[0].taskId, "e0000000-0000-4000-8000-000000000023");
    assert.equal(rows[0].title, "Five concepts before any design: Diwali offer");
    assert.equal(rows[0].headlines.length, 5);
    assert.equal(rows[0].headlines[0], "A new kitchen before the lamps are lit");
  });
});

test("concepts: five or none (four, six, out of order, too long, no title, a link)", async () => {
  await withV3(async (h) => {
    const five = readFileSync(conceptsFile(h), "utf8");
    const heads = (n) => Array.from({ length: n }, (_, i) => `## ${i + 1}. Headline ${i + 1}\nangle: a\nwhy: b`).join("\n");
    const bad = [
      `# Concepts: x\n${heads(4)}\n`,
      `# Concepts: x\n${heads(6)}\n`,
      five.replace("## 2.", "## 3."),
      five.replace("A new kitchen before the lamps are lit", "x".repeat(81)),
      five.replace(/^# Concepts: Diwali offer\n/, ""),
      five.replace("## 3.", "### 3."),
    ];
    for (const text of bad) {
      writeFileSync(conceptsFile(h), text);
      assert.equal(section(await page(h), "concepts").rows.length, 0, text.slice(0, 60));
    }
    writeFileSync(conceptsFile(h), `# Concepts: x\n${heads(5)}\n`);
    assert.deepEqual(section(await page(h), "concepts").rows[0].headlines, ["Headline 1", "Headline 2", "Headline 3", "Headline 4", "Headline 5"]);
    // A link is never followed.
    const outside = join(h.state, "outside-concepts.md");
    writeFileSync(outside, five);
    rmSync(conceptsFile(h));
    symlinkSync(outside, conceptsFile(h));
    assert.equal(section(await page(h), "concepts").rows.length, 0);
  });
});

test("carousels: a link to each set the Studio lists, with its task", async () => {
  await withV3(async (h) => {
    const rows = section(await page(h), "carousels").rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "STH-24/launch");
    assert.equal(rows[0].taskId, "e0000000-0000-4000-8000-000000000024");
    assert.equal(rows[0].count, 3);
    assert.equal(rows[0].ok, true);
    assert.deepEqual(rows[0].link, { page: "marketing", id: null, slides: "STH-24/launch" });
  });
});

test("recipes: the seed's accepted carousel is a row; the unaccepted concepts are not", async () => {
  await withV3(async (h) => {
    const rows = section(await page(h), "recipes").rows;
    assert.deepEqual(rows.map((r) => [r.identifier, r.job, r.verdict, r.rounds]), [["STH-24", "A carousel from one concept", "Accepted", 1]]);
  });
});

// ---- M63 item 25: the real concepts.md of the Marketing trial (STH-76) had "(40 characters)" after each headline
// and a closing "## Anything unclear" section, so the dashboard listed none.
test("conceptHeadlines reads the trial's real concepts.md: counts stripped, the list ends at the first heading that is not numbered", async () => {
  const { conceptHeadlines } = await import("../routes/marketing.mjs");
  const real = readFileSync(join(HERE_M63, "fixtures-m63", "concepts-STH-76.md"), "utf8");
  assert.deepEqual(conceptHeadlines(real), [
    "Five small habits, one steadier workshop",
    "What a bench looks like before and after five small habits",
    "Walk the bench: five habits, in the order you would do them",
    "One habit, start to finish: putting a tool back where it lives",
    "Tidy is not the same as perfect: a myth worth correcting",
  ]);
  // Still five or none: a sixth numbered heading, or a number out of order, gives none.
  assert.deepEqual(conceptHeadlines(real.replace("## Anything unclear", "## 6. One more")), []);
  assert.deepEqual(conceptHeadlines(real.replace("## 4. ", "## 5. ")), []);
  // Only a trailing count is taken off, and a headline over 80 characters once it is off is refused.
  assert.equal(conceptHeadlines(real.replace("(40 characters)", "(40 characters) now"))[0], "Five small habits, one steadier workshop (40 characters) now");
  assert.deepEqual(conceptHeadlines(real.replace("Five small habits, one steadier workshop", "x".repeat(81))), []);
});

test("conceptHeadlines is linear and capped on hostile text", async () => {
  const { conceptHeadlines } = await import("../routes/marketing.mjs");
  const hostile = [
    `# Concepts: x\n## 1. ${" ".repeat(200000)}(`,
    `# Concepts: x\n${"## 1. a (1 characters)".repeat(50000)}`,
    `# Concepts: ${"#".repeat(300000)}`,
    `# Concepts: x\n${"## 1. (".repeat(100000)}`,
    `# Concepts: x\n## 1. a${" (9".repeat(100000)} characters)`,
  ];
  for (const text of hostile) {
    const t0 = performance.now();
    assert.deepEqual(conceptHeadlines(text), []);
    assert.ok(performance.now() - t0 < 500, `${(performance.now() - t0).toFixed(0)} ms`);
  }
});

// ---- PLAN-V5 K9: a post made as three versions. The versions live in drafts/, which the calendar never scans:
// none is listed before the owner picks, and after the pick only the picked one, already approved (the pick is
// the acceptance), so it never waits in Needs you a second time.
test("the calendar shows one draft after a pick and none before; the others never", async () => {
  const { IDS_V3 } = await import("../../../test/stubs/seed.mjs");
  const { startV2 } = await import("../lib/testing-v2.mjs");
  const { forgetBrandChecks } = await import("../lib/brandcheck.mjs");
  const GOAL = IDS_V3.issues["STH-23"];
  forgetBrandChecks();
  const h = await startV2({
    routes: ["marketing", "inbox"], inbox: ["content", "goals"],
    decisions: { [`template:${GOAL}`]: "marketing/announce-one-thing" },
  });
  try {
    const goal = join(h.state, "tasks", "company-work", "STH-23");
    mkdirSync(join(goal, "drafts"), { recursive: true });
    writeFileSync(join(goal, "variants.json"), JSON.stringify({ kind: "post", name: "launch", round: 1, variants: [{ id: "a", direction: "fact-first" }, { id: "b", direction: "scene" }, { id: "c", direction: "question" }] }));
    for (const id of ["a", "b", "c"]) writeFileSync(join(goal, "drafts", `launch-${id}.md`), post(`Version ${id} of the launch`, `Words of version ${id}.`, "2026-12-0" + (id === "a" ? 2 : id === "b" ? 3 : 4)));
    const titles = async () => rows(await page(h)).map((r) => r.title);
    const before = await titles();
    assert.ok(!before.some((t) => t.startsWith("Version ")), before.join(", "));
    const card = (await call(h.url, "GET", "/api/inbox")).json.items.find((i) => i.id === `goal:${GOAL}`);
    assert.equal(card.kind, "pick");
    assert.deepEqual(card.variants.map((v) => v.preview[0]?.text), ["Words of version a.", "Words of version b.", "Words of version c."]);
    const r = await actAsSeen(h.url, { id: `goal:${GOAL}`, action: "pick", variant: "b" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message, "Picked. Your choice and note are kept for next time.");
    const after = rows(await page(h));
    const picked = after.filter((x) => x.title.startsWith("Version "));
    assert.deepEqual(picked.map((x) => [x.title, x.status, x.planned]), [["Version b of the launch", "Approved", "2026-12-03"]]);
    assert.equal(after.length, before.length + 1);
    assert.ok(!("inboxId" in picked[0]), "approved: nothing waits for the owner");
    const inbox = (await call(h.url, "GET", "/api/inbox")).json.items;
    assert.ok(!inbox.some((i) => i.title.includes("Version ")), "no second step in Needs you");
    assert.ok(!inbox.some((i) => i.id === `goal:${GOAL}`));
  } finally {
    forgetBrandChecks();
    await h.close();
  }
});
