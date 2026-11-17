// An agent as a small chip (avatar and name, a link to its page) and as a card. CONTRACTS-V2 13.2.
// `agent` is a who ({ slug, name }) for the chip, and an agent-card (17.1) for the card.
// PLAN-COOK T37: an avatar, the name at 15 px (14 in the chip), the state as a state line (St); an agent's
// department has no colour (O7). R5-G: the card's sentence runs its width; "Now:" in the third ink before the task
// at 13 px 500.
import { html } from "../vendor/preact-htm.js";
import { Avatar } from "./avatar.js";
import { St } from "./status.js";
import { Tag } from "./tag.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const agentHref = (slug) => (slug && slug !== "you" ? `#/team/${encodeURIComponent(slug)}` : null);

export function AgentChip({ agent, size = 20 }) {
  if (!agent) return null;
  const href = agentHref(agent.slug);
  const inner = html`<${Avatar} slug=${agent.slug} name=${agent.name} size=${size} /><span class="k-agent__name">${text(agent.name)}</span>`;
  return href
    ? html`<a class="k-agent k-agent--chip" href=${href}>${inner}</a>`
    : html`<span class="k-agent k-agent--chip">${inner}</span>`;
}

// The state's words and the tone of its chip: working (good), waiting for the owner (warn), a problem (bad),
// paused or its plain state (neutral). Checked in the order of the Map's lamp (world/state.js lampOf): paused, then a
// problem, then waiting, then working, so the lamp beside the words never says another thing (PLAN-3D-ALL U16: a
// paused agent with something waiting showed the switched-off lamp beside "Waiting for you").
const isPaused = (a) => a.state === "paused";
const isProblem = (a) => a.state === "problem";
const isWaiting = (a) => a.waitingForYou === true || a.state === "waiting_for_you";
const isWorking = (a) => a.state === "working" || Boolean(a.live);

export function agentStateOf(agent) {
  if (!agent) return null;
  const words = text(agent.plainState) || "Free";
  if (isPaused(agent)) return { words: text(agent.plainState) || "Paused", tone: "neutral" };
  if (isProblem(agent)) return { words, tone: "bad" };
  if (isWaiting(agent)) return { words: "Waiting for you", tone: "warn" };
  if (isWorking(agent)) return { words: "Working", tone: "good" };
  return { words, tone: "neutral" };
}

// The agent's state as a glyph and words: working, waiting for the owner, a problem, paused, or its plain state.
// `chip`: the same words as the kit's Tag in the state's tone, for a header that carries the state (TB4).
export function AgentState({ agent, chip = false }) {
  if (!agent) return null;
  if (chip) {
    const s = agentStateOf(agent);
    return html`<span class="k-agent__state k-agent__state--chip"><${Tag} tone=${s.tone}>${s.words}<//></span>`;
  }
  const words = text(agent.plainState) || "Free";
  if (isPaused(agent)) return html`<span class="k-agent__state"><${St} icon="pause">${text(agent.plainState) || "Paused"}<//></span>`;
  if (isProblem(agent)) return html`<span class="k-agent__state"><${St} tone="bad">${words}<//></span>`;
  if (isWaiting(agent)) return html`<span class="k-agent__state"><${St} tone="warn">Waiting for you<//></span>`;
  if (isWorking(agent)) return html`<span class="k-agent__state k-agent__state--live"><${St} tone="good" icon="loop">Working<//></span>`;
  return html`<span class="k-agent__state k-agent__state--quiet"><${St} icon="clock">${words}<//></span>`;
}

export function AgentCard({ agent }) {
  if (!agent) return null;
  const href = agentHref(agent.slug);
  const doing = agent.doingNow && agent.doingNow.title ? text(agent.doingNow.title) : "";
  return html`<a class="k-agent k-agent--card" href=${href}>
    <${Avatar} slug=${agent.slug} name=${agent.name} size=${32} />
    <div class="k-agent__body">
      <div class="k-agent__head">
        <h3 class="k-agent__title">${text(agent.name)}</h3>
        <${AgentState} agent=${agent} />
      </div>
      ${agent.summary && html`<p class="k-agent__summary">${text(agent.summary)}</p>`}
      ${doing && html`<p class="k-agent__doing"><span class="k-agent__doing-label">Now:</span> <span class="k-agent__doing-task">${doing}</span></p>`}
    </div>
  </a>`;
}
