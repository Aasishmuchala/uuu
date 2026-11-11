// Health: is each part on, does the fence hold, what is not connected yet, and free disk.
// The only page where technical names appear, and only behind "Show technical details".
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { count, fullWhen, when } from "../lib/format.js";
import { ErrorNotice, Loading, NextStep, StateWord } from "../components/notice.js";
import { PageHeader, Section } from "../components/page.js";

const PART = {
  on: { tone: "good", word: "On" },
  off: { tone: "bad", word: "Off" },
  unhealthy: { tone: "warn", word: "Not working properly" },
  not_installed: { tone: "wait", word: "Not installed" },
};

function Proof({ fence, technical, onRun, starting, runError }) {
  const p = fence.lastProof;
  const running = fence.running || starting;
  const failed = p ? p.failed > 0 : false;
  const parts = p ? [
    p.passed ? count(p.passed, "check") + " passed" : null,
    p.failed ? count(p.failed, "check") + " failed" : null,
    p.skipped ? `${p.skipped} skipped` : null,
  ].filter(Boolean).join(", ") : "";
  return html`
    <div class="panel">
      <div class="part-head">
        <p class="part-name">The fence</p>
        ${p ? html`<${StateWord} tone=${failed ? "bad" : "good"}>${failed ? "Did not hold" : "Held"}<//>` : html`<${StateWord} tone="wait">Not checked yet<//>`}
      </div>
      <p>${fence.sentence}</p>
      <p class="small muted">
        ${p ? html`Last checked <time datetime=${p.ranAt} title=${fullWhen(p.ranAt)}>${when(p.ranAt)}</time>. ${parts}.` : "The proof has not been run on this Mac yet."}
        ${" "}The fence keeps agents inside their own folders and away from your files and the board.
      </p>
      ${technical && p?.lines?.length ? html`
        <ul class="tech-lines">
          ${p.lines.map((l, i) => html`<li key=${i}><span class="tech-status">${l.status}</span> ${l.text}</li>`)}
        </ul>` : null}
      <div class="row-actions">
        <button type="button" class="btn" onClick=${onRun} disabled=${running}>${running ? "The proof is running…" : "Run the proof now"}</button>
        ${running ? html`<span class="small muted" role="status">This takes a minute or two. This page updates by itself.</span>` : null}
      </div>
      <${ErrorNotice} error=${runError} />
    </div>`;
}

export function HealthPage() {
  const { announce } = useApp();
  const [technical, setTechnical] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState(null);
  const [fast, setFast] = useState(false);
  const res = useResource("/api/health", { every: fast ? 3000 : 10000 });
  const d = res.data;
  useEffect(() => {
    if (d && fast && !d.fence.running && !starting) setFast(false);
  }, [d]);

  async function runProof() {
    setStarting(true);
    setRunError(null);
    try {
      await api.post("/api/health/prove", {});
      announce("The proof has started.");
      setFast(true);
      res.refresh();
    } catch (err) {
      setRunError(err);
    } finally {
      setStarting(false);
    }
  }

  if (!d) {
    return html`
      <${PageHeader} title="Health" lead="Whether the engine is on, whether the fence holds, and what is not connected yet." />
      ${res.loading ? html`<div class="card"><${Loading} lines=${5} label="Checking the engine" /></div>` : null}
      <${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }

  const trouble = d.parts.filter((p) => p.state === "off" || p.state === "unhealthy");
  const lead = trouble.length
    ? `${count(trouble.length, "part needs", "parts need")} attention.`
    : "Everything that is installed is on.";

  return html`
    <${PageHeader} title="Health" lead=${lead}>
      <button type="button" class="btn btn--quiet" aria-pressed=${technical ? "true" : "false"} onClick=${() => setTechnical(!technical)}>
        ${technical ? "Hide technical details" : "Show technical details"}
      </button>
    <//>

    <${Section} title="The parts" id="parts">
      <ul class="rows">
        ${d.parts.map((p) => {
          const s = PART[p.state] || PART.unhealthy;
          return html`
            <li key=${p.id} class="row">
              <div class="row-main">
                <p class="row-title-text">${p.name}</p>
                <${PartSentence} text=${p.sentence} />
                ${technical && p.technical ? html`<p class="tech">${p.technical}</p>` : null}
              </div>
              <div class="row-side"><${StateWord} tone=${s.tone}>${s.word}<//></div>
            </li>`;
        })}
      </ul>
    <//>

    <${Section} title="Safety" id="fence">
      <${Proof} fence=${d.fence} technical=${technical} onRun=${runProof} starting=${starting} runError=${runError} />
    <//>

    <${Section} title="Not connected yet" id="not-connected">
      <p class="muted section-lead">These are switched off on purpose. Nothing leaves the company until you connect it.</p>
      <ul class="rows">
        ${d.notConnected.map((n) => html`
          <li key=${n.id} class="row">
            <div class="row-main">
              <p class="row-title-text">${n.label}</p>
              <p class="row-sub">${n.explain}</p>
              <${NextStep} text=${n.how} />
            </div>
            <div class="row-side"><${StateWord} tone="wait">Off<//></div>
          </li>`)}
      </ul>
    <//>

    <${Section} title="Disk" id="disk">
      <div class="panel">
        <div class="part-head">
          <p class="part-name">${d.disk.freeGb == null ? "Free space unknown" : `${d.disk.freeGb} GB free`}</p>
          <${StateWord} tone=${d.disk.ok ? "good" : "warn"}>${d.disk.ok ? "Enough room" : "Nearly full"}<//>
        </div>
        <p class="muted">The engine keeps at least ${d.disk.floorGb} GB free and will not install anything that would take it lower.${d.disk.ok ? "" : " Free some space on this Mac, then run the install again."}</p>
      </div>
    <//>

    ${technical && d.modulesFailed?.length ? html`
      <${Section} title="Parts of the home screen that did not load" id="modules">
        <ul class="tech-lines">${d.modulesFailed.map((m, i) => html`<li key=${i}>${typeof m === "string" ? m : JSON.stringify(m)}</li>`)}</ul>
      <//>` : null}`;
}

function PartSentence({ text }) {
  const m = /^(.*?)\s*(Run: .+)$/.exec(String(text || ""));
  if (!m) return html`<p class="row-sub">${text}</p>`;
  return html`<p class="row-sub">${m[1]}</p><${NextStep} text=${m[2]} />`;
}
