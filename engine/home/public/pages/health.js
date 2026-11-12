// Health: is each part on, does the fence hold, what is not connected yet, and free disk.
// The only page where technical names appear, and only behind "Show technical details".
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen } from "../lib/format.js";
import { Button, Card, ErrorNotice, Loading, Mono, NextStep, PageHeader, Section, StatusDot } from "../kit/index.js";

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
  on: { tone: "ok", word: "On" },
  off: { tone: "bad", word: "Off" },
  unhealthy: { tone: "warn", word: "Not working properly" },
  not_installed: { tone: "off", word: "Not installed" },
};

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

function Proof({ fence, technical, onRun, running, runError }) {
  const p = fence && fence.lastProof;
  return html`
    <${Card}>
      <div class="p-health__head">
        <h3 class="p-health__name">The fence</h3>
        ${running
          ? html`<${StatusDot} tone="live" label="Running" />`
          : p ? html`<${StatusDot} tone=${p.failed > 0 || (p.result && p.result !== "holds") ? "bad" : "ok"} label=${p.failed > 0 || (p.result && p.result !== "holds") ? "Did not hold" : "Held"} />`
            : html`<${StatusDot} tone="off" label="Not checked yet" />`}
      </div>
      <p class="p-health__lead">${fence && fence.sentence}</p>
      <p class="p-health__sub">${proofLine(p)}</p>
      ${technical && p && Array.isArray(p.lines) && p.lines.length ? html`
        <ul class="p-health__tech">
          ${p.lines.slice(0, 50).map((l, i) => html`<li key=${i}><${Mono}>${String(l.status)}<//> ${String(l.text)}</li>`)}
        </ul>` : null}
      <div class="p-health__actions">
        <${Button} onClick=${onRun} busy=${running} disabled=${running}>Run the proof now<//>
        ${running ? html`<span role="status" class="p-health__sub"><${StatusDot} tone="live" pulse=${true} label="The proof is running." /></span>` : null}
      </div>
      ${runError ? html`<${ErrorNotice} error=${runError} />` : null}
    <//>`;
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

  if (!d) {
    return html`
      <div class="p-health">
        <${PageHeader} title="Health" lead="Whether the engine is on, whether the fence holds, and what is not connected yet." />
        ${res.loading ? html`<${Loading} lines=${5} label="Checking the engine" />` : null}
        ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      </div>`;
  }

  return html`
    <div class="p-health">
      <${PageHeader} title="Health" lead="Whether the engine is on, whether the fence holds, and what is not connected yet."
        actions=${html`<${Button} variant="quiet" onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`} />

      <${Section} title="The parts">
        <ul class="p-health__list">
          ${(d.parts || []).map((p) => {
            const s = PART[p.state] || PART.unhealthy;
            return html`
              <li key=${p.id} class="p-health__row">
                <div>
                  <h3 class="p-health__name">${p.name}</h3>
                  ${/\bRun:/.test(String(p.sentence || ""))
                    ? html`<div class="p-health__sub"><${NextStep} text=${p.sentence} /></div>`
                    : html`<p class="p-health__sub">${p.sentence}</p>`}
                  ${technical && p.technical ? html`<p class="p-health__tech"><${Mono}>${p.technical}<//></p>` : null}
                </div>
                <${StatusDot} tone=${s.tone} label=${s.word} />
              </li>`;
          })}
        </ul>
      <//>

      <${Section} title="Safety">
        <${Proof} fence=${d.fence} technical=${technical} onRun=${runProof} running=${running} runError=${runError} />
      <//>

      <${Section} title="Jobs that are waiting" hint="These jobs cannot start yet. Each one needs something on this Mac first.">
        ${jobsRes.error && !jobsRes.data ? html`<${ErrorNotice} error=${jobsRes.error} onRetry=${jobsRes.reload} />` : null}
        ${jobsRes.loading && !jobsRes.data ? html`<${Loading} lines=${2} label="Checking the jobs" />` : null}
        ${jobsRes.data && !waiting.length ? html`<p class="p-health__sub">No job is waiting for a tool.</p>` : null}
        <ul class="p-health__list">
          ${waiting.map((w) => html`
            <li key=${w.text} class="p-health__row">
              <div>
                <h3 class="p-health__name">${w.text}</h3>
                <p class="p-health__sub">${w.count} ${w.count === 1 ? "job is" : "jobs are"} waiting${w.titles.length ? `: ${w.titles.join(", ")}${w.count > w.titles.length ? " and more" : ""}` : ""}.</p>
                <div class="p-health__sub"><${NextStep} text=${w.step} /></div>
              </div>
              <${StatusDot} tone="warn" label="Waiting" />
            </li>`)}
        </ul>
        ${problems.length ? html`
          <ul class="p-health__list p-health__problems">
            ${problems.map((p, i) => html`
              <li key=${i} class="p-health__row">
                <p class="p-health__sub">${problemLine(p)}</p>
                <${StatusDot} tone="bad" label="Left out" />
              </li>`)}
          </ul>` : null}
      <//>

      <${Section} title="Not connected yet" hint="These are off on purpose. Nothing leaves the company until you connect it.">
        <ul class="p-health__list">
          ${(d.notConnected || []).map((n) => html`
            <li key=${n.id} class="p-health__row">
              <div>
                <h3 class="p-health__name">${n.label}</h3>
                <p class="p-health__sub">${n.explain}</p>
                <${NextStep} text=${n.how} />
              </div>
              <${StatusDot} tone="off" label="Not connected yet" />
            </li>`)}
        </ul>
      <//>

      <${Section} title="Disk">
        <${Card}>
          <div class="p-health__head">
            <p class="p-health__disk">${diskLine(d.disk)}</p>
            <${StatusDot} tone=${d.disk && d.disk.ok ? "ok" : "warn"} label=${d.disk && d.disk.ok ? "Enough room" : "Nearly full"} />
          </div>
        <//>
      <//>

      ${technical && d.modulesFailed && d.modulesFailed.length ? html`
        <${Section} title="Parts of the home screen that did not load">
          <ul class="p-health__tech">${d.modulesFailed.slice(0, 50).map((m, i) => html`<li key=${i}>${typeof m === "string" ? m : JSON.stringify(m)}</li>`)}</ul>
        <//>` : null}
    </div>`;
}
