// The ledger's command (PLAN-STRESS, pinned interfaces). The ledger and checklist .md files are written only here.
//   ledger.mjs render                      -> STRESS-LEDGER.md (every finding as its latest pass has it)
//   ledger.mjs add --severity S --area A --title T --repro R --fix F [--pass N] [--check C] [--target X]
//                  [--expected E] [--actual A] [--evidence P] [--suspect a,b]      a finding a person made
//   ledger.mjs set <id> [--status S] [--fix F] [--batch A|B|none] [--risky true|false] [--suspect a,b]
//                  [--waits apps|mac|desktop|none] [--severity S] [--title T]
//   ledger.mjs diff <a> <b>                -> what pass <b> cleared, kept and added against pass <a>
//   ledger.mjs checklist                   -> STRESS-LAUNCH.md from the last pass's files
// Files: env STRESS_OUT (the evidence folder), STRESS_LEDGER and STRESS_LAUNCH (the two .md files) override the
// defaults /Users/aasish/uuu/.router/evidence/stress, .router/STRESS-LEDGER.md and .router/STRESS-LAUNCH.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atLeastMedium, load, outDir, passDir, passes, record, SEVERITIES, update } from "./lib/ledger.mjs";

const LEDGER_MD = process.env.STRESS_LEDGER || "/Users/aasish/uuu/.router/STRESS-LEDGER.md";
const LAUNCH_MD = process.env.STRESS_LAUNCH || "/Users/aasish/uuu/.router/STRESS-LAUNCH.md";

function usage(msg) {
  if (msg) process.stderr.write(`ledger: ${msg}\n`);
  process.stderr.write("usage: ledger.mjs render | add --severity .. --area .. --title .. --repro .. --fix .. | set <id> --status .. --fix .. --batch .. --risky .. | diff <a> <b> | checklist\n");
  process.exit(64);
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) usage(`${a} needs a value`);
      out[a.slice(2)] = v;
      i += 1;
    } else out._.push(a);
  }
  return out;
}

const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 400);
const sevRank = (s) => SEVERITIES.indexOf(s);

function writeMd(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function counts(list) {
  const c = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const r of list) c[r.severity] += 1;
  return c;
}

function render() {
  // Pass 0 is the builders' scratch pass: once a named pass exists, the ledger is the named passes only.
  const named = passes().filter((n) => n > 0);
  const shown = named.length ? named : passes();
  const byId = new Map();
  for (const n of shown) for (const r of load(n)) byId.set(r.id, r);
  const all = [...byId.values()].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
  const open = all.filter((r) => r.status === "open");
  const c = counts(open);
  const lines = [
    "# Stress ledger",
    "",
    `Written by engine/stress/ledger.mjs render at ${new Date().toISOString()}, from ${outDir()} (passes ${shown.join(", ") || "none"}). Do not edit by hand.`,
    "",
    `Open: critical ${c.critical}, high ${c.high}, medium ${c.medium}, low ${c.low}. All findings: ${all.length}.`,
    "",
    "| id | severity | area | title | repro | fix | status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...all.map((r) => `| ${cell(r.id)} | ${cell(r.severity)} | ${cell(r.area)} | ${cell(r.title)} | \`${cell(r.repro)}\` | ${cell(r.fix)} | ${cell(r.status)}${r.batch ? ` (${r.batch})` : ""}${r.risky ? " risky" : ""}${r.waitsFor ? ` waits for ${r.waitsFor}` : ""} |`),
    "",
  ];
  writeMd(LEDGER_MD, lines.join("\n"));
  console.log(`ledger: ${all.length} findings written to ${LEDGER_MD}`);
}

function add(f) {
  for (const k of ["severity", "area", "title", "repro", "fix"]) if (!f[k]) usage(`add needs --${k}`);
  const known = passes();
  const pass = f.pass !== undefined ? Number(f.pass) : (known.length ? known[known.length - 1] : 1);
  const r = record({
    severity: f.severity, area: f.area, title: f.title, repro: f.repro, fix: f.fix,
    check: f.check || `by hand: ${f.title}`, target: f.target || "", expected: f.expected, actual: f.actual, evidence: f.evidence,
    suspectFiles: f.suspect ? f.suspect.split(",").map((s) => s.trim()).filter(Boolean) : [],
  }, { pass });
  console.log(`ledger: added ${r.id} to pass ${pass}`);
}

function set(id, f) {
  if (!id) usage("set needs an id");
  const changes = {};
  if (f.status) changes.status = f.status;
  if (f.fix !== undefined) changes.fix = f.fix;
  if (f.batch !== undefined) changes.batch = f.batch === "none" ? null : f.batch;
  if (f.risky !== undefined) {
    if (!["true", "false"].includes(f.risky)) usage("--risky is true or false");
    changes.risky = f.risky === "true";
  }
  if (f.suspect !== undefined) changes.suspectFiles = f.suspect.split(",").map((s) => s.trim()).filter(Boolean);
  if (f.waits !== undefined) changes.waitsFor = f.waits === "none" ? null : f.waits;
  if (f.severity) changes.severity = f.severity;
  if (f.title) changes.title = f.title;
  const r = update(id, changes);
  console.log(`ledger: ${r.id} is ${r.status}${r.batch ? `, batch ${r.batch}` : ""}${r.risky ? ", risky" : ""}`);
}

