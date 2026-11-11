// Routines: standing work on a schedule, switched on or off by the owner. CONTRACTS-V2 17.6.
// Everything the routine files and the board say is shown as plain text.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { when } from "../lib/format.js";
import { AgentChip, Button, Card, Chip, Empty, ErrorNotice, Loading, NotConnected, PageHeader, Section, StatusDot, Tag, Time } from "../kit/index.js";

const LEAD = "Standing work that runs on a schedule. Routines start paused; switch one on when you want it to run by itself.";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const cap = (v, n = 600) => text(v).slice(0, n);

// "1 minute", "10 minutes", "1 hour", "1 hour 30 minutes". Empty when there is no limit.
export function limitWords(minutes) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m <= 0) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hp = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const mp = r ? `${r} ${r === 1 ? "minute" : "minutes"}` : "";
  return [hp, mp].filter(Boolean).join(" ");
}

// One short line about a run: "Finished, today 03:30". Empty when there is no run.
export function runLine(run) {
  if (!run) return "";
  const state = text(run.plainState) || text(run.state);
  const at = run.at ? when(run.at) : "";
  return [state, at].filter(Boolean).join(", ");
}

const STATE_TONE = { on: "ok", paused: "off", not_applied: "warn" };
const RUN_TONE = { finished: "ok", working: "live", starting: "live", failed: "bad", skipped: "off" };
const SOURCE = { schedule: "On schedule", manual: "By you" };
const sourceWords = (s) => (s === "schedule" ? SOURCE.schedule : SOURCE.manual);

function taskHref(run) {
  return run && run.taskId ? `#/tasks/${encodeURIComponent(run.taskId)}` : null;
}

function RunLink({ run }) {
  const href = taskHref(run);
  const label = text(run.identifier) || "Task";
  return href ? html`<a href=${href}>${label}</a>` : null;
}

