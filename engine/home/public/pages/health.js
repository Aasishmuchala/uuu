// Health: is each part on, does the fence hold, what is not connected yet, and free disk.
// The only page where technical names appear, and only behind "Show technical details".
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen } from "../lib/format.js";
import { Button, ErrorNotice, Group, Loading, Mono, PageHeader, Row, Rows, St } from "../kit/index.js";

const cap = (v, n = 300) => (v === null || v === undefined ? "" : String(v)).slice(0, n);

// What the jobs that cannot start are waiting for (the tools and the speech model), from GET /api/jobs.
// One entry per reason: { text, step, count, titles }. Reasons that point to a file in Files are left out:
// those are filled in on the Files page, not here. Pure, so it is tested without a page.
export function waitingFor(jobs) {
  const out = new Map();
  const depts = jobs && Array.isArray(jobs.departments) ? jobs.departments : [];
  for (const d of depts) {
    for (const c of (d && Array.isArray(d.clusters) ? d.clusters : [])) {
      for (const j of (c && Array.isArray(c.jobs) ? c.jobs : [])) {
        if (!j || typeof j !== "object" || j.ready !== false || !j.why) continue;
        const why = typeof j.why === "string" ? { text: j.why } : j.why;
        const text = cap(why && why.text, 200);
        if (!text || /^Fill in /.test(text)) continue;
        if (why.link && why.link.page && why.link.page !== "health") continue;
        const name = cap(why.name, 40);
        let e = out.get(text);
        if (!e) {
          e = { text, step: name === "books" ? "Run: engine start" : "Run: engine setup", count: 0, titles: [] };
          out.set(text, e);
        }
        e.count += 1;
        if (e.titles.length < 5 && j.title) e.titles.push(cap(j.title, 80));
      }
    }
  }
  return [...out.values()];
}

// One plain sentence for a job file that could not be read.
export function problemLine(p) {
  if (typeof p === "string") return `${cap(p, 300)} Fix the file, then look here again.`;
  const file = cap(p && p.file, 120);
  const what = cap(p && (p.problem || p.text), 300);
  return `${file ? `The job file ${file} was left out` : "A job file was left out"}${what ? `: ${what}` : "."}${what && !/[.!?]$/.test(what) ? "." : ""} Fix the file, then look here again.`;
}

const PART = {
  on: { tone: "good", word: "On" },
  off: { tone: "bad", word: "Off" },
  unhealthy: { tone: "warn", word: "Not working properly" },
  not_installed: { tone: "neutral", word: "Not installed" },
};

// The words the page adds to the engine's own (the group names, the overall state, the copy button).
export const WORDS = {
  groups: { engine: "The engine", gate: "The gate and the fence", books: "The books", doors: "The doors", apps: "App Studio" },
  overall: { good: "Everything is on", warn: "Something is not set up", bad: "Something is not working" },
  copy: "Copy", copied: "Copied", copyLabel: "Copy the command",
};

// Which group a part sits in, and its icon tile. An unknown part goes with the engine.
const PART_AT = {
  home: ["engine", "home"], board: ["engine", "tasks"], relay: ["engine", "chip"], playbooks: ["engine", "docs"],
  gate: ["gate", "key"],
  books: ["books", "book"],
  web: ["doors", "globe"], generate: ["doors", "brush"], viewer: ["doors", "eye"],
  apps: ["apps", "apps"],
};
export const partAt = (id) => PART_AT[id] || ["engine", "settings"];

const proofHolds = (p) => !(p.failed > 0 || (p.result && p.result !== "holds"));

// The overall state, in one St: the worst thing among the parts and the fence. Pure.
export function overall(d) {
  const parts = d && Array.isArray(d.parts) ? d.parts : [];
  const p = d && d.fence && d.fence.lastProof;
  if (parts.some((x) => x && (x.state === "off" || x.state === "unhealthy")) || (p && !proofHolds(p))) return { tone: "bad", text: WORDS.overall.bad };
  if (parts.some((x) => x && x.state === "not_installed") || !p) return { tone: "warn", text: WORDS.overall.warn };
  return { tone: "good", text: WORDS.overall.good };
}

