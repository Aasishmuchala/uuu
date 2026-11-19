// The sweeps' one entry (PLAN-STRESS, pinned interfaces):
//   $N engine/stress/run.mjs <browser|routes|doors|agents|soak|recovery|all> [--pass <n>] [--quick] [--only <id>]
//                            [--base <n>] [--minutes <n>]
// Loads engine/stress/<sweep>/index.mjs (default export `async (ctx) => {}`), with
//   ctx = { pass, quick, only, base, minutes, out, record, startStage, openBrowser, log, check, sweep }
// `all` runs browser, routes, doors, agents, recovery, soak in that order, each in its own stages, one at a time.
// Exit 0 when the sweep recorded no finding of medium or higher, 1 when it did, 2 when the harness itself failed
// (a sweep not built yet, or one that threw). The last line is always
//   SWEEP <name>: checks <n>, findings critical <a> high <b> medium <c> low <d>
// (or `SWEEP <name>: not built`). --pass defaults to 0, the scratch pass; pass runs (T8, T12) name theirs.
// Every stage and Chrome a sweep opens through ctx is closed when the sweep ends, even when it throws.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openBrowser } from "./lib/cdp.mjs";
import { findingId, outDir, passDir, record as ledgerRecord } from "./lib/ledger.mjs";
import { checkBase, startStage } from "./lib/stage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SWEEPS = Object.freeze(["browser", "routes", "doors", "agents", "recovery", "soak"]);
const ALL_ORDER = ["browser", "routes", "doors", "agents", "recovery", "soak"];

function usage(msg) {
  if (msg) process.stderr.write(`run: ${msg}\n`);
  process.stderr.write("usage: run.mjs <browser|routes|doors|agents|soak|recovery|all> [--pass <n>] [--quick] [--only <id>] [--base <n>] [--minutes <n>]\n");
  process.exit(2);
}

function parse(argv) {
  const [name, ...rest] = argv;
  if (!name || (!SWEEPS.includes(name) && name !== "all")) usage(name ? `no sweep ${name}` : "");
  const o = { name, pass: 0, quick: false, only: null, base: null, minutes: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[++i]; if (v === undefined) usage(`${a} needs a value`); return v; };
    if (a === "--quick") o.quick = true;
    else if (a === "--pass") { o.pass = Number(val()); if (!Number.isInteger(o.pass) || o.pass < 0) usage("--pass is a whole number"); }
    else if (a === "--only") o.only = val();
    else if (a === "--base") o.base = Number(val());
    else if (a === "--minutes") { o.minutes = Number(val()); if (!Number.isFinite(o.minutes) || o.minutes <= 0) usage("--minutes is a number"); }
    else usage(`unknown option ${a}`);
  }
  try {
    o.base = checkBase(o.base ?? (process.env.STRESS_PORT_BASE || 4300));
  } catch (e) {
    usage(e.message);
  }
  return o;
}

const line = (name, checks, c) => `SWEEP ${name}: checks ${checks}, findings critical ${c.critical} high ${c.high} medium ${c.medium} low ${c.low}`;

async function runOne(name, o) {
  const file = join(HERE, name, "index.mjs");
  if (!existsSync(file)) {
    console.log(`SWEEP ${name}: not built`);
    return { code: 2, checks: 0, counts: { critical: 0, high: 0, medium: 0, low: 0 } };
  }
  const out = outDir();
  mkdirSync(passDir(o.pass, out), { recursive: true });
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const seen = new Set();
  let checks = 0;
  const stages = new Set();
  const browsers = new Set();
  const log = (...a) => console.log(`${new Date().toISOString()} ${name}:`, ...a);
  const ctx = {
    sweep: name, pass: o.pass, quick: o.quick, only: o.only, base: o.base, minutes: o.minutes, out,
    passDir: passDir(o.pass, out),
    log,
    check(n = 1) { checks += n; },
    // A finding through the ledger; its repro is this sweep's --only run unless the sweep names another.
    record(finding) {
      const id = finding.id || findingId(String(finding.area || ""), String(finding.check || ""), String(finding.target ?? ""));
      const r = ledgerRecord({ ...finding, id, repro: finding.repro || `$N engine/stress/run.mjs ${name} --only ${id}` }, { pass: o.pass, out });
      if (!seen.has(r.id)) { seen.add(r.id); counts[r.severity] += 1; }
      return r;
    },
    async startStage(opts = {}) {
      const st = await startStage({ base: o.base, label: name, ...opts });
      stages.add(st);
      const close = st.close.bind(st);
      st.close = async () => { stages.delete(st); return close(); };
      return st;
    },
    async openBrowser(opts = {}) {
      const b = await openBrowser(opts);
      browsers.add(b);
      const close = b.close.bind(b);
      b.close = async () => { browsers.delete(b); return close(); };
      return b;
    },
  };
  let code = 0;
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.default !== "function") throw new Error(`${name}/index.mjs has no default export`);
    const res = await mod.default(ctx);
    if (res && Number.isInteger(res.checks)) checks += res.checks;
  } catch (e) {
    console.log(`${new Date().toISOString()} ${name}: the harness failed: ${e && e.stack ? e.stack : e}`);
    code = 2;
  } finally {
    for (const b of [...browsers]) await b.close().catch(() => {});
    for (const st of [...stages]) {
      const r = await st.close().catch(() => ({ leftovers: [] }));
      if (r && r.leftovers && r.leftovers.length) {
        console.log(`${new Date().toISOString()} ${name}: processes left by the stage: ${JSON.stringify(r.leftovers)}`);
        code = 2;
      }
    }
  }
  if (code === 0 && (counts.critical || counts.high || counts.medium)) code = 1;
  console.log(line(name, checks, counts));
  return { code, checks, counts };
}

async function main() {
  const o = parse(process.argv.slice(2));
  // Keep the Mac awake while this runs; caffeinate ends by itself when this process does.
  try {
    const c = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { detached: true, stdio: "ignore" });
    c.on("error", () => {});
    c.unref();
  } catch { /* no keep-awake; the run still goes on */ }
  const stop = (sig) => { console.log(`run: stopped by ${sig}`); process.exit(2); };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  if (o.name !== "all") {
    const r = await runOne(o.name, o);
    process.exit(r.code);
  }
  let worst = 0;
  let checks = 0;
  const total = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const name of ALL_ORDER) {
    const r = await runOne(name, o);
    checks += r.checks;
    for (const k of Object.keys(total)) total[k] += r.counts[k];
    worst = Math.max(worst, r.code);
  }
  if (worst < 2 && [total].some((t) => t.critical || t.high || t.medium)) worst = 1;
  console.log(line("all", checks, total));
  process.exit(worst);
}

await main();
