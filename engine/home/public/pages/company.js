// Company: every agent, what it is doing now, whether it is well, and Pause or Resume.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { count, fullWhen, when } from "../lib/format.js";
import { ErrorNotice, Loading, NotConnected, StateWord } from "../components/notice.js";
import { PageHeader } from "../components/page.js";

const TONES = { free: "good", working: "active", paused: "wait", problem: "bad", waiting_for_you: "warn" };

function AgentRow({ agent, onChanged }) {
  const { announce } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const a = agent;
  const verb = a.state === "paused" || a.state === "problem" ? "resume" : a.state === "waiting_for_you" ? null : "pause";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post(`/api/company/agents/${encodeURIComponent(a.id)}/${verb}`, {});
      announce(verb === "pause" ? `${a.name} is paused.` : `${a.name} is back at work.`);
      onChanged(out.agent);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  let doing;
  if (a.doingNow) {
    doing = a.doingNow.goalId
      ? html`Working on <a href=${`#/goals/${encodeURIComponent(a.doingNow.goalId)}`}>${a.doingNow.title}</a>`
      : html`Working on ${a.doingNow.title}`;
  } else if (a.state === "paused") doing = "Paused. It takes no new work until you resume it.";
  else if (a.state === "waiting_for_you") doing = html`Waiting for you to approve it. <a href="#/inbox">See the inbox</a>`;
  else doing = "Nothing right now.";

  return html`
    <li class="row agent">
      <div class="row-main">
        <p class="row-title-text">${a.name}${a.title && a.title !== a.name ? html` <span class="muted">· ${a.title}</span>` : null}</p>
        <p class="row-sub">${doing}</p>
        ${a.problem ? html`<p class="row-problem">${a.problem}</p>` : null}
        <p class="row-sub small">
          ${a.reportsTo ? `Reports to ${a.reportsTo}` : "Reports to you"}${a.lastActiveAt ? html` · <span title=${fullWhen(a.lastActiveAt)}>last active ${when(a.lastActiveAt)}</span>` : null}
        </p>
        <${ErrorNotice} error=${error} />
      </div>
      <div class="row-side row-side--stack">
        <${StateWord} tone=${TONES[a.state]}>${a.plainState}<//>
        ${verb ? html`
          <button type="button" class=${`btn${verb === "resume" ? " btn--primary" : ""}`} onClick=${toggle} disabled=${busy}
            aria-label=${`${verb === "pause" ? "Pause" : "Resume"} ${a.name}`}>
            ${busy ? (verb === "pause" ? "Pausing…" : "Resuming…") : verb === "pause" ? "Pause" : "Resume"}
          </button>` : null}
      </div>
    </li>`;
}

export function CompanyPage() {
  const res = useResource("/api/company", { every: 10000 });
  // An agent just paused or resumed shows its new state at once, until the next answer arrives.
  const [changed, setChanged] = useState({ data: null, agents: {} });
  const d = res.data;
  const fresh = changed.data === d ? changed.agents : {};
  const agents = (d?.agents || []).map((a) => fresh[a.id] || a);
  const working = agents.filter((a) => a.state === "working").length;
  const lead = d?.connected
    ? `${count(agents.length, "agent")}. ${working ? `${working} working now.` : "None is working right now."}`
    : "Your agents, what each is doing, and whether each is well.";

  const onChanged = (agent) => {
    if (agent) setChanged((c) => ({ data: d, agents: { ...(c.data === d ? c.agents : {}), [agent.id]: agent } }));
    res.refresh();
  };

  return html`
    <${PageHeader} title="Company" lead=${lead} />
    ${res.loading && !d ? html`<div class="card"><${Loading} lines=${5} label="Loading the company" /></div>` : null}
    <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
    ${d && !d.connected ? html`<${NotConnected} reason=${d.notConnected?.reason} next=${d.notConnected?.next} />` : null}
    ${d?.connected && !agents.length ? html`
      <div class="empty"><p class="empty-title">There are no agents yet.</p><p class="muted">Run: <code class="command">engine setup</code></p></div>` : null}
    ${agents.length ? html`<ul class="rows">${agents.map((a) => html`<${AgentRow} key=${a.id} agent=${a} onChanged=${onChanged} />`)}</ul>` : null}`;
}
