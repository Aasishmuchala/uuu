// Health: is each part on, does the fence hold, what is not connected yet, and free disk.
// The only page where technical names appear, and only behind "Show technical details".
// Fix round B2 (TB5a) and R5-G: the overall state a chip beside the title; a strip of 64 px count cells on top (on,
// off, not installed, the last proof: only what the answer gives), each figure with one muted line under it when the
// answer gives one (the names of those parts, the proof's date), the one raised surface; groups headed with a count
// ("2 of 4 on"), 32 px apart, flat with hairlines between rows of about 60 px (R6-G); each row a 32 px tile, its name
// with its state 8 px after it as quiet words in its tone with a dot (and the facts the answer gives), its
// sentence with the command as a 12 px mono chip that holds its own Copy, and at the row's right only its button. A
// time or a count is drawn only when the answer gives it. Commands stay exact.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, when } from "../lib/format.js";
import { Button, ErrorNotice, Lamp, Loading, Mono, RoomHeader, Tag, Tile, glimpseFor } from "../kit/index.js";

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

// The kit's lamp for a part's state, by a first-match table: running on, down red, switched off off, needing the
// owner (not installed yet) amber; anything else is off. Pure.
const LAMP_OF = [["on", "on"], ["unhealthy", "red"], ["off", "off"], ["not_installed", "amber"]];
export function lampOfPart(state) {
  for (const [s, lamp] of LAMP_OF) if (state === s) return lamp;
  return "off";
}

// The words the page adds to the engine's own (the group names, the overall state, the copy button, the tiles).
export const WORDS = {
  groups: { engine: "The engine", gate: "The gate and the fence", books: "The books", doors: "The doors", apps: "App Studio" },
  overall: { good: "Everything is on", warn: "Something is not set up", bad: "Something is not working" },
  copy: "Copy", copied: "Copied", copyLabel: "Copy the command",
  tiles: { label: "The engine at a glance", on: "On", off: "Off", unhealthy: "Not working", notInstalled: "Not installed", proof: "Last proof", notRun: "Not run yet" },
  partsOn: (on, all) => `${on} of ${all} on`,
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

// How long ago, in words, for the last proof's tile: "Just now", "12 min ago", "3 h ago", "Yesterday", "5 days ago",
// then the plain date. Empty for a missing or broken time. Pure.
export function ago(iso, now = new Date()) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 0) return when(iso, now);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.floor(mins / (24 * 60));
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return when(iso, now);
}

// The names of some parts, for the line under a count: "Board", "Gate and 5 more", "Board, Home screen" with
// `most` 2; empty when the answer names none. One name by default, so the line fits its cell whole. Pure.
export function namesLine(parts, most = 1) {
  const names = (Array.isArray(parts) ? parts : []).map((x) => cap(x && x.name, 40).trim()).filter(Boolean);
  if (!names.length) return "";
  const shown = names.slice(0, most).join(", ");
  return names.length > most ? `${shown} and ${names.length - most} more` : shown;
}

// The strip on top: how many parts are on, off, not working and not installed, and when the proof last ran. A
// count of nothing is left out, except On and Off; a tile is drawn only from what the answer gives, and so is the
// line under its figure (`foot`: the names of those parts, or the proof's date). Pure.
export function tilesOf(d, now = new Date()) {
  const parts = (d && Array.isArray(d.parts) ? d.parts : []).filter((x) => x && typeof x === "object");
  const of = (state) => parts.filter((x) => x.state === state);
  const n = (state) => of(state).length;
  const out = [];
  if (parts.length) {
    out.push({ id: "on", tone: "good", label: WORDS.tiles.on, value: String(n("on")), foot: namesLine(of("on")) });
    out.push({ id: "off", tone: "bad", label: WORDS.tiles.off, value: String(n("off")), foot: namesLine(of("off")) });
    if (n("unhealthy")) out.push({ id: "unhealthy", tone: "warn", label: WORDS.tiles.unhealthy, value: String(n("unhealthy")), foot: namesLine(of("unhealthy")) });
    if (n("not_installed")) out.push({ id: "not_installed", tone: "neutral", label: WORDS.tiles.notInstalled, value: String(n("not_installed")), foot: namesLine(of("not_installed")) });
  }
  const p = d && d.fence ? d.fence.lastProof : undefined;
  if (d && d.fence) {
    const ran = p && typeof p === "object" ? ago(p.ranAt, now) : "";
    out.push(p && typeof p === "object"
      ? { id: "proof", tone: proofHolds(p) ? "good" : "bad", label: WORDS.tiles.proof, value: ran || (proofHolds(p) ? "Held" : "Did not hold"), foot: ran ? fullWhen(p.ranAt) : "" }
      : { id: "proof", tone: "neutral", label: WORDS.tiles.proof, value: WORDS.tiles.notRun, foot: "" });
  }
  return out;
}

