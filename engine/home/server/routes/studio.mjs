// Studio page (CONTRACTS 9.6): the Drafter's CAD parts and other design files, found where the agent
// wrote them: tasks/company-work/<goal>/cad/<name>.json with <name>.step beside it, and
// tasks/company-work/<goal>/studio/*. This route only lists files and hands out download links
// (served by routes/files.mjs). It never runs anything an agent wrote: the export runs inside the fence.
//
// Everything in those folders is written by agents, so it is untrusted: names are checked and shown as
// text, links are never followed (no folder or file that is a link is listed, and real paths must stay
// inside the project folder), JSON is read only up to a size cap with O_NOFOLLOW, and only its numbers
// are used.
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { descendants, loadIssues, plainState } from "../lib/goals.mjs";

const MAX_GOALS = 1000;
const MAX_ROWS = 200;
const MAX_JSON = 64 * 1024;
const GOAL = /^[A-Za-z0-9_-]{1,64}$/;
const PART = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const FILE_NAME = /^[^\p{C}/\\]{1,120}$/u;   // no control, format (bidi) or unassigned characters
const AGENT_STATES = {
  free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval",
};

const token = (rel) => Buffer.from(rel, "utf8").toString("base64url");
const plainNumber = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateText(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

// lstat that never follows a link; null when missing.
function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

// A folder of the project that is a real folder (not a link) and whose real path stays inside root.
function safeFolder(root, p) {
  const st = lstatOrNull(p);
  if (!st || !st.isDirectory()) return false;
  try {
    const real = realpathSync(p);
    return real.startsWith(root + sep);
  } catch {
    return false;
  }
}

function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// Reads a small JSON file without following a link; null on anything odd.
function readSmallJson(p) {
  let fd;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_JSON) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    const data = JSON.parse(buf.subarray(0, got).toString("utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const measure = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : null);

function cadRow(goal, dir, name) {
  const step = lstatOrNull(join(dir, `${name}.step`));
  if (!step || !step.isFile()) return null;        // a JSON without its STEP file is left out
  const rec = readSmallJson(join(dir, `${name}.json`));
  if (!rec || !rec.bbox || typeof rec.bbox !== "object") return null;
  const [x, y, z, volume] = [measure(rec.bbox.x), measure(rec.bbox.y), measure(rec.bbox.z), measure(rec.volume_mm3)];
  if (x === null || y === null || z === null || volume === null) return null;
  return {
    name,
    size: `${plainNumber(x)} × ${plainNumber(y)} × ${plainNumber(z)} mm`,
    volume: `${plainNumber(volume)} mm³`,
    goal,
    file: `${name}.step`,
    fileUrl: `/api/files/${token(`${goal}/cad/${name}.step`)}`,
    fileSize: sizeText(step.size),
    changed: dateText(step.mtimeMs),
    at: step.mtimeMs,
  };
}

function fileRow(goal, dir, name) {
  if (name.startsWith(".") || !FILE_NAME.test(name)) return null;
  const st = lstatOrNull(join(dir, name));
  if (!st || !st.isFile()) return null;
  return {
    name, goal, size: sizeText(st.size), changed: dateText(st.mtimeMs), file: name,
    fileUrl: `/api/files/${token(`${goal}/studio/${name}`)}`, at: st.mtimeMs,
  };
}

// All parts and files under the project folder, newest first, at most MAX_ROWS of each.
export function scanStudio(projectFolder) {
  const cad = [];
  const files = [];
  let root;
  try { root = realpathSync(projectFolder); } catch { return { cad, files }; }
  let goals = 0;
  for (const g of entries(root)) {
    if (!g.isDirectory() || !GOAL.test(g.name)) continue;   // a link is not a directory entry here
    if (++goals > MAX_GOALS) break;
    const goalDir = join(root, g.name);
    if (!safeFolder(root, goalDir)) continue;
    const cadDir = join(goalDir, "cad");
    if (safeFolder(root, cadDir)) {
      for (const e of entries(cadDir)) {
        if (cad.length >= MAX_ROWS * 5) break;
        if (!e.isFile() || !e.name.endsWith(".json")) continue;
        const name = e.name.slice(0, -5);
        if (!PART.test(name)) continue;
        const row = cadRow(g.name, cadDir, name);
        if (row) cad.push(row);
      }
    }
    const studioDir = join(goalDir, "studio");
    if (safeFolder(root, studioDir)) {
      for (const e of entries(studioDir)) {
        if (files.length >= MAX_ROWS * 5) break;
        if (!e.isFile()) continue;
        const row = fileRow(g.name, studioDir, e.name);
        if (row) files.push(row);
      }
    }
  }
  const newest = (a, b) => b.at - a.at || a.name.localeCompare(b.name);
  const strip = ({ at, ...row }) => row;
  return { cad: cad.sort(newest).slice(0, MAX_ROWS).map(strip), files: files.sort(newest).slice(0, MAX_ROWS).map(strip) };
}

// The Drafter's state and the goals it has open steps on. Unknown (board off, no ids) -> agent null.
async function agentAndWork(ctx) {
  const empty = { agent: null, inFlight: [] };
  try {
    const ids = ctx.ids();
    const drafterId = ids?.agents?.drafter;
    if (!ids?.companyId || !drafterId) return empty;
    const base = `/api/companies/${encodeURIComponent(ids.companyId)}`;
    const [agents, live, issues] = await Promise.all([
      ctx.board.get(`${base}/agents`),
      ctx.board.get(`${base}/live-runs`).catch(() => []),
      loadIssues(ctx, ids.companyId).catch(() => []),
    ]);
    const a = (Array.isArray(agents) ? agents : []).find((x) => x?.id === drafterId);
    if (!a) return empty;
    let state = "free";
    if (a.status === "pending_approval") state = "waiting_for_you";
    else if (a.status === "error") state = "problem";
    else if (a.status === "paused") state = "paused";
    else if ((Array.isArray(live) ? live : []).some((r) => r?.agentId === drafterId) || a.status === "running") state = "working";
    const open = (i) => i.status !== "done" && i.status !== "cancelled";
    const inFlight = [];
    if (ids.projectId) {
      for (const g of issues.filter((i) => !i.parentId && i.projectId === ids.projectId && open(i))) {
        const mine = (s) => s.assigneeAgentId === drafterId && open(s);
        if (mine(g) || descendants(issues, g.id).some(mine)) {
          inFlight.push({ goalId: g.id, identifier: g.identifier, title: g.title, plainState: plainState(g.status).plainState });
        }
      }
    }
    return { agent: { name: a.name || "Drafter", state, plainState: AGENT_STATES[state] }, inFlight };
  } catch (e) {
    if (e instanceof HomeError) return empty;
    throw e;
  }
}

export default function register(app) {
  app.get("/api/departments/studio", async (ctx) => {
    const installed = existsSync(ctx.config.paths.cadPython);
    const { cad, files } = scanStudio(ctx.config.paths.projectFolder);
    const { agent, inFlight } = await agentAndWork(ctx);
    return {
      id: "studio",
      title: "Studio",
      connected: installed,
      notConnected: installed ? null : {
        reason: "The Drafter's tools are not installed yet.",
        next: "Run: engine/cad/install.sh",
      },
      agent,
      figures: [
        { id: "files", label: "Files", value: String(files.length), hint: "Sketches and notes for you" },
        { id: "cad", label: "CAD parts", value: String(cad.length), hint: "STEP files with measured sizes" },
      ],
      sections: [
        {
          id: "cad", title: "CAD parts", emptyText: "No parts yet. Give the Drafter a goal to get one.",
          columns: [
            { key: "name", label: "Part" }, { key: "size", label: "Size" }, { key: "volume", label: "Volume" },
            { key: "goal", label: "Goal" }, { key: "file", label: "File" },
          ],
          rows: cad,
        },
        {
          id: "files", title: "Other files", emptyText: "No other files yet.",
          columns: [
            { key: "name", label: "Name" }, { key: "goal", label: "Goal" }, { key: "size", label: "Size" },
            { key: "changed", label: "Changed" }, { key: "file", label: "File" },
          ],
          rows: files,
        },
      ],
      inFlight,
      switches: [{
        id: "renderer", label: "Show parts in 3D", on: false,
        explain: "No renderer is connected. Files open in your own CAD program.",
      }],
    };
  });
}
