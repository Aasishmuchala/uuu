// Direct checks of each part, for GET /api/health and GET /api/state.
// Sentences are for the owner; tool names, ports and addresses go only in `technical`.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { httpRequest, parseJson } from "./httpclient.mjs";

const TIMEOUT = 2000;

async function probe(url) {
  if (!url) return { offline: true };
  try {
    const res = await httpRequest(url, { timeoutMs: TIMEOUT, headers: { accept: "application/json" } });
    return { status: res.status, json: parseJson(res.text) };
  } catch {
    return { offline: true };
  }
}

export async function boardState(env) {
  const r = await probe(env.urls.board && `${env.urls.board}/api/health`);
  const technical = `paperclip on ${env.urls.board || "(none)"}`;
  if (r.offline) return { id: "board", name: "Board", state: "off", sentence: "The board is off, so agents are not working. Run: engine start", technical };
  if (r.status === 200 && r.json?.status === "ok") return { id: "board", name: "Board", state: "on", sentence: "The board is on. Agents can take work.", technical };
  return { id: "board", name: "Board", state: "unhealthy", sentence: "The board answers but says something is wrong. Restart the engine: engine stop, then engine start.", technical: `${technical}; /api/health answered ${r.status}` };
}

export async function gateState(env) {
  const r = await probe(env.urls.gate && `${env.urls.gate}/gate/health`);
  const technical = `gate on ${env.urls.gate || "(none in stubs mode)"}, forwarding to the board`;
  if (r.offline) return { id: "gate", name: "Gate", state: "off", sentence: "The gate is off, so agents cannot reach the board. Run: engine start", technical };
  if (r.status === 200) return { id: "gate", name: "Gate", state: "on", sentence: "The gate is on. Agents reach the board only through it, with their own limited rights.", technical };
  return { id: "gate", name: "Gate", state: "unhealthy", sentence: "The gate answers but its check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; /gate/health answered ${r.status}` };
}

export async function booksState(env) {
  const technical = `Frappe bench (ERPNext, India Compliance, CRM, Helpdesk, HRMS) on ${env.urls.bench}, site ${env.config.bench.site}, MariaDB on port ${env.config.ports.benchDb}`;
  if (!env.bench.installed()) return { id: "books", name: "Books", state: "not_installed", sentence: "The books are not installed on this Mac yet.", technical };
  const r = await probe(`${env.urls.bench}/api/method/ping`);
  if (r.offline) return { id: "books", name: "Books", state: "off", sentence: "The books are off. Run: engine start", technical };
  if (r.status === 200 && r.json?.message === "pong") return { id: "books", name: "Books", state: "on", sentence: "The books are on.", technical };
  return { id: "books", name: "Books", state: "unhealthy", sentence: "The books answer but their check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; ping answered ${r.status}` };
}

export function homeState(env) {
  return { id: "home", name: "Home screen", state: "on", sentence: "The home screen is on.", technical: `home server on 127.0.0.1:${env.port()}` };
}

export function readProof(file) {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

export function proofSentence(p) {
  if (!p) return "The fence has not been checked yet. Run the proof to check it.";
  if (p.result === "holds") return "The fence held at its last check.";
  if (p.result === "holds-with-todo") return "The fence held at its last check, with something still for you to do.";
  return "The fence failed its last check. Do not give agents work until it holds again.";
}

const CONNECT = "Connect an account to turn this on.";
const FIXED_NOT_CONNECTED = [
  { id: "codex_login", label: "The Checker's own login", explain: "The Checker uses your own Codex login for now. It should have one of its own.", how: "Run: engine/fence/login-wizard.sh codex" },
  { id: "board_login", label: "A sign-in for the board", explain: "Other programs on this Mac can reach the board as you. A sign-in would stop that.", how: "Not built yet. It will be a one-time step for you." },
  { id: "publishing", label: "Publishing posts", explain: "Approved posts and newsletters stay here. Nothing is posted.", how: CONNECT },
  { id: "email", label: "Email", explain: "Agents draft replies. Nothing is emailed to anyone.", how: CONNECT },
  { id: "whatsapp", label: "WhatsApp", explain: "No message goes to customers on WhatsApp.", how: CONNECT },
  { id: "gst_portal", label: "The GST portal", explain: "E-invoices and e-way bills are not sent to the portal.", how: CONNECT },
  { id: "renderer", label: "Pictures of CAD parts", explain: "Parts come as files with their sizes. No pictures are made.", how: "Not connected. It is added only if a free one fits this Mac." },
];
const APP_NAMES = {
  erpnext: "Books", india_compliance: "Indian GST", crm: "Customers", helpdesk: "Support", hrms: "People", telephony: "Support calls",
};

export function notConnected(skippedAppsFile) {
  const out = FIXED_NOT_CONNECTED.map((x) => ({ ...x }));
  let lines = [];
  try { lines = readFileSync(skippedAppsFile, "utf8").split("\n"); } catch { lines = []; }
  const seen = new Set();
  for (const line of lines) {
    const app = line.trim().split(/[\s:,]+/)[0];
    if (!app || app.startsWith("#") || !/^[a-z0-9_]+$/i.test(app) || seen.has(app)) continue;
    seen.add(app);
    const name = APP_NAMES[app.toLowerCase()] || "One part of the books";
    out.push({
      id: `app_${app.toLowerCase()}`, label: `${name} (not installed)`,
      explain: "This part of the books was skipped to save disk space, so its page stays empty.",
      how: "Free some disk space, then run: engine/books/install.sh",
    });
  }
  return out;
}

export function freeDisk(dir, floorGb) {
  const target = existsSync(dir) ? dir : "/";
  return new Promise((resolve) => {
    execFile("/bin/df", ["-k", target], { timeout: 5000 }, (err, stdout) => {
      const cols = !err && String(stdout).trim().split("\n").pop().trim().split(/\s+/);
      const kb = cols ? Number(cols[3]) : NaN;
      const freeGb = Number.isFinite(kb) ? Math.round((kb / 1024 / 1024) * 10) / 10 : null;
      resolve({ freeGb, floorGb, ok: freeGb === null ? false : freeGb >= floorGb });
    });
  });
}
