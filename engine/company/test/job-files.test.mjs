// Tests for engine/company/lib/job-files.mjs (CONTRACTS-V3 31.2): first the loader on fixture
// files, one valid folder and one broken folder per rule; then the shared tests of section 39 for
// the 60 real job files of 31.5 and the Researcher's five (PLAN-V5 T34), which skip while a file does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NEEDS, asksIn, isBrainPath, loadJobFiles } from "../lib/job-files.mjs";
import { loadDepartmentFile } from "../lib/department-file.mjs";
import { TOOL_NAMES } from "../lib/routine-files.mjs";
import { loadCompanyFile } from "../lib/company-file.mjs";
import { loadConfig } from "../../lib/config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "v3", "jobs");
const COMPANY = join(HERE, "..");
const REAL = join(COMPANY, "jobs");
const ROLES = [{ slug: "chief-of-staff", name: "Chief of staff" }, { slug: "builder", name: "Builder" }, { slug: "sales", name: "Sales" }];
const DEPS = loadDepartmentFile(join(HERE, "fixtures", "v3", "departments", "valid.json"), ROLES).departments;

test("valid job files load in the department order, then by file name", () => {
  const { jobs, problems } = loadJobFiles(join(FIX, "valid"), ROLES, DEPS);
  assert.deepEqual(problems, []);
  assert.deepEqual(jobs.map((j) => j.file), ["operations/plan-and-build.json", "operations/summary-of-the-week.json",
    "sales/call-write-up.json", "sales/proposal-from-a-call.json"]);
  const p = jobs[3];
  assert.equal(p.id, "proposal-from-a-call");
  assert.deepEqual(p.takes, { from: ["sales/call-write-up"], ask: "earlier", label: "Write the proposal from this" });
  assert.deepEqual(p.asks.map((a) => [a.id, a.kind]), [["earlier", "task"], ["extra", "text"]]);
  assert.equal(Object.keys(p).length, 17, "the sixteen keys and the file");
});

test("a missing folder is an empty list", () => {
  assert.deepEqual(loadJobFiles(join(FIX, "no-such-folder"), ROLES, DEPS), { jobs: [], problems: [] });
});

test("the asks in a text are the ids inside [ ], in order, without repeats", () => {
  assert.deepEqual(asksIn("Bill [customer] for [amount], then thank [customer]."), ["customer", "amount"]);
  assert.deepEqual(asksIn("No asks here."), []);
});

test("a path inside the company brain is a folder's file, a folder, or a loose file", () => {
  for (const p of ["pricing/services.md", "references/", "returns-policy.md", "packs/call-write-up.md"]) assert.ok(isBrainPath(p), p);
  for (const p of ["../x.md", "/etc/x.md", "pricing/../x.md", "secrets/x.md", "brand/a/b.md", "", "brand\\x.md", "./x.md"]) assert.ok(!isBrainPath(p), p);
});