function diff(a, b) {
  if (a === undefined || b === undefined) usage("diff needs two passes");
  const A = new Map(load(a).map((r) => [r.id, r]));
  const B = new Map(load(b).map((r) => [r.id, r]));
  const cleared = [];
  const kept = [];
  const added = [];
  for (const [id, r] of A) {
    const later = B.get(id);
    if (!later || later.status !== "open") cleared.push({ ...r, now: later ? later.status : "gone" });
    else kept.push(later);
  }
  for (const [id, r] of B) if (!A.has(id) && r.status === "open") added.push(r);
  const line = (r, extra = "") => `  ${r.id} ${r.severity} ${r.area}: ${r.title}${extra}`;
  console.log(`DIFF pass ${a} -> pass ${b}`);
  console.log(`cleared ${cleared.length}`);
  for (const r of cleared) console.log(line(r, ` (${r.now})`));
  console.log(`still open ${kept.length}`);
  for (const r of kept) console.log(line(r));
  console.log(`new in pass ${b} ${added.length}`);
  for (const r of added) console.log(line(r));
  const bad = [...kept, ...added].filter(atLeastMedium);
  console.log(`open of medium or higher in pass ${b}: ${bad.length}`);
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// The launch checklist from the last pass's own files; a line whose file is missing says so.
function checklist() {
  const known = passes();
  let last = known.length ? known[known.length - 1] : null;
  if (last === null) {
    let names = [];
    try { names = readdirSync(outDir()); } catch { names = []; }
    const all = names.map((n) => /^pass-(\d+)$/.exec(n)).filter(Boolean).map((m) => Number(m[1])).sort((x, y) => x - y);
    last = all.length ? all[all.length - 1] : null;
  }
  if (last === null) usage("there is no pass to write a checklist from");
  const dir = passDir(last);
  const ev = (name) => join(dir, name);
  const has = (name) => existsSync(ev(name));
  const findings = load(last);
  const c = counts(findings.filter((r) => r.status === "open"));
  const browser = readJson(ev("browser-summary.json"));
  const routes = readJson(ev("routes-summary.json"));
  const timing = readJson(ev("timing.json"));
  const recovery = readJson(ev("recovery.json"));
  const merged = readJson(join(outDir(), "merged.json"));
  const notCovered = has("not-covered.txt") ? readFileSync(ev("not-covered.txt"), "utf8").split("\n").filter(Boolean) : [];
  const soakLines = has("soak.jsonl") ? readFileSync(ev("soak.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  const forbidden = readJson(join(dir, "agents", "forbidden.json"));
  const missing = (name) => `not measured (no ${name} in pass ${last})`;
  const lines = [
    "# Stress: launch checklist",
    "",
    `Written by engine/stress/ledger.mjs checklist at ${new Date().toISOString()} from pass ${last} (${dir}). Do not edit by hand.`,
    "",
    "| What | Measured | Evidence |",
    "| --- | --- | --- |",
    `| Open findings | critical ${c.critical}, high ${c.high}, medium ${c.medium}, low ${c.low} | ${ev("findings.jsonl")} |`,
    `| Pages loaded, controls found and pressed | ${browser ? `${browser.pagesLoaded} pages; ${browser.controlsPressed ?? "?"} of ${browser.controlsFound} controls pressed` : missing("browser-summary.json")} | ${ev("browser-summary.json")} |`,
    `| Exceptions, console errors, CSP violations, failed requests | ${browser ? `${browser.exceptions ?? "?"}, ${browser.consoleErrors ?? "?"}, ${browser.cspViolations ?? "?"}, ${browser.failedRequests ?? "?"}` : missing("browser-summary.json")} | ${ev("browser-summary.json")} |`,
    `| First contentful paint and long tasks | ${timing ? `${Object.keys(timing).length} pages timed` : missing("timing.json")} | ${ev("timing.json")} |`,
    `| Routes swept, calls, 5xx, hangs | ${routes ? `${routes.routes} routes, ${routes.calls} calls, ${routes.fiveXX} 5xx, ${routes.hangs} hangs` : missing("routes-summary.json")} | ${ev("routes-summary.json")} |`,
    `| Forbidden tries refused | ${Array.isArray(forbidden) ? `${forbidden.filter((x) => x.refused === true).length} of ${forbidden.length}` : missing("agents/forbidden.json")} | ${join(dir, "agents", "forbidden.json")} |`,
    `| Soak samples | ${soakLines || missing("soak.jsonl")} | ${ev("soak.jsonl")} |`,
    `| Recovery, per part | ${recovery ? Object.entries(recovery).map(([p, r]) => `${p} ${r.noticedSec ?? "?"} s / ${r.healthySec ?? "?"} s`).join("; ") : missing("recovery.json")} | ${ev("recovery.json")} |`,
    `| Merged branches | ${merged ? Object.entries(merged).map(([k, v]) => `${k} ${v || "not merged"}`).join(", ") : "no merged.json"} | ${join(outDir(), "merged.json")} |`,
    `| Not covered | ${notCovered.length ? notCovered.map(cell).join("; ") : "nothing listed"} | ${ev("not-covered.txt")} |`,
    `| Accepted findings | ${findings.filter((r) => r.status === "accepted").map((r) => `${r.id} (${cell(r.fix)})`).join("; ") || "none"} | ${ev("findings.jsonl")} |`,
    "",
  ];
  writeMd(LAUNCH_MD, lines.join("\n"));
  console.log(`ledger: checklist of pass ${last} written to ${LAUNCH_MD}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const f = flags(rest);
try {
  if (cmd === "render") render();
  else if (cmd === "add") add(f);
  else if (cmd === "set") set(f._[0], f);
  else if (cmd === "diff") diff(f._[0], f._[1]);
  else if (cmd === "checklist") checklist();
  else usage(cmd ? `no command ${cmd}` : "");
} catch (e) {
  process.stderr.write(`ledger: ${e.message}\n`);
  process.exit(1);
}
