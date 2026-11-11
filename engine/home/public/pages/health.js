// Health: is each part on, does the fence hold, what is not connected yet, and free disk.
// The only page where technical names appear, and only behind "Show technical details".
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen } from "../lib/format.js";
import { Button, Card, ErrorNotice, Loading, Mono, NextStep, PageHeader, Section, StatusDot } from "../kit/index.js";

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
      <p>${fence && fence.sentence}</p>
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
                  <p class="p-health__sub">${p.sentence}</p>
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
            <p>${diskLine(d.disk)}</p>
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