function RoutineCard({ r, onChanged }) {
  const { announce } = useApp();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const notApplied = r.state === "not_applied";
  const isOn = r.state === "on";

  async function call(action) {
    setBusy(action);
    setError(null);
    setMessage("");
    try {
      const res = await api.post(`/api/routines/${encodeURIComponent(r.id)}/${action}`, {});
      if (action === "run") {
        setMessage(cap(res.message) || "Started.");
        announce(cap(res.message) || "Started.");
      } else {
        announce(action === "pause" ? "Routine paused." : "Routine switched on.");
      }
      if (onChanged) onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  return html`<${Card} padding="md">
    <div class="p-routines__card">
      <div class="p-routines__head">
        <h3 class="p-routines__title"><a href=${`#/routines/${encodeURIComponent(r.id)}`}>${cap(r.title, 200)}</a></h3>
        <${StatusDot} tone=${STATE_TONE[r.state] || "off"} label=${cap(r.plainState) || cap(r.state)} />
      </div>
      <div class="p-routines__meta">
        ${r.who && html`<${AgentChip} agent=${r.who} />`}
        ${r.when && r.when.plain && html`<${Chip} icon="clock">${cap(r.when.plain, 120)}<//>`}
        ${isOn && r.when && r.when.next && html`<span class="p-routines__next">Next run <${Time} at=${r.when.next} /></span>`}
      </div>
      ${r.lastRun && html`<p class="p-routines__last">Last run: ${runLine(r.lastRun)} ${" "}<${RunLink} run=${r.lastRun} /></p>`}
      ${notApplied
        ? html`<p class="p-routines__unset">Not set up yet. Run: engine setup</p>`
        : html`<div class="p-routines__actions">
            <${Button} variant="plain" busy=${busy === (isOn ? "pause" : "resume")} disabled=${!!busy} onClick=${() => call(isOn ? "pause" : "resume")}>${isOn ? "Pause" : "Switch on"}<//>
            <${Button} variant="plain" busy=${busy === "run"} disabled=${!!busy} onClick=${() => call("run")}>Run now<//>
          </div>`}
      ${message && html`<p class="p-routines__message" role="status">${message}</p>`}
      <${ErrorNotice} error=${error} />
    </div>
  <//>`;
}

function List() {
  const res = useResource("/api/routines", { every: 15000 });
  const d = res.data;
  if (res.loading && !d) return html`<${Loading} lines=${4} />`;
  if (res.error && !d) return html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  if (!d) return null;
  if (d.connected === false) return html`<${NotConnected} reason=${d.notConnected && d.notConnected.reason} next=${d.notConnected && d.notConnected.next} />`;
  const routines = Array.isArray(d.routines) ? d.routines : [];
  const problems = Array.isArray(d.problems) ? d.problems : [];
  return html`
    ${routines.length === 0
      ? html`<${Empty} title="No routines yet" text="Routines appear here once they are set up." />`
      : html`<div class="p-routines__list">${routines.map((r) => html`<${RoutineCard} key=${r.id} r=${r} onChanged=${res.refresh} />`)}</div>`}
    ${problems.length > 0 && html`<${Section} title="Left out">
      <ul class="p-routines__problems">${problems.slice(0, 20).map((p, i) => html`<li key=${i}>${cap(p.file, 120)}: ${cap(p.problem, 300)}</li>`)}</ul>
    <//>`}
  `;
}

function Runs({ runs }) {
  if (!runs.length) return html`<${Empty} title="No runs yet" text="Runs show here once the routine has started." />`;
  return html`<ul class="p-routines__runs">${runs.slice(0, 20).map((run) => {
    const href = taskHref(run);
    return html`<li key=${run.id} class="p-routines__run">
      <${StatusDot} tone=${RUN_TONE[run.state] || "off"} label=${cap(run.plainState) || cap(run.state)} />
      <span class="p-routines__run-when">${run.at ? when(run.at) : ""}</span>
      <${Tag}>${sourceWords(run.source)}<//>
      ${href && html`<a href=${href}>${cap(run.identifier) || "Task"}${run.title ? ` ${cap(run.title, 120)}` : ""}</a>`}
      ${run.note && html`<span class="p-routines__run-note">${cap(run.note, 300)}</span>`}
    </li>`;
  })}</ul>`;
}

function One({ id }) {
  const res = useResource(`/api/routines/${encodeURIComponent(id)}`, { every: 15000 });
  const d = res.data;
  const back = { href: "#/routines", label: "Routines" };
  if (res.loading && !d) return html`<${PageHeader} title="Routine" back=${back} /><${Loading} lines=${4} />`;
  if (res.error && !d) return html`<${PageHeader} title="Routine" back=${back} /><${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  if (!d || !d.routine) return null;
  const r = d.routine;
  const limit = limitWords(r.runMinutes);
  const produces = Array.isArray(r.produces) ? r.produces : [];
  return html`
    <${PageHeader} title=${cap(r.title, 200)} back=${back} lead=${cap(r.when && r.when.plain, 120)} />
    <${RoutineCard} r=${r} onChanged=${res.refresh} />
    <${Section} title="What it is asked to do"><p class="p-routines__ask">${cap(r.ask, 2000)}</p><//>
    ${produces.length > 0 && html`<${Section} title="What it must produce"><ul>${produces.slice(0, 20).map((f, i) => html`<li key=${i}>${cap(f, 200)}</li>`)}</ul><//>`}
    ${limit && html`<${Section} title="Time limit"><p>${limit}</p><//>`}
    <${Section} title="Runs"><${Runs} runs=${Array.isArray(d.runs) ? d.runs : []} /><//>
  `;
}

export default function Page({ route }) {
  const parts = (route && route.parts) || [];
  const id = parts[0] === "routines" ? parts[1] : parts[0];
  if (id) return html`<div class="p-routines"><${One} id=${id} /></div>`;
  return html`<div class="p-routines"><${PageHeader} title="Routines" lead=${LEAD} /><${List} /></div>`;
}
