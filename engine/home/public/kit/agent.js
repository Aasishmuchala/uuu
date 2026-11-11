// An agent as a small chip (avatar and name, a link to its page) and as a card. CONTRACTS-V2 13.2.
// `agent` is a who ({ slug, name }) for the chip, and an agent-card (17.1) for the card.
import { html } from "../vendor/preact-htm.js";
import { Avatar } from "./avatar.js";
import { Live, StatusDot, Waiting } from "./status.js";

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

// The agent's state as a mark and a word: working, waiting for the owner, or its plain state.
export function AgentState({ agent }) {
  if (!agent) return null;
  if (agent.state === "working" || agent.live) return html`<${Live} />`;
  if (agent.waitingForYou || agent.state === "waiting_for_you") return html`<${Waiting} />`;
  const tone = agent.state === "problem" ? "bad" : agent.state === "paused" ? "warn" : "off";
  return html`<${StatusDot} tone=${tone} label=${text(agent.plainState) || "Free"} />`;
}

export function AgentCard({ agent }) {
  if (!agent) return null;
  const href = agentHref(agent.slug);
  const doing = agent.doingNow && agent.doingNow.title ? text(agent.doingNow.title) : "";
  return html`<a class="k-agent k-agent--card" href=${href}>
    <${Avatar} slug=${agent.slug} name=${agent.name} size=${48} />
    <div class="k-agent__body">
      <div class="k-agent__head">
        <h3 class="k-agent__title">${text(agent.name)}</h3>
        <${AgentState} agent=${agent} />
      </div>
      ${agent.summary && html`<p class="k-agent__summary">${text(agent.summary)}</p>`}
      ${doing && html`<p class="k-agent__doing"><span class="k-agent__doing-label">Now:</span> ${doing}</p>`}
    </div>
  </a>`;
}
