// The compose dialog (CONTRACTS-V2 14.2, CONTRACTS-V3 26.2): the Composer in a Dialog, reachable from
// everywhere (the dock's "+", the key "c", the command menu, and openComposer() from any page). On send it
// calls POST /api/goals and then says "Given to the Chief of staff." with a link to the task. Its "/" list
// holds jobs (GET /api/jobs): picking one opens that job's page, where it is started.
// The Composer is loaded the same lazy way as a page, so this dialog works before it exists.
// Drawn as one composer (PLAN-COOK T111): a small "New task" label and Close on the dialog's own surface, the text
// area as the dialog's body (no box of its own), and one foot row: Plan first, Every job, the "/" and "@" keys as
// quiet buttons, then "Enter to send" and the Send button, which stands for the Composer's own (hidden) send and
// is enabled exactly when that one is.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { aheadLine, linkHref } from "../lib/format.js";
import { BeingBuilt, Button, Dialog, Icon, Kbd, Loading, SHORT_PLACEHOLDER } from "../kit/index.js";
import { loadModule } from "./lazy-page.js";

const MAX_JOBS = 500;

// The dialog's own words.
export const WORDS = {
  placeholder: SHORT_PLACEHOLDER,
  jobs: "Every job",
  slash: "jobs",
  slashLabel: "Pick a job",
  at: "who",
  atLabel: "Pick who it is for",
  enter: "to send",
  send: "Send",
};

// The text with `key` ("/" or "@") put in at the caret so the Composer opens its list: "/" starts a line, "@"
// starts a word. Returns { text, caret }.
export function withKey(value, caret, key) {
  const all = String(value ?? "");
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, all.length)) : all.length;
  const before = all.slice(0, at);
  let put = key;
  if (key === "/" && before && !before.endsWith("\n")) put = "\n/";
  if (key === "@" && before && !/\s$/.test(before)) put = " @";
  return { text: before + put + all.slice(at), caret: at + put.length };
}

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

// The words once a task is given (C3 25, M63): the time it takes, unless other work is ahead in the Chief of
// staff's line (`queue` of GET /api/shell, worked out by the server); then no time is promised.
export function givenLine(queue) {
  const ahead = aheadLine(queue);
  return ahead
    ? `Given to the Chief of staff. ${ahead} It is checked before it reaches you.`
    : "Given to the Chief of staff. It takes a few minutes and is checked before it reaches you.";
}

// The body of POST /api/goals from what the Composer sends; empty keys are left out.
export function goalBody({ text, to, planFirst, template } = {}) {
  const body = { text: String(text || "").trim() };
  if (to && to !== "chief-of-staff") body.to = to;
  if (planFirst) body.planFirst = true;
  if (template) body.template = template;
  return body;
}

export function ComposeDialog({ open, seed, team, queue, onClose, onSent }) {
  const [Composer, setComposer] = useState(undefined);
  const [jobs, setJobs] = useState([]);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const box = useRef(null);

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
      // The line as it stood when the task was given: it joined the end of it.
      setSent({ id: goal.identifier || goal.id || "", title: goal.title || "", line: givenLine(queue) });
      onSent?.("Given to the Chief of staff.");
    } finally {
      // A failure reaches the Composer, which keeps the text and says what went wrong.
      setBusy(false);
    }
  };

  // The foot's Send follows the Composer's own send button: enabled when it is (there are words, nothing is sent).
  useEffect(() => {
    const root = box.current;
    if (!open || !root || typeof root.querySelector !== "function") return undefined;
    const read = () => {
      const b = root.querySelector(".k-composer__send");
      setCanSend(Boolean(b && !b.disabled));
    };
    read();
    if (typeof MutationObserver !== "function") return undefined;
    const watch = new MutationObserver(read);
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    return () => watch.disconnect();
  }, [open, Composer, sent]);

  const field = () => box.current?.querySelector?.(".k-composer__field") || null;
  const sendNow = () => box.current?.querySelector?.(".k-composer__send")?.click();
  // "/" or "@" into the text, as if typed, so the Composer opens its list of jobs or agents.
  const putKey = (key) => {
    const el = field();
    if (!el) return;
    const next = withKey(el.value, el.selectionStart, key);
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (set) set.call(el, next.text);
    else el.value = next.text;
    el.focus();
    el.setSelectionRange?.(next.caret, next.caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const pickJob = (job) => {
    const href = jobHref(job);
    onClose();
    if (href && typeof location !== "undefined") location.hash = href;
  };

  const agents = (Array.isArray(team) ? team : []).filter((a) => a.slug !== "chief-of-staff");
  const s = seed || {};
  let body;
  let foot = null;
  if (sent) {
    body = html`
      <div class="s-compose-done" role="status">
        <p>${sent.line || givenLine(null)}${" "}
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
        initialText=${s.text || ""} to=${s.to || undefined} placeholder=${WORDS.placeholder} />`;
    foot = html`
      <${Button} variant="ghost" size="sm" href="#/jobs" class="s-compose-jobs" onClick=${onClose}>
        ${WORDS.jobs}<${Icon} name="chevron-right" size=${14} />
      <//>
      <${Button} variant="quiet" size="sm" class="s-compose-key s-compose-key--jobs" aria-label=${WORDS.slashLabel} onClick=${() => putKey("/")}>
        <${Kbd}>/<//>${WORDS.slash}
      <//>
      <${Button} variant="quiet" size="sm" class="s-compose-key s-compose-key--who" aria-label=${WORDS.atLabel} onClick=${() => putKey("@")}>
        <${Kbd}>@<//>${WORDS.at}
      <//>
      <span class="s-compose-keys" aria-hidden="true"><${Kbd}>Enter<//> ${WORDS.enter}</span>
      <${Button} variant="primary" size="sm" class="s-compose-send" disabled=${!canSend} busy=${busy} onClick=${sendNow}>${WORDS.send}<//>`;
  }

  return html`
    <${Dialog} open=${open} title="New task" onClose=${onClose} size="lg">
      <div class="s-compose" ref=${box}>
        ${body}
        ${foot}
      </div>
    <//>`;
}
