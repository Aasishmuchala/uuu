// The compose dialog (CONTRACTS-V2 14.2): the Composer in a Dialog, reachable from everywhere (the
// New task button, the key "c", the command menu, and openComposer() from any page). On send it
// calls POST /api/goals and then says "Given to the Chief of staff." with a link to the task.
// The Composer is loaded the same lazy way as a page, so this dialog works before it exists.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { BeingBuilt, Dialog, Loading } from "../kit/index.js";
import { loadModule } from "./lazy-page.js";

// The gallery's goals as one list for the Composer's "/" menu.
export function templatesOf(gallery) {
  const out = [];
  for (const d of Array.isArray(gallery?.departments) ? gallery.departments : []) {
    for (const g of Array.isArray(d.goals) ? d.goals : []) out.push({ ...g, department: d.id, departmentTitle: d.title });
  }
  return out;
}

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
  const [templates, setTemplates] = useState([]);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setSent(null);
    loadModule("./kit/composer.js", "Composer").then((c) => { if (live) setComposer(() => c); });
    api.get("/api/gallery").then((g) => { if (live) setTemplates(templatesOf(g)); }).catch(() => {});
    return () => { live = false; };
  }, [open, seed]);

  const send = async (msg) => {
    setBusy(true);
    try {
      // A ready-made goal or "plan first" chosen before the dialog opened holds unless the owner changed it.
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

  const agents = (Array.isArray(team) ? team : []).filter((a) => a.slug !== "chief-of-staff");
  const s = seed || {};
  let body;
  if (sent) {
    body = html`
      <div class="s-compose-done" role="status">
        <p>Given to the Chief of staff.${" "}
          ${sent.id ? html`<a href=${`#/tasks/${encodeURIComponent(sent.id)}`} onClick=${onClose}>Open the task</a>` : null}</p>
        <button type="button" class="s-link-btn" onClick=${() => setSent(null)}>Start another task</button>
      </div>`;
  } else if (Composer === undefined) {
    body = html`<${Loading} lines=${2} label="Loading" />`;
  } else if (!Composer) {
    body = html`<${BeingBuilt} />`;
  } else {
    body = html`
      <${Composer} key=${s.n || 0} onSend=${send} agents=${agents} templates=${templates} busy=${busy} autoFocus=${true}
        initialText=${s.text || ""} to=${s.to || undefined} />`;
  }

  return html`
    <${Dialog} open=${open} title="New task" onClose=${onClose} size="lg"
      footer=${html`<a class="s-compose-gallery" href="#/gallery" onClick=${onClose}>Ready-made goals</a>`}>
      <div class="s-compose">${body}</div>
    <//>`;
}