// Folder -> [file, what the one problem says].
const BROKEN = {
  "missing-key": ["sales/proposal-from-a-call.json", /^It has no needs\.$/],
  "extra-key": ["sales/proposal-from-a-call.json", /^It has keys a job does not take: colour\.$/],
  "ask-not-in-text": ["sales/proposal-from-a-call.json", /^Its question extra is not used in its text as \[extra\]\.$/],
  "blank-with-no-ask": ["sales/proposal-from-a-call.json", /^Its text has \[budget\], which is not one of its questions\.$/],
  "takes-ask-not-a-task": ["sales/proposal-from-a-call.json", /^Its takes must name one of its questions of the kind task\.$/],
  "unknown-need": ["sales/proposal-from-a-call.json", /^Its needs must be names from internet, account, /],
  "path-with-dots": ["sales/proposal-from-a-call.json", /^Its read 1 must be a path inside the company brain that does not step out of it\.$/],
  "absolute-path-in-text": ["sales/proposal-from-a-call.json", /^Its text names a full path on this Mac\.$/],
  "absolute-path-in-reads": ["sales/proposal-from-a-call.json", /^Its read 1 must be a path inside the company brain that does not step out of it\.$/],
  "tool-name-in-text": ["sales/proposal-from-a-call.json", /^Its text names a tool by name\.$/],
  "same-title": ["sales/proposal-from-a-call.json", /^Its title is already used by sales\/call-write-up\.json\.$/],
  "wrong-department": ["sales/proposal-from-a-call.json", /^Its department must be sales, as its folder says\.$/],
  "unknown-cluster": ["sales/proposal-from-a-call.json", /^Its cluster must be one of leads or calls\.$/],
  "id-not-file-name": ["sales/proposal-from-a-call.json", /^Its id must match the file name \(proposal\.json\)\.$/],
  "unknown-agent": ["sales/proposal-from-a-call.json", /^Its who names an agent that is not in the company file\.$/],
  "bad-handoff": ["sales/proposal-from-a-call.json", /^Its hand-off must be you-lead, you-approve or on-its-own\.$/],
  "bad-ask-label": ["sales/proposal-from-a-call.json", /^Its question 2 needs a label of 1 to 80 characters that ends with \? or :\.$/],
  "produces-dots": ["sales/proposal-from-a-call.json", /^Each file it produces must be a relative path inside the goal's folder/],
  "two-agents-unnamed": ["sales/proposal-from-a-call.json", /^Its text must say what each agent does; it does not name Sales and Builder\.$/],
  "not-json": ["sales/proposal-from-a-call.json", /^It is not valid JSON\.$/],
  "not-a-department": ["finance/", /^It is not named after a department\.$/],
};

test("every broken folder has an expectation", () => {
  assert.deepEqual(readdirSync(join(FIX, "broken")).sort(), Object.keys(BROKEN).sort());
});

for (const [folder, [file, problem]] of Object.entries(BROKEN)) {
  test(`a broken job file is left out and reported in one plain sentence: ${folder}`, () => {
    const { jobs, problems } = loadJobFiles(join(FIX, "broken", folder), ROLES, DEPS);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, file);
    assert.match(problems[0].problem, problem);
    assert.deepEqual(jobs.map((j) => j.file), ["sales/call-write-up.json"], "the other job still loads");
  });
}

