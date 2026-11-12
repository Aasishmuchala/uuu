// The compose dialog (CONTRACTS-V2 14.2, CONTRACTS-V3 26.2): the Composer in a Dialog, reachable from
// everywhere (the dock's "+", the key "c", the command menu, and openComposer() from any page). On send it
// calls POST /api/goals and then says "Given to the Chief of staff." with a link to the task. Its "/" list
// holds jobs (GET /api/jobs): picking one opens that job's page, where it is started.
// The Composer is loaded the same lazy way as a page, so this dialog works before it exists.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { BeingBuilt, Dialog, Loading } from "../kit/index.js";
import { loadModule } from "./lazy-page.js";

const MAX_JOBS = 500;

// GET /api/jobs (shape jobs) as one list of jobs (shape job), in file order. Anything that is not a job
// with a "<department>/<id>" id and a title is left out.
export function jobsOf(answer) {
  const out = [];
  for (const d of Array.isArray(answer?.departments) ? answer.departments : []) {
    for (const c of Array.isArray(d?.clusters) ? d.clusters : []) {
      for (const j of Array.isArray(c?.jobs) ? c.jobs : []) {
        if (!j || typeof j.id !== "string" || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(j.id) || typeof j.title !== "string") continue;
        out.push(j);
        if (out.length >= MAX_JOBS) return out;
      }
    }
  }
  return out;
}

// The page of a job: "#/jobs/<department>/<id>".
export const jobHref = (job) => linkHref({ page: "jobs", id: job && job.id });

// The body of POST /api/goals from what the Composer sends; empty keys are left out.
export function goalBody({ text, to, planFirst, template } = {}) {
  const body = { text: String(text || "").trim() };
  if (to && to !== "chief-of-staff") body.to = to;
  if (planFirst) body.planFirst = true;
  if (template) body.template = template;
  return body;
}

export function ComposeDialog({ open, seed, team, onClose, onSent }) {
  const [Composer, setComposer] = useState(undefined);
  const [jobs, setJobs] = useState([]);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setSent(null);
    loadModule("./kit/composer.js", "Composer").then((c) => { if (live) setComposer(() => c); });
    api.get("/api/jobs").then((a) => { if (live) setJobs(jobsOf(a)); }).catch(() => {});
    return () => { live = false; };
  }, [open, seed]);

  const send = async (msg) => {
    setBusy(true);
    try {
      // "Plan first" or a job chosen before the dialog opened holds unless the owner changed it.
      const s = seed || {};
      const answer = await api.post("/api/goals", goalBody({ ...msg, planFirst: msg.planFirst || s.planFirst, template: msg.template || s.template }));
      const goal = answer.goal || {};
      setSent({ id: goal.identifier || goal.id || "", title: goal.title || "" });
      onSent?.("Given to the Chief of staff.");
    } finally {
      // A failure reaches the Composer, which keeps the text and says what went wrong.
      setBusy(false);
    }
  };

  const pickJob = (job) => {
    const href = jobHref(job);
    onClose();
    if (href && typeof location !== "undefined") location.hash = href;
  };

  const agents = (Array.isArray(team) ? team : []).filter((a) => a.slug !== "chief-of-staff");
  const s = seed || {};
  let body;
  if (sent) {
    body = html`
      <div class="s-compose-done" role="status">
        <p>Given to the Chief of staff. It takes a few minutes and is checked before it reaches you.${" "}
          ${sent.id ? html`<a href=${`#/tasks/${encodeURIComponent(sent.id)}`} onClick=${onClose}>Open the task</a>` : null}</p>
        <button type="button" class="s-link-btn" onClick=${() => setSent(null)}>Start another task</button>
      </div>`;
  } else if (Composer === undefined) {
    body = html`<${Loading} lines=${2} label="Loading" />`;
  } else if (!Composer) {
    body = html`<${BeingBuilt} />`;
  } else {
    body = html`
      <${Composer} key=${s.n || 0} onSend=${send} agents=${agents} templates=${jobs} onPickJob=${pickJob} busy=${busy} autoFocus=${true}
        initialText=${s.text || ""} to=${s.to || undefined} />`;
  }

  return html`
    <${Dialog} open=${open} title="New task" onClose=${onClose} size="lg"
      footer=${html`<a class="s-compose-jobs" href="#/jobs" onClick=${onClose}>Every job</a>`}>
      <div class="s-compose">${body}</div>
    <//>`;
}
