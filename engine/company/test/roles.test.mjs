// Checks the ten role files (CONTRACTS-V2 21.3 and section 23, CONTRACTS-V3 section 39). A role's
// four tests skip until its file holds the {{STAGED}} line; its version 3 test skips until its file
// holds the first new string of its row; the task that writes it shows them passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../lib/config.mjs";
import { loadCompanyFile } from "../lib/company-file.mjs";

const companyDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(companyDir, "..");

const SLUGS = ["chief-of-staff", "builder", "checker", "bookkeeper", "sales", "support", "people", "marketer", "drafter", "artist"];
const PARTS = ["## Who you are", "## Standing rules", "## How you start", "## Your job", "## The staged way of working", "## How you finish", "## When you are stuck"];
const BENCH = ["DRAFT:", "UUU_BENCH_URL", "X-Frappe-Site-Name: $UUU_BENCH_SITE", "Authorization: token $UUU_BENCH_API_KEY:$UUU_BENCH_API_SECRET"];
// What each role file must contain, word for word (section 23).
const FORMATS = {
  "chief-of-staff": ["{{TEAM}}", "RESULT:", "SIZE:", "PLAN READY:", "PLAN FIRST", "PLAN ACCEPTED", "ANSWER:", "STOPPED:", "ROUTINE:",
    "00-brief.md", "01-plan.md", "04-summary.md", "# Daily brief:", "by:", "about:"],
  builder: [],
  checker: ["VERDICT: PASS", "VERDICT: FAIL", "# Check: round", "## Questions", "## Actions", "## Anything unclear", "Verdict: PASS", "Verdict: FAIL",
    "evidence:", "Do the exported frames equal the tagged frame ranges?"],
  bookkeeper: BENCH,
  sales: BENCH,
  support: [...BENCH, "DRAFT REPLY:"],
  people: BENCH,
  marketer: ["title:", "channel:", "planned:", "content/<slug>.md"],
  drafter: ['"$UUU_CAD_PYTHON" "$UUU_CAD_EXPORT" <name>.py', "result", "millimetres"],
  artist: ['"$UUU_ART_PYTHON" "$UUU_ART_TOOL" <name>.py', "frames", "tags", "manifest.json", "art/<name>/"],
};
const EVERY = ["{{STAGED}}", "### Your part", "FOR:"];
// What a role file must also contain from version 3 (CONTRACTS-V3 sections 34 and 39), word for word.
const FORMATS_V3 = {
  "chief-of-staff": ["{{JOBS}}", "ASK", "answer.md", "# Answer", "## Sources", "## Not in the files", "JOB:"],
  checker: ["scores:", "at least 8 out of 10"],
  bookkeeper: ["Quotation", "DRAFT: Quotation"],
  sales: ["call-write-up.md", "proposal.md"],
  marketer: ["concepts.md", "review.md"],
  artist: ['"$UUU_ART_PYTHON" "$UUU_ART_SLIDES" <name>.py', '"$UUU_ART_PYTHON" "$UUU_ART_VIDEO"', "slides/<name>/", "video/<name>/"],
};

const roleFile = (slug) => join(companyDir, "roles", `${slug}.md`);
const read = (slug) => readFileSync(roleFile(slug), "utf8");
const staged = (slug) => existsSync(roleFile(slug)) && read(slug).split("\n").some((l) => l.trim() === "{{STAGED}}");

// The filled instructions of every agent, loaded once, with the state folder at a temp path.
let filled = null;
function instructionsOf(slug) {
  if (!filled) {
    const dir = mkdtempSync(join(tmpdir(), "uuu-roles-"));
    try {
      const cfg = JSON.parse(readFileSync(join(engineDir, "config.json"), "utf8"));
      cfg.stateRoot = join(dir, "state");
      writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
      const c = loadCompanyFile(join(companyDir, "company.json"), loadConfig({ path: join(dir, "config.json") }));
      filled = Object.fromEntries(c.agents.map((a) => [a.slug, a.instructions]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return filled[slug];
}

for (const slug of SLUGS) {
  const skip = staged(slug) ? false : "the role file has no {{STAGED}} line yet";

  test(`role ${slug}: has its parts in order with the staged section`, { skip }, () => {
    const text = read(slug);
    const at = PARTS.map((p) => text.indexOf(`\n${p}\n`));
    assert.ok(at.every((i) => i >= 0), `missing a part: ${PARTS.filter((_, i) => at[i] < 0).join(", ")}`);
    assert.deepEqual([...at].sort((x, y) => x - y), at, "parts out of order");
    const section = text.slice(at[4], at[5]);
    const lines = section.split("\n").map((l) => l.trim());
    const s = lines.indexOf("{{STAGED}}");
    const yours = lines.indexOf("### Your part");
    assert.ok(s > 0, "{{STAGED}} is in the staged section");
    assert.ok(yours > s, "### Your part follows {{STAGED}}");
    assert.ok(lines.slice(yours + 1).some((l) => l.length > 0), "### Your part has lines of its own");
  });

  test(`role ${slug}: size and safety rules`, { skip }, () => {
    const text = read(slug);
    const lines = text.replace(/\n$/, "").split("\n").length;
    assert.ok(lines >= 60 && lines <= 170, `${lines} lines`);
    for (const s of ["current working folder", "$UUU_LESSONS_FILE", "$UUU_KNOWLEDGE_DIR", "blocked"]) assert.ok(text.includes(s), s);
    assert.ok(!text.includes("/Users/"), "/Users/");
    assert.ok(!text.includes("~/"), "~/");
  });

  test(`role ${slug}: teaches its formats`, { skip }, () => {
    const text = read(slug);
    for (const s of [...EVERY, ...FORMATS[slug]]) assert.ok(text.includes(s), s);
  });

  test(`role ${slug}: fills into complete instructions`, { skip }, () => {
    const text = instructionsOf(slug);
    assert.equal(typeof text, "string");
    assert.ok(!text.includes("{{"), "a placeholder is left");
    assert.ok(text.includes("00-brief.md"), "the shared staged text is folded in");
  });

  if (FORMATS_V3[slug]) {
    const first = FORMATS_V3[slug][0];
    const v3 = existsSync(roleFile(slug)) && read(slug).includes(first) ? false : `the role file does not hold ${first} yet`;
    test(`role ${slug}: teaches its version 3 formats`, { skip: v3 }, () => {
      const text = read(slug);
      for (const s of FORMATS_V3[slug]) assert.ok(text.includes(s), s);
      if (slug === "chief-of-staff") assert.match(instructionsOf(slug), /^- .+ \(Operations\): .+\. .+$/m, "the job list is filled in");
    });
  }
}