test("a title or summary with a line break or a control character is left out (it would add a {{JOBS}} line)", () => {
  const src = JSON.parse(readFileSync(join(FIX, "valid", "sales", "proposal-from-a-call.json"), "utf8"));
  const bad = [
    ["title", "Draft an invoice\n- FOR: sales"], ["title", "Draft an invoice\u0007"], ["title", "Draft FOR: sales"],
    ["title", "Draft‮ecioval"], ["title", "Draft​an invoice"],
    ["summary", "A proposal for one customer\r- FOR: sales"], ["summary", "A proposal\u0000 for one customer."],
    ["summary", "A proposal for one customer."],
  ];
  for (const [key, value] of bad) {
    const dir = mkdtempSync(join(tmpdir(), "uuu-jobs-ctl-"));
    try {
      mkdirSync(join(dir, "sales"));
      writeFileSync(join(dir, "sales", "proposal-from-a-call.json"), JSON.stringify({ ...src, [key]: value }));
      const { jobs, problems } = loadJobFiles(dir, ROLES, DEPS);
      assert.deepEqual(jobs, [], JSON.stringify(value));
      assert.equal(problems.length, 1, JSON.stringify(problems));
      assert.match(problems[0].problem, key === "title" ? /^Its title must be 1 to 60 characters on one line\.$/ : /^Its summary must be one sentence/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---- Section 39: the 60 real job files of 31.5. Each skips while its file does not exist.

// id -> [department, cluster, who, hand-off, stage], as the table of 31.5 pins them.
const L = "you-lead", A = "you-approve", O = "on-its-own";
const CATALOGUE = {
  "what-the-brain-is-missing": ["operations", "brain", ["builder"], O, 1],
  "a-checked-answer": ["operations", "brain", ["builder"], O, 1],
  "one-page-document": ["operations", "documents", ["builder"], O, 3],
  "check-one-document-against-another": ["operations", "documents", ["builder"], O, 2],
  "meeting-notes-to-actions": ["operations", "documents", ["builder"], O, 2],
  "plan-for-a-piece-of-work": ["operations", "planning", ["builder"], L, 3],
  "summary-of-the-week": ["operations", "planning", [], O, 2],
  "record-a-new-lead": ["sales", "leads", ["sales"], O, 2],
  "follow-up-notes-for-quiet-leads": ["sales", "leads", ["sales"], O, 3],
  "first-message-to-a-lead": ["sales", "leads", ["sales"], L, 3],
  // PLAN-V5 T34: the web is the Researcher's, so the Researcher finds them and Sales makes the list.
  "find-companies-to-approach": ["sales", "leads", ["researcher", "sales"], O, 2],
  "briefing-before-a-call": ["sales", "calls", ["sales"], L, 3],
  "call-write-up": ["sales", "calls", ["sales"], O, 2],
  "proposal-from-a-call": ["sales", "calls", ["sales"], A, 4],
  "move-a-deal-on-after-a-call": ["sales", "deals", ["sales"], O, 2],
  "summary-of-open-deals": ["sales", "deals", ["sales"], O, 2],
  "draft-a-quotation": ["books", "selling", ["bookkeeper"], A, 3],
  "quotation-from-a-call": ["books", "selling", ["bookkeeper"], A, 4],
  "draft-an-invoice": ["books", "selling", ["bookkeeper"], A, 3],
  "invoice-from-a-quotation": ["books", "selling", ["bookkeeper"], A, 4],
  "record-a-payment-received": ["books", "selling", ["bookkeeper"], A, 2],
  "what-customers-owe": ["books", "selling", ["bookkeeper"], O, 2],
  "unpaid-invoices-with-follow-ups": ["books", "selling", ["bookkeeper"], L, 3],
  "record-a-supplier-bill": ["books", "buying", ["bookkeeper"], A, 2],
  "month-end-unpaid-bills": ["books", "month-end", ["bookkeeper"], O, 2],
  "gst-summary-for-a-month": ["books", "month-end", ["bookkeeper"], L, 2],
  "file-the-gst-return": ["books", "month-end", ["bookkeeper"], L, 4],
  "sort-open-requests-by-urgency": ["support", "requests", ["support"], O, 2],
  "draft-a-reply-to-one-request": ["support", "replies", ["support"], A, 3],
  "replies-for-old-requests": ["support", "replies", ["support"], A, 3],
  "most-common-questions-this-month": ["support", "learning", ["support"], O, 2],
  "answers-page-from-past-requests": ["support", "learning", ["support"], A, 3],
  "add-a-staff-record": ["people", "records", ["people"], O, 2],
  "who-is-on-leave": ["people", "leave", ["people"], O, 2],
  "prepare-a-leave-request": ["people", "leave", ["people"], A, 3],
  "attendance-for-a-day-or-week": ["people", "leave", ["people"], A, 2],
  "first-week-plan": ["people", "joining", ["people"], L, 3],
  "five-concepts": ["marketing", "ideas", ["marketer"], L, 3],
  "a-content-plan-for-a-month": ["marketing", "ideas", ["marketer"], L, 3],
  "a-week-of-posts": ["marketing", "writing", ["marketer"], A, 3],
  "a-newsletter-on-one-subject": ["marketing", "writing", ["marketer"], A, 3],
  "announce-one-thing": ["marketing", "writing", ["marketer"], A, 3],
  "shorten-last-weeks-drafts": ["marketing", "writing", ["marketer"], A, 3],
  "posts-from-one-document": ["marketing", "writing", ["marketer"], A, 3],
  "publish-approved-posts": ["marketing", "writing", ["marketer"], A, 4],
  "carousel-from-a-concept": ["marketing", "design", ["marketer", "artist"], A, 4],
  "carousel-from-a-document": ["marketing", "design", ["marketer", "artist"], A, 4],
  "score-a-piece-against-the-brand": ["marketing", "review", ["marketer"], O, 3],
  "what-worked-last-month": ["marketing", "review", ["marketer"], O, 2],
  "a-flat-plate-with-holes": ["studio", "parts", ["drafter"], O, 3],
  "a-simple-bracket": ["studio", "parts", ["drafter"], O, 3],
  "change-an-earlier-part": ["studio", "parts", ["drafter"], O, 3],
  "a-small-animated-character": ["studio", "pictures", ["artist"], O, 3],
  "a-set-of-small-icons": ["studio", "pictures", ["artist"], O, 3],
  "a-badge-or-logo-mark": ["studio", "pictures", ["artist"], O, 3],
  "an-animated-title-card": ["studio", "motion", ["artist"], O, 3],
  "a-moving-chart-from-figures": ["studio", "motion", ["artist"], O, 3],
  "a-slow-reveal-from-pictures": ["studio", "motion", ["artist"], O, 3],
  "cut-the-pauses-out-of-a-video": ["studio", "motion", ["artist"], O, 3],
  "captions-for-a-video": ["studio", "motion", ["artist"], O, 3],
  // PLAN-V5 K10, T34: the Researcher's five jobs.
  "research-a-topic": ["marketing", "research", ["researcher"], O, 2],
  "research-a-competitors-site": ["marketing", "research", ["researcher"], O, 2],
  "research-notes-from-a-video": ["marketing", "research", ["researcher"], O, 2],
  "research-a-swipe-file": ["marketing", "research", ["researcher"], O, 2],
  "a-monthly-trend-scan": ["marketing", "research", ["researcher"], O, 2],
};
const RESEARCH = ["research-a-topic", "research-a-competitors-site", "research-notes-from-a-video", "research-a-swipe-file", "a-monthly-trend-scan"];

// The roles straight from the company file, so these tests do not depend on the role files.
function realRoles() {
  const doc = JSON.parse(readFileSync(join(COMPANY, "company.json"), "utf8"));
  return doc.agents.map((a) => ({ slug: a.slug, name: a.name }));
}
let loaded = null;
function realCatalogue() {
  if (!loaded) {
    const roles = realRoles();
    const { departments } = loadDepartmentFile(join(COMPANY, "departments.json"), roles);
    loaded = loadJobFiles(REAL, roles, departments);
  }
  return loaded;
}

test("the catalogue table has the 60 jobs of the contract and the Researcher's five, as many per department as it says", () => {
  const per = {};
  for (const [dep] of Object.values(CATALOGUE)) per[dep] = (per[dep] || 0) + 1;
  assert.equal(Object.keys(CATALOGUE).length, 65);
  assert.deepEqual(per, { operations: 7, sales: 9, books: 11, support: 5, people: 5, marketing: 17, studio: 11 });
});

for (const [id, [dep, cluster, who, handoff, stage]] of Object.entries(CATALOGUE)) {
  const file = join(REAL, dep, `${id}.json`);
  const skip = existsSync(file) ? false : `${dep}/${id}.json does not exist yet`;
  const read = () => JSON.parse(readFileSync(file, "utf8"));

  test(`job ${id}: is a valid job file`, { skip }, () => {
    const { jobs, problems } = realCatalogue();
    assert.deepEqual(problems.filter((p) => p.file === `${dep}/${id}.json`), []);
    assert.ok(jobs.some((j) => j.file === `${dep}/${id}.json`), "the job loads");
  });

  test(`job ${id}: has the pinned department, cluster, who, hand-off and stage`, { skip }, () => {
    const j = read();
    assert.deepEqual([j.department, j.cluster, j.who, j.handoff, j.stage], [dep, cluster, who, handoff, stage]);
  });

  test(`job ${id}: reads as the owner would say it`, { skip }, () => {
    const j = read();
    const words = [j.title, j.summary, j.text, ...(Array.isArray(j.asks) ? j.asks.map((a) => a.label) : []),
      ...(j.takes && typeof j.takes.label === "string" ? [j.takes.label] : [])];
    const all = words.join(" ");
    for (const t of TOOL_NAMES) assert.ok(!new RegExp(`\\b${t}\\b`, "i").test(all), `names ${t}`);
    assert.doesNotMatch(all, /\/Users\/|~\/|\/private\/|\/tmp\/|https?:|www\./, "no path or address");
    assert.doesNotMatch(all, /[`$<>{}\\]/, "no code, markup or variables");
    assert.doesNotMatch(j.text, /^(FOR|ROUTINE|SIZE|RESULT|PLAN READY|PLAN FIRST|STOPPED|VERDICT|JOB|ASK)\b/m, "no markers");
    assert.match(j.text, /^[A-Z[]/, "the text starts as a sentence");
    assert.match(j.text.trim(), /[.?!\]]$/, "the text ends as a sentence");
    assert.match(j.title, /^[A-Z0-9]/, "the title starts with a capital");
    assert.match(j.summary.trim(), /^[A-Z].*[.?!]$/, "the summary is one sentence");
  });
}

test("the catalogue has exactly the 60 jobs of the contract, the Researcher's five and the brand-book job", {
  skip: Object.entries(CATALOGUE).every(([id, [dep]]) => existsSync(join(REAL, dep, `${id}.json`))) ? false : "not all 65 job files exist yet",
}, () => {
  const { jobs, problems } = realCatalogue();
  assert.deepEqual(problems, []);
  // V5 T17 adds one job to the 60 of the contract: "Read the brand book"; T34 the Researcher's five.
  assert.deepEqual(jobs.map((j) => j.id).sort(), [...Object.keys(CATALOGUE), "read-the-brand-book"].sort());
});

// ---- PLAN-V5 K10, T34: the research jobs, and the jobs that may follow them.

test("the five research jobs need the web, read no company file and each produce research/notes.md", () => {
  const { jobs } = realCatalogue();
  for (const id of RESEARCH) {
    const j = jobs.find((x) => x.file === `marketing/${id}.json`);
    assert.ok(j, `${id} loads`);
    assert.deepEqual(j.needs, ["internet"], id);
    assert.deepEqual(j.produces, ["research/notes.md"], id);
    assert.deepEqual(j.reads, [], `${id}: the walled Researcher cannot open the company's files`);
    assert.equal(j.takes, null, id);
    assert.equal(j.size, "S", `${id}: one step, so the Chief writes no brief the Researcher could not read`);
    assert.equal(j.planFirst, false, id);
  }
  // Every job that needs the web has the Researcher, and the Researcher does its five and the first step of one more.
  for (const j of jobs) {
    assert.equal(j.needs.includes("internet"), j.who.includes("researcher"), j.file);
    assert.equal(j.who.includes("researcher"), [...RESEARCH, "find-companies-to-approach"].includes(j.id), j.file);
  }
});

test("finding companies to approach: the Researcher reads the web first, then Sales makes the list from its notes", () => {
  const j = realCatalogue().jobs.find((x) => x.file === "sales/find-companies-to-approach.json");
  assert.deepEqual([j.id, j.title, j.department, j.cluster], ["find-companies-to-approach", "Find companies to approach", "sales", "leads"]);
  assert.deepEqual(j.who, ["researcher", "sales"], "the Researcher's step comes first");
  assert.deepEqual(j.needs, ["internet"]);
  assert.equal(j.size, "M");
  assert.deepEqual(j.produces, ["companies.md"]);
  assert.deepEqual(j.reads, [{ file: "customers/ideal-customer.md", need: "helps" }]);
  assert.deepEqual(j.asks.map((a) => [a.id, a.kind, a.required]), [["kind", "line", true], ["count", "number", false]]);
  for (const s of ["first the Researcher searches public web pages", "using only the words I wrote here and never our customer files",
    "Then Sales reads those notes in the research folder", "the source for each", "Do not contact anyone"]) assert.ok(j.text.includes(s), s);
  assert.ok(j.text.indexOf("Researcher") < j.text.indexOf("Sales"), "in that order");
});

// Jobs that may follow research take it through an optional question of the kind task, used last in their text,
// so a job started without research reads exactly as before up to that sentence.
const FOLLOWERS = {
  "marketing/five-concepts": RESEARCH,
  "marketing/a-content-plan-for-a-month": ["a-monthly-trend-scan", "research-a-topic", "research-a-competitors-site"],
  "marketing/announce-one-thing": ["research-a-topic", "research-a-competitors-site"],
  "studio/an-animated-title-card": ["research-notes-from-a-video", "research-a-swipe-file"],
  "studio/a-slow-reveal-from-pictures": ["research-notes-from-a-video", "research-a-swipe-file"],
};

test("the jobs that may follow research take it through an optional task question at the end of their text", () => {
  const { jobs } = realCatalogue();
  const refs = new Set(jobs.map((j) => j.file.replace(/\.json$/, "")));
  for (const [ref, from] of Object.entries(FOLLOWERS)) {
    const j = jobs.find((x) => x.file === `${ref}.json`);
    assert.ok(j, ref);
    assert.deepEqual(j.takes.from, from.map((id) => `marketing/${id}`), ref);
    for (const f of j.takes.from) assert.ok(refs.has(f), `${ref} follows ${f}, which exists`);
    const ask = j.asks.find((a) => a.id === j.takes.ask);
    assert.deepEqual(ask, { id: "research", label: ask.label, kind: "task", required: false }, ref);
    assert.ok(j.text.endsWith(": [research]"), ref);
    assert.match(j.text, /If I name research notes here, /, ref);
  }
  // A carousel follows a set of concepts: its one task question is the concepts, so research reaches it through them.
  const carousel = jobs.find((x) => x.file === "marketing/carousel-from-a-concept.json");
  assert.deepEqual(carousel.takes, { from: ["marketing/five-concepts"], ask: "earlier", label: "Make a carousel from this" });
});

// ---- {{JOBS}} in a role file (31.3), filled by loadCompanyFile from departments.json and jobs/.

// A copy of the company folder (without its tests) that a test may change, with a temp state folder.
function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-jobs-"));
  try {
    cpSync(COMPANY, join(dir, "company"), { recursive: true, filter: (src) => !src.startsWith(join(COMPANY, "test")) });
    const cfg = JSON.parse(readFileSync(join(COMPANY, "..", "config.json"), "utf8"));
    cfg.stateRoot = join(dir, "state");
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
    return fn(join(dir, "company"), loadConfig({ path: join(dir, "config.json") }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("{{JOBS}} is filled with one line per job: title, department, who or you plan it, summary", () => {
  withCopy((dir, config) => {
    rmSync(join(dir, "jobs"), { recursive: true, force: true });
    cpSync(join(FIX, "valid", "sales"), join(dir, "jobs", "sales"), { recursive: true });
    mkdirSync(join(dir, "jobs", "operations"));
    cpSync(join(FIX, "valid", "operations", "summary-of-the-week.json"), join(dir, "jobs", "operations", "summary-of-the-week.json"));
    writeFileSync(join(dir, "jobs", "sales", "broken.json"), "{\n");
    writeFileSync(join(dir, "roles", "builder.md"), "# Builder\n\nJobs:\n{{JOBS}}\nEnd.\n");
    const c = loadCompanyFile(join(dir, "company.json"), config);
    const by = Object.fromEntries(c.agents.map((a) => [a.slug, a]));
    assert.equal(by.builder.instructions, "# Builder\n\nJobs:\n"
      + "- Summary of the week (Operations): you plan it. What was done this week, what is stuck and what comes next.\n"
      + "- Call write-up (Sales): Sales. A write-up of one call, with a note and follow-up tasks on the customer's record.\n"
      + "- Proposal from a call write-up (Sales): Sales. A written proposal for one customer, from the call write-up and your price list.\n"
      + "End.\n");
  });
});

test("{{JOBS}} names several agents joined by commas", () => {
  withCopy((dir, config) => {
    rmSync(join(dir, "jobs"), { recursive: true, force: true });
    mkdirSync(join(dir, "jobs", "marketing"), { recursive: true });
    const job = JSON.parse(readFileSync(join(FIX, "valid", "operations", "plan-and-build.json"), "utf8"));
    Object.assign(job, { department: "marketing", cluster: "design", who: ["marketer", "artist"], text: "The Marketer writes the words for the [page] page and the Artist lays it out." });
    writeFileSync(join(dir, "jobs", "marketing", "plan-and-build.json"), JSON.stringify(job));
    writeFileSync(join(dir, "roles", "builder.md"), "{{JOBS}}\n");
    const c = loadCompanyFile(join(dir, "company.json"), config);
    assert.equal(c.agents.find((a) => a.slug === "builder").instructions,
      "- Plan and build a page (Marketing): Marketer, Artist. The Chief of staff plans a page and the Builder writes it.\n");
  });
});

test("{{JOBS}} is an empty line when there are no jobs, and the file loads without departments.json", () => {
  withCopy((dir, config) => {
    rmSync(join(dir, "jobs"), { recursive: true, force: true });
    writeFileSync(join(dir, "roles", "builder.md"), "Before\n{{JOBS}}\nAfter\n");
    assert.equal(loadCompanyFile(join(dir, "company.json"), config).agents.find((a) => a.slug === "builder").instructions, "Before\n\nAfter\n");
    rmSync(join(dir, "departments.json"));
    cpSync(join(FIX, "valid", "sales"), join(dir, "jobs", "sales"), { recursive: true });
    assert.equal(loadCompanyFile(join(dir, "company.json"), config).agents.find((a) => a.slug === "builder").instructions, "Before\n\nAfter\n");
  });
});

// ---- V5 T6: the needs "generation" and "browser" are names a new job may use.
test("NEEDS gives generation and browser after account, and a job may name them", () => {
  assert.deepEqual(NEEDS.slice(0, 5), ["internet", "account", "generation", "browser", "cad-tools"]);
  const dir = mkdtempSync(join(tmpdir(), "uuu-needs-"));
  try {
    cpSync(join(FIX, "valid"), dir, { recursive: true });
    const f = join(dir, "sales", "call-write-up.json");
    const doc = JSON.parse(readFileSync(f, "utf8"));
    doc.needs = ["generation", "browser"];
    writeFileSync(f, JSON.stringify(doc));
    const { problems } = loadJobFiles(dir, ROLES, DEPS);
    assert.deepEqual(problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
