// The soak's measures (PLAN-STRESS T6): file sizes under the state folders that grow, the stage's temp files, each
// part's CPU seconds (from ps, so idle CPU is a true average, not ps's decaying %cpu), percentiles and a straight
// line through a series. Read only. Built-in modules only.
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// { "<path under state>": bytes } for every regular file under each folder (links are not followed).
export function fileSizes(state, folders = ["logs", "doors", "home"]) {
  const out = {};
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 8) walk(p, depth + 1);
      else if (e.isFile()) {
        try { out[relative(state, p)] = lstatSync(p).size; } catch { /* went away */ }
      }
    }
  };
  for (const f of folders) walk(join(state, f), 0);
  return out;
}

// How many files are under the stage's temp folders (each child's TMPDIR, and Chrome's work folders there).
export function tempFiles(root) {
  let n = 0;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth < 10) walk(join(dir, e.name), depth + 1);
      else n += 1;
    }
  };
  walk(join(root, "tmp"), 0);
  return n;
}

// ps's cumulative CPU time "[[dd-]hh:]mm:ss.ss" -> seconds.
export function cpuSeconds(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  let days = 0;
  let rest = t;
  const d = /^(\d+)-(.*)$/.exec(t);
  if (d) { days = Number(d[1]); rest = d[2]; }
  const parts = rest.split(":").map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return null;
  let s = 0;
  for (const x of parts) s = s * 60 + x;
  return days * 86400 + s;
}

// { pid: cpu seconds } for the given process ids (ones that ended are left out).
export function cpuOf(pids) {
  const list = [...new Set(pids.filter((p) => Number.isInteger(p)))];
  if (!list.length) return {};
  let text = "";
  try {
    text = execFileSync("/bin/ps", ["-o", "pid=,time=", "-p", list.join(",")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    text = (e && e.stdout) || "";
  }
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (m) out[Number(m[1])] = cpuSeconds(m[2]);
  }
  return out;
}

export function percentile(values, q) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1));
  return v[i];
}

// A straight line through [[x, y]...]: { slope, r } (r the correlation; null with fewer than 3 points).
export function line(points) {
  const p = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (p.length < 3) return { slope: null, r: null };
  const n = p.length;
  const mx = p.reduce((s, [x]) => s + x, 0) / n;
  const my = p.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0) return { slope: null, r: null };
  return { slope: sxy / sxx, r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy) };
}