// A sentence that ends "Run: <command>" is shown as the words, then the command in the mono face with a copy button.
function Command({ text }) {
  const [done, setDone] = useState(false);
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(String(text ?? ""));
  if (!m) return html`${text}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(m[2]);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* the command stays on the screen to copy by hand */ }
  }
  return html`${m[1]}
    <span class="p-health__cmd">
      <code class="p-health__code">${m[2]}</code>
      <${Button} variant="quiet" size="sm" icon=${done ? "check" : "docs"} aria-label=${WORDS.copyLabel} onClick=${copy}>${done ? WORDS.copied : WORDS.copy}<//>
    </span>`;
}

const Say = ({ text, tech }) => html`<${Command} text=${text} />${tech ? html`<span class="p-health__tech"><${Mono}>${tech}<//></span>` : null}`;

// One line about the last proof: when it ran and how it came out. Plain words.
export function proofLine(lastProof) {
  if (!lastProof || typeof lastProof !== "object") return "The proof has not been run on this Mac yet.";
  const failed = Number(lastProof.failed) || 0;
  const passed = Number(lastProof.passed) || 0;
  const result = failed > 0 || (lastProof.result && lastProof.result !== "holds") ? "The fence did not hold" : "The fence held";
  const when = lastProof.ranAt ? ` when it was last checked on ${fullWhen(lastProof.ranAt)}` : "";
  const sum = `${passed} ${passed === 1 ? "check" : "checks"} passed` + (failed ? `, ${failed} failed` : "");
  return `${result}${when}: ${sum}.`;
}

// Free disk against the floor, in words.
export function diskLine(disk) {
  if (!disk || disk.freeGb == null) return "Free space on this Mac is not known.";
  const floor = disk.floorGb == null ? "" : ` The engine keeps at least ${disk.floorGb} GB free.`;
  return `${disk.freeGb} GB free.${floor}`;
}

function FenceRow({ fence, technical, onRun, running, runError }) {
  const p = fence && fence.lastProof;
  const bad = p && !proofHolds(p);
  const state = running ? { tone: "neutral", text: "Running" }
    : p ? { tone: bad ? "bad" : "good", text: bad ? "Did not hold" : "Held" }
      : { tone: "neutral", text: "Not checked yet" };
  const lines = technical && p && Array.isArray(p.lines) ? p.lines.slice(0, 50) : [];
  return html`<${Row} icon="lock" title="The fence" state=${state}
    say=${html`${fence && fence.sentence} ${proofLine(p)}
      ${lines.map((l, i) => html`<span key=${i} class="p-health__tech"><${Mono}>${String(l.status)}<//> ${String(l.text)}</span>`)}
      ${running ? html`<span role="status" class="p-health__status">The proof is running.</span>` : null}`}
    control=${html`<${Button} onClick=${onRun} busy=${running} disabled=${running}>Run the proof now<//>`}
    warned=${runError ? html`<${ErrorNotice} error=${runError} />` : bad ? proofLine(p) : null} />`;
}

export default function Page() {
  const { announce } = useApp();
  const [technical, setTechnical] = useState(false);
  const [started, setStarted] = useState(false);
  const [runError, setRunError] = useState(null);
  const res = useResource("/api/health", { every: 10000 });
  const d = res.data;
  const jobsRes = useResource("/api/jobs", { every: 10000 });
  const waiting = waitingFor(jobsRes.data);
  const problems = jobsRes.data && Array.isArray(jobsRes.data.problems) ? jobsRes.data.problems.slice(0, 20) : [];

  async function runProof() {
    setRunError(null);
    setStarted(true);
    try {
      await api.post("/api/health/prove", {});
      announce("The proof has started.");
      res.refresh();
    } catch (err) {
      setStarted(false);
      setRunError(err);
    }
  }

  // Once the answer's proof is newer than the one we started from, the run is over.
  const running = started && !(d && d.fence && d.fence.running === false);
  const lead = "Whether the engine is on, whether the fence holds, and what is not connected yet.";

  if (!d) {
    return html`
      <div class="p-health">
        <${PageHeader} title="Health" lead=${lead} />
        ${res.loading ? html`<${Loading} lines=${5} label="Checking the engine" />` : null}
        ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      </div>`;
  }

  const all = overall(d);
  const at = { engine: [], gate: [], books: [], doors: [], apps: [] };
  for (const p of d.parts || []) at[partAt(p.id)[0]].push(p);
  const partRow = (p) => {
    const s = PART[p.state] || PART.unhealthy;
    return html`<${Row} key=${p.id} icon=${partAt(p.id)[1]} title=${p.name} state=${{ tone: s.tone, text: s.word }}
      say=${html`<${Say} text=${p.sentence} tech=${technical ? p.technical : null} />`} />`;
  };
  const groupOf = (id, extra) => at[id].length || extra
    ? html`<${Group} title=${WORDS.groups[id]}><${Rows}>${at[id].map(partRow)}${extra}<//><//>` : null;

  return html`
    <div class="p-health">
      <${PageHeader} title="Health" lead=${lead}
        actions=${html`<${Button} variant="quiet" onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`}>
        <${St} tone=${all.tone}>${all.text}<//>
      <//>

      ${groupOf("engine")}
      ${groupOf("gate", html`<${FenceRow} fence=${d.fence} technical=${technical} onRun=${runProof} running=${running} runError=${runError} />`)}
      ${groupOf("books")}
      ${groupOf("doors")}
      ${groupOf("apps")}

      <${Group} title="Jobs that are waiting" say="These jobs cannot start yet. Each one needs something on this Mac first.">
        ${jobsRes.error && !jobsRes.data ? html`<${ErrorNotice} error=${jobsRes.error} onRetry=${jobsRes.reload} />` : null}
        ${jobsRes.loading && !jobsRes.data ? html`<${Loading} lines=${2} label="Checking the jobs" />` : null}
        ${jobsRes.data && !waiting.length && !problems.length ? html`<p class="p-health__none">No job is waiting for a tool.</p>` : null}
        ${waiting.length || problems.length ? html`<${Rows}>
          ${waiting.map((w) => html`<${Row} key=${w.text} icon="clock" title=${w.text} state=${{ tone: "warn", text: "Waiting" }}
            say=${html`${w.count} ${w.count === 1 ? "job is" : "jobs are"} waiting${w.titles.length ? `: ${w.titles.join(", ")}${w.count > w.titles.length ? " and more" : ""}` : ""}. <${Command} text=${w.step} />`} />`)}
          ${problems.map((p, i) => html`<${Row} key=${`p${i}`} icon="alert" title=${problemLine(p)} state=${{ tone: "bad", text: "Left out" }} />`)}
        <//>` : null}
      <//>

      <${Group} title="Not connected yet" say="These are off on purpose. Nothing leaves the company until you connect it.">
        <${Rows}>
          ${(d.notConnected || []).map((n) => html`<${Row} key=${n.id} icon="link" title=${n.label} state=${{ tone: "neutral", text: "Not connected yet" }}
            say=${html`${n.explain} <${Command} text=${n.how} />`} />`)}
        <//>
      <//>

      <${Group} title="Disk">
        <${Rows}>
          <${Row} icon="folder" title=${diskLine(d.disk)} state=${d.disk && d.disk.ok ? { tone: "good", text: "Enough room" } : { tone: "warn", text: "Nearly full" }} />
        <//>
      <//>

      ${technical && d.modulesFailed && d.modulesFailed.length ? html`
        <${Group} title="Parts of the home screen that did not load">
          <ul class="p-health__techlist">${d.modulesFailed.slice(0, 50).map((m, i) => html`<li key=${i}>${typeof m === "string" ? m : JSON.stringify(m)}</li>`)}</ul>
        <//>` : null}
    </div>`;
}
