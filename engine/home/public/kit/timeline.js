// The steps of a task on one shared time axis. CONTRACTS-V2 13.2.
// `items` are 17.3 `timeline` entries: { id, identifier, title, who, kind, state, plainState, startedAt, endedAt, durationMs }.
import { html } from "../vendor/preact-htm.js";
import { fullWhen, when } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Icon } from "./icon.js";
import { Mono } from "./text.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const ms = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};
const nowMs = (now) => {
  if (now === undefined || now === null) return Date.now();
  const t = now instanceof Date ? now.getTime() : typeof now === "number" ? now : ms(now);
  return t === null ? Date.now() : t;
};
const round2 = (n) => Math.round(n * 100) / 100;

// Pure. Places each item on an axis from the earliest start to the latest end (an unfinished item ends at `now`).
// Returns [{ id, leftPct, widthPct }]; a width is never under 1 and a bar never runs past the right edge.
export function layout(items, now) {
  const list = Array.isArray(items) ? items : [];
  const at = nowMs(now);
  const spans = list.map((it) => {
    const start = ms(it && it.startedAt);
    let end = ms(it && it.endedAt);
    if (end === null) end = start === null ? null : Math.max(start, at);
    return { id: it && it.id, start, end };
  });
  const known = spans.filter((s) => s.start !== null);
  if (known.length === 0) return spans.map((s) => ({ id: s.id, leftPct: 0, widthPct: 1 }));
  const min = Math.min(...known.map((s) => s.start));
  const max = Math.max(...known.map((s) => s.end));
  const total = max - min;
  return spans.map((s) => {
    if (s.start === null || total <= 0) return { id: s.id, leftPct: 0, widthPct: total <= 0 && s.start !== null ? 100 : 1 };
    const width = Math.max(1, round2(((s.end - s.start) / total) * 100));
    const left = Math.min(round2(((s.start - min) / total) * 100), 100 - width);
    return { id: s.id, leftPct: Math.max(0, left), widthPct: width };
  });
}

// "45 seconds", "9 minutes", "2 hours 5 minutes" (the same words as lib/format.js `duration`).
export function durationWords(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const plural = (v, one) => `${v} ${one}${v === 1 ? "" : "s"}`;
  if (n < 60000) return plural(Math.round(n / 1000), "second");
  const minutes = Math.round(n / 60000);
  if (minutes < 60) return plural(minutes, "minute");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${plural(h, "hour")} ${plural(m, "minute")}` : plural(h, "hour");
}

const TONES = { done: "ok", working: "live", checking: "live", needs_you: "warn", waiting: "wait", stopped: "off", failed: "bad" };
const toneOf = (it) => TONES[it && it.state] || (it && it.endedAt ? "ok" : "live");

export function Timeline({ items = [], now }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return html`<p class="k-timeline k-timeline--empty">No steps yet.</p>`;
  const places = layout(list, now);
  return html`<ol class="k-timeline">
    ${list.map((it, i) => {
      const p = places[i];
      const who = it.who || null;
      const tone = toneOf(it);
      const running = !it.endedAt;
      return html`<li class=${`k-timeline__row k-timeline__row--${tone}`} key=${it.id || i}>
        <div class="k-timeline__label">
          ${who && html`<${Avatar} slug=${who.slug} name=${who.name} size=${20} />`}
          <div class="k-timeline__text">
            <span class="k-timeline__title">
              ${it.kind === "check" && html`<${Icon} name="check" label="Check" />`}
              <span>${text(it.title)}</span>
            </span>
            <span class="k-timeline__meta">
              ${it.identifier && html`<${Mono}>${text(it.identifier)}<//>`}
              ${who && html`<span>${text(who.name)}</span>`}
            </span>
          </div>
        </div>
        <div class="k-timeline__track" aria-hidden="true">
          <span class=${`k-timeline__bar${running ? " k-timeline__bar--running" : ""}`}
            style=${`left:${p.leftPct}%;width:${p.widthPct}%`}></span>
        </div>
        <div class="k-timeline__when">
          <span class="k-timeline__state">${text(it.plainState)}</span>
          <span class="k-timeline__duration" title=${fullWhen(it.startedAt)}>
            ${durationWords(it.durationMs)}${running ? " so far" : ""}
          </span>
          <span class="u-visually-hidden">Started ${when(it.startedAt)}</span>
        </div>
      </li>`;
    })}
  </ol>`;
}
