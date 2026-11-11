// A row of tabs. Arrow keys (and Home, End) move between them; Enter or Space picks one.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { StatusDot } from "./status.js";
import { cx } from "./util.js";

// What a tab's tone says to a screen reader.
const TONE_WORDS = { ok: "passed", bad: "failed", warn: "waiting for you", live: "working", wait: "waiting", off: "off" };

function move(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const edge = event.key === "Home" ? "first" : event.key === "End" ? "last" : null;
  if (!step && !edge) return;
  const all = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  if (!all.length) return;
  event.preventDefault();
  const at = all.indexOf(event.target);
  const next = edge === "first" ? 0 : edge === "last" ? all.length - 1 : (Math.max(at, 0) + step + all.length) % all.length;
  all[next].focus();
}

// The row wraps (tabs.css), so every tab is in sight; should a page make it scroll sideways, this keeps the current
// tab in view (the row scrolls, never the page).
function revealCurrent(row) {
  if (!row || typeof row.querySelector !== "function") return;
  const tab = row.querySelector(".k-tabs__tab--on");
  if (!tab || typeof tab.getBoundingClientRect !== "function" || !(row.scrollWidth > row.clientWidth)) return;
  const r = row.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  const pad = 16;
  if (t.left < r.left) row.scrollLeft -= r.left - t.left + pad;
  else if (t.right > r.right) row.scrollLeft += t.right - r.right + pad;
}

export function Tabs({ tabs, current, onChange, label }) {
  const list = Array.isArray(tabs) ? tabs.filter((t) => t && t.id != null) : [];
  const picked = list.some((t) => t.id === current) ? current : list[0]?.id;
  const rowRef = useRef(null);
  useEffect(() => { revealCurrent(rowRef.current); }, [picked, list.length]);
  return html`<div class="k-tabs" ref=${rowRef} role="tablist" aria-label=${label || undefined} onKeyDown=${move}>
    ${list.map((t) => {
      const on = t.id === picked;
      return html`<button
        key=${t.id}
        type="button"
        role="tab"
        class=${cx("k-tabs__tab", on && "k-tabs__tab--on")}
        aria-selected=${on ? "true" : "false"}
        tabindex=${on ? 0 : -1}
        onClick=${() => onChange && onChange(t.id)}
      >
        ${t.tone ? html`<${StatusDot} tone=${t.tone} label=${TONE_WORDS[t.tone]} hideLabel />` : null}
        <span class="k-tabs__label">${t.label ?? t.id}</span>
        ${t.count != null && t.count !== "" ? html`<span class="k-tabs__count">${t.count}</span>` : null}
      </button>`;
    })}
  </div>`;
}