// A sentence that ends "Run: <command>" is shown as the words, then the command as a mono chip on the text's
// baseline that holds its own Copy (a quiet icon button with no box of its own). The command is shown exactly as sent.
function Command({ text }) {
  const { announce } = useApp() || {};
  const [done, setDone] = useState(false);
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(String(text ?? ""));
  if (!m) return html`${text}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(m[2]);
      setDone(true);
      if (typeof announce === "function") announce(WORDS.copied);
      setTimeout(() => setDone(false), 1600);
    } catch { /* the command stays on the screen to copy by hand */ }
  }
  // "Run:" stays on one line with its command, so the chip never starts a line alone.
  const before = m[1].slice(0, -"Run:".length);
  return html`${before}<span class="p-health__run">Run:${" "}<span class="p-health__cmd">
      <code class="p-health__code">${m[2]}</code>
      <${Button} variant="quiet" size="sm" icon=${done ? "check" : "copy"} aria-label=${done ? WORDS.copied : WORDS.copyLabel} title=${WORDS.copyLabel} onClick=${copy} />
    </span></span>`;
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

// The checks of the last proof, for the fence row's facts: "3 checks passed", "1 check passed, 2 failed"; empty
// when there was no proof. Pure.
export function checksLine(lastProof) {
  if (!lastProof || typeof lastProof !== "object") return "";
  const failed = Number(lastProof.failed) || 0;
  const passed = Number(lastProof.passed) || 0;
  return `${passed} ${passed === 1 ? "check" : "checks"} passed` + (failed ? `, ${failed} failed` : "");
}

// Free disk against the floor, in words.
export function diskLine(disk) {
  if (!disk || disk.freeGb == null) return "Free space on this Mac is not known.";
  const floor = disk.floorGb == null ? "" : ` The engine keeps at least ${disk.floorGb} GB free.`;
  return `${disk.freeGb} GB free.${floor}`;
}

// One row: the 32 px tile, the name with its state's chip 8 px after it and its facts, the sentence under them,
// then the row's buttons at its right. `facts` are short lines of what the answer gives (never made up); `act` the
// row's buttons.
function Line({ icon, title, say, state, facts, act, warned, tone, lamp }) {
  const list = (facts || []).filter(Boolean);
  return html`<div class=${`p-health__row${tone ? ` p-health__row--${tone}` : ""}`}>
    <span class="p-health__tile"><${Tile} icon=${icon} size=${32} /></span>
    <div class="p-health__text">
      <p class="p-health__title">${lamp ? html`<span class="p-health__lamp"><${Lamp} state=${lamp} /></span>` : null}<span class="p-health__name">${title}</span>${state || list.length ? html`<span class="p-health__meta">
        ${state ? (lamp ? html`<${Tag} tone="neutral" quiet dot=${false}>${state.text}<//>` : html`<${Tag} tone=${state.tone} quiet>${state.text}<//>`) : null}
        ${list.map((f, i) => html`<span key=${i} class="p-health__fact">${f}</span>`)}
      </span>` : null}</p>
      ${say ? html`<p class="p-health__say">${say}</p>` : null}
    </div>
    ${act ? html`<div class="p-health__act">${act}</div>` : null}
    ${warned ? html`<div class="p-health__warned">${warned}</div>` : null}
  </div>`;
}

// A group: its head (the name, and a count when it has one), a sentence under it, and its rows in one panel.
// `acts` says a row of the group has buttons (the group's class says so; the states stand by their names, so no
// column is kept for them).
function Section({ title, count, say, acts, children }) {
  return html`<section class=${`p-health__group${acts ? " p-health__group--acts" : ""}`}>
    <h2 class="p-health__head"><span>${title}</span>${count ? html`<span class="p-health__count">${count}</span>` : null}</h2>
    ${say ? html`<p class="p-health__lede">${say}</p>` : null}
    ${children}
  </section>`;
}

function FenceRow({ fence, technical, onRun, running, runError }) {
  const p = fence && fence.lastProof;
  const bad = p && !proofHolds(p);
  const state = running ? { tone: "neutral", text: "Running" }
    : p ? { tone: bad ? "bad" : "good", text: bad ? "Did not hold" : "Held" }
      : { tone: "neutral", text: "Not checked yet" };
  const lines = technical && p && Array.isArray(p.lines) ? p.lines.slice(0, 50) : [];
  return html`<${Line} icon="lock" title="The fence" state=${state} lamp=${running ? "off" : p ? (bad ? "red" : "on") : "amber"} facts=${[checksLine(p)]}
    say=${html`${fence && fence.sentence}
      ${lines.map((l, i) => html`<span key=${i} class="p-health__tech"><${Mono}>${String(l.status)}<//> ${String(l.text)}</span>`)}
      ${running ? html`<span role="status" class="p-health__status">The proof is running.</span>` : null}`}
    act=${html`<${Button} variant="ghost" size="sm" onClick=${onRun} busy=${running} disabled=${running}>Run the proof now<//>`}
    warned=${runError ? html`<${ErrorNotice} error=${runError} />` : bad ? html`<p class="p-health__bad">${proofLine(p)}</p>` : null} />`;
}

function Tiles({ tiles }) {
  if (!tiles.length) return null;
  return html`<dl class="p-health__tiles" aria-label=${WORDS.tiles.label}>
    ${tiles.map((t) => html`<div key=${t.id} class=${`p-health__tiles-cell${t.id === "proof" ? " p-health__tiles-cell--wide" : ""}`}>
      <dt class="p-health__tiles-label"><span class=${`p-health__dot p-health__dot--${t.tone}`} aria-hidden="true"></span>${t.label}</dt>
      <dd class="p-health__tiles-value">${t.value}</dd>
      ${t.foot ? html`<dd class="p-health__tiles-foot" title=${t.foot}>${t.foot}</dd>` : null}
    </div>`)}
  </dl>`;
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
  const techButton = html`<${Button} variant="quiet" size="sm" onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`;

  if (!d) {
    return html`
      <div class="p-health">
        <${RoomHeader} glimpse=${glimpseFor("health")} pull strip title="Health" lead=${lead} />
        ${res.loading ? html`<${Loading} lines=${5} label="Checking the engine" />` : null}
        ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      </div>`;
  }

  const all = overall(d);
  const at = { engine: [], gate: [], books: [], doors: [], apps: [] };
  for (const p of d.parts || []) at[partAt(p.id)[0]].push(p);
  const partRow = (p) => {
    const s = PART[p.state] || PART.unhealthy;
    return html`<${Line} key=${p.id} icon=${partAt(p.id)[1]} title=${p.name} lamp=${lampOfPart(p.state)} state=${{ tone: s.tone, text: s.word }}
      say=${html`<${Say} text=${p.sentence} tech=${technical ? p.technical : null} />`} />`;
  };
  const groupOf = (id, extra) => at[id].length || extra
    ? html`<${Section} title=${WORDS.groups[id]} count=${at[id].length ? WORDS.partsOn(at[id].filter((p) => p.state === "on").length, at[id].length) : ""} acts=${Boolean(extra)}>
        <div class="p-health__rows">${at[id].map(partRow)}${extra}</div>
      <//>` : null;
  const waitingJobs = waiting.reduce((n, w) => n + w.count, 0);
  const nc = d.notConnected || [];

  return html`
    <div class="p-health">
      <${RoomHeader} glimpse=${glimpseFor("health")} pull strip title="Health" lead=${lead} actions=${techButton} state=${html`<${Tag} tone=${all.tone}>${all.text}<//>`} />

      <${Tiles} tiles=${tilesOf(d)} />

      ${groupOf("engine")}
      ${groupOf("gate", html`<${FenceRow} fence=${d.fence} technical=${technical} onRun=${runProof} running=${running} runError=${runError} />`)}
      ${groupOf("books")}
      ${groupOf("doors")}
      ${groupOf("apps")}

      <${Section} title="Jobs that are waiting" count=${waitingJobs ? `${waitingJobs} ${waitingJobs === 1 ? "job" : "jobs"}` : ""}
        say="These jobs cannot start yet. Each one needs something on this Mac first.">
        ${jobsRes.error && !jobsRes.data ? html`<${ErrorNotice} error=${jobsRes.error} onRetry=${jobsRes.reload} />` : null}
        ${jobsRes.loading && !jobsRes.data ? html`<${Loading} lines=${2} label="Checking the jobs" />` : null}
        ${jobsRes.data && !waiting.length && !problems.length ? html`<p class="p-health__none">No job is waiting for a tool.</p>` : null}
        ${waiting.length || problems.length ? html`<div class="p-health__rows">
          ${waiting.map((w) => html`<${Line} key=${w.text} icon="clock" title=${w.text} lamp="amber" state=${{ tone: "warn", text: "Waiting" }}
            say=${html`${w.count} ${w.count === 1 ? "job is" : "jobs are"} waiting${w.titles.length ? `: ${w.titles.join(", ")}${w.count > w.titles.length ? " and more" : ""}` : ""}. <${Command} text=${w.step} />`} />`)}
          ${problems.map((p, i) => html`<${Line} key=${`p${i}`} icon="alert" title=${problemLine(p)} lamp="red" state=${{ tone: "bad", text: "Left out" }} />`)}
        </div>` : null}
      <//>

      <${Section} title="Not connected yet" count=${nc.length ? String(nc.length) : ""}
        say="These are off on purpose. Nothing leaves the company until you connect it.">
        <div class="p-health__rows">
          ${nc.map((n) => html`<${Line} key=${n.id} icon="link" title=${n.label}
            say=${html`${n.explain} <${Command} text=${n.how} />`} />`)}
        </div>
      <//>

      <${Section} title="Disk">
        <div class="p-health__rows">
          <${Line} icon="folder" title=${diskLine(d.disk)} lamp=${d.disk && d.disk.ok ? "on" : "amber"} state=${d.disk && d.disk.ok ? { tone: "good", text: "Enough room" } : { tone: "warn", text: "Nearly full" }} />
        </div>
      <//>

      ${technical && d.modulesFailed && d.modulesFailed.length ? html`
        <${Section} title="Parts of the home screen that did not load">
          <ul class="p-health__techlist">${d.modulesFailed.slice(0, 50).map((m, i) => html`<li key=${i}>${typeof m === "string" ? m : JSON.stringify(m)}</li>`)}</ul>
        <//>` : null}
    </div>`;
}
