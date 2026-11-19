// Findings as machine records (PLAN-STRESS, pinned interfaces): one JSON line each in OUT/pass-<n>/findings.jsonl,
// with a stable id, so a later pass is a diff of an earlier one.
//   id = "S-" + area + "-" + sha1(area|check|target).slice(0, 8)
//   record(finding, { pass, out }) -> the stored record (a second record of the same id in a pass replaces the first)
//   load(pass, { out }) -> [record]
//   update(id, changes, { out }) -> the changed record, in the latest pass holding the id
// OUT is env STRESS_OUT, else /Users/aasish/uuu/.router/evidence/stress. Built-in modules only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_OUT = "/Users/aasish/uuu/.router/evidence/stress";
export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);
export const STATUSES = Object.freeze(["open", "fixed", "accepted"]);
export const BATCHES = Object.freeze([null, "A", "B"]);
export const WAITS = Object.freeze([null, "apps", "mac", "desktop"]);
const AREA_RE = /^[a-z][a-z0-9-]{0,31}$/;

export const outDir = (out) => out || process.env.STRESS_OUT || DEFAULT_OUT;
export const passDir = (pass, out) => join(outDir(out), `pass-${pass}`);
const fileOf = (pass, out) => join(passDir(pass, out), "findings.jsonl");

export function findingId(area, check, target) {
  return `S-${area}-${createHash("sha1").update(`${area}|${check}|${target}`).digest("hex").slice(0, 8)}`;
}

// The record in its pinned shape, with every field checked.
export function normalize(f, pass) {
  if (!f || typeof f !== "object") throw new Error("ledger: a finding is an object");
  const area = String(f.area || "");
  if (!AREA_RE.test(area)) throw new Error(`ledger: area ${area} is not a short lower-case word`);
  if (!SEVERITIES.includes(f.severity)) throw new Error(`ledger: severity ${f.severity} is not one of ${SEVERITIES.join(", ")}`);
  const check = String(f.check || "");
  const target = String(f.target ?? "");
  if (!check) throw new Error("ledger: a finding needs its check");
  const status = f.status || "open";
  if (!STATUSES.includes(status)) throw new Error(`ledger: status ${status} is not one of ${STATUSES.join(", ")}`);
  const batch = f.batch ?? null;
  if (!BATCHES.includes(batch)) throw new Error(`ledger: batch ${batch} is not A, B or none`);
  const waitsFor = f.waitsFor ?? null;
  if (!WAITS.includes(waitsFor)) throw new Error(`ledger: waitsFor ${waitsFor} is not apps, mac, desktop or none`);
  const id = f.id || findingId(area, check, target);
  return {
    id, pass: Number(pass), severity: f.severity, area, check, target, title: String(f.title || check),
    repro: String(f.repro || ""), expected: String(f.expected ?? ""), actual: String(f.actual ?? ""), evidence: String(f.evidence || ""),
    suspectFiles: Array.isArray(f.suspectFiles) ? f.suspectFiles.map(String) : [], fix: String(f.fix || ""),
    status, batch, risky: f.risky === true, waitsFor,
  };
}

export function load(pass, { out } = {}) {
  const file = fileOf(pass, out);
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && r.id) byId.set(r.id, r);
  }
  return [...byId.values()];
}

function save(pass, records, out) {
  const dir = passDir(pass, out);
  mkdirSync(dir, { recursive: true });
  const file = fileOf(pass, out);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  renameSync(tmp, file);
}

export function record(finding, { pass, out } = {}) {
  const p = pass ?? finding.pass;
  if (p === undefined || p === null || !Number.isInteger(Number(p))) throw new Error("ledger: a finding needs its pass");
  const r = normalize(finding, p);
  const all = load(p, { out });
  const at = all.findIndex((x) => x.id === r.id);
  if (at === -1) all.push(r);
  else all[at] = { ...all[at], ...r };
  save(p, all, out);
  return r;
}

// The passes that have a findings file, in order.
export function passes({ out } = {}) {
  let names = [];
  try { names = readdirSync(outDir(out)); } catch { names = []; }
  return names.map((n) => /^pass-(\d+)$/.exec(n)).filter(Boolean).map((m) => Number(m[1]))
    .filter((n) => existsSync(fileOf(n, out))).sort((a, b) => a - b);
}

export function update(id, changes, { out } = {}) {
  for (const p of passes({ out }).reverse()) {
    const all = load(p, { out });
    const at = all.findIndex((x) => x.id === id);
    if (at === -1) continue;
    const next = normalize({ ...all[at], ...changes, id }, p);
    all[at] = next;
    save(p, all, out);
    return next;
  }
  throw new Error(`ledger: no finding ${id}`);
}

// Every finding, each as its latest pass has it.
export function latest({ out } = {}) {
  const byId = new Map();
  for (const p of passes({ out })) for (const r of load(p, { out })) byId.set(r.id, r);
  return [...byId.values()];
}

export const atLeastMedium = (r) => ["critical", "high", "medium"].includes(r.severity);
