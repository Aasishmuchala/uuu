// The three layouts the hero screens stand on (PLAN-COOK T33, from the C3 mockup's "the work" and "S03").
// StageLayout: the work on a stage, a strip of choices under it, and a rail to decide in at the right.
// DocLayout: a list of sections and one readable column of groups and rows (Settings).
// Blk is a block of the rail; Group, Rows and Row build the column; Checklist is what must be done first, inside a row's
// words. Every string is rendered as text.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Dialog } from "./overlays.js";
import { Notice } from "./states.js";
import { Tile } from "./tile.js";
import { cx, isEmpty, nextId, safeHref } from "./util.js";

const has = (v) => !isEmpty(v);
const TONES = ["good", "warn", "bad", "neutral"];
const toneOf = (t) => (TONES.includes(t) ? t : "neutral");

// A state is { tone, text } or plain words.
function stateParts(state) {
  if (state === undefined || state === null || state === false || state === "") return null;
  if (typeof state === "object" && !Array.isArray(state) && !state.type) return { tone: toneOf(state.tone), text: state.text };
  return { tone: "neutral", text: state };
}

// The words of a state as a tooltip (the dot alone is not explained on a phone): text only, capped.
const stateTitle = (t) => (typeof t === "string" || typeof t === "number" ? String(t).slice(0, 120) : undefined);

// The foot of the rail is either what it shows (all of it, everywhere) or { primary, rest }: then a phone shows
// the primary and a "More" button that opens the rest in a sheet.
function footParts(foot) {
  if (foot && typeof foot === "object" && !Array.isArray(foot) && !foot.type && ("primary" in foot || "rest" in foot)) {
    return { primary: foot.primary, rest: foot.rest };
  }
  return { primary: foot, rest: null };
}

// The stage's real height on the first screen is what the strip leaves: the strip's drawn height is told to the sheet
// as --k-strip-h (layout.css turns it into --k-stage-h, which a shot or a part on the stage is bounded by).
function useStripHeight(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.style || !root.querySelector || typeof ResizeObserver !== "function") return undefined;
    const strip = root.querySelector(".k-work__strip");
    if (!strip) { root.style.removeProperty("--k-strip-h"); return undefined; }
    const look = () => {
      const h = strip.offsetHeight;
      if (h > 0) root.style.setProperty("--k-strip-h", `${h}px`);
    };
    look();
    const ro = new ResizeObserver(look);
    ro.observe(strip);
    return () => ro.disconnect();
  });
}

export function StageLayout({ kind, title, lede, stage, strip, rail, foot, more, label }) {
  const [sheet, setSheet] = useState(false);
  const ref = useRef(null);
  useStripHeight(ref);
  const { primary, rest } = footParts(foot);
  const hasFoot = has(primary) || has(rest);
  return html`<div ref=${ref} class=${cx("k-work", !has(strip) && "k-work--no-strip")}>
    <div class="k-work__first">
      <section class="k-work__stage" aria-label=${label || undefined}>${stage}</section>
      ${has(strip) ? html`<div class="k-work__strip">${strip}</div>` : null}
    </div>
    <aside class="k-rail" aria-labelledby="page-title">
      <header class="k-rail__head">
        ${has(kind) ? html`<p class="k-rail__kind">${kind}</p>` : null}
        <h1 id="page-title" class="k-rail__title" tabindex="-1">${title}</h1>
        ${has(lede) ? html`<p class="k-rail__lede">${lede}</p>` : null}
      </header>
      ${has(rail) ? html`<div class="k-rail__body">${rail}</div>` : null}
      ${hasFoot
        ? html`<div class=${cx("k-rail__foot", has(rest) && "k-rail__foot--split")}>
            ${has(primary) ? html`<div class="k-rail__primary">${primary}</div>` : null}
            ${has(rest)
              ? html`<div class="k-rail__rest">${rest}</div>
                  <${Button} class="k-rail__more" aria-haspopup="dialog" aria-expanded=${sheet ? "true" : "false"}
                    onClick=${() => setSheet(true)}>More<//>`
              : null}
          </div>`
        : null}
    </aside>
    ${has(more) ? html`<section class="k-work__more">${more}</section>` : null}
    ${has(rest) ? html`<${Dialog} open=${sheet} title="More" size="sm" onClose=${() => setSheet(false)}>
        <div class="k-rail__sheet">${rest}</div>
      <//>` : null}
  </div>`;
}

// A block of the rail: a hairline above, 16 px above and below, a 14 px heading with an optional aside.
export function Blk({ title, aside, children }) {
  return html`<section class="k-blk">
    ${has(title) || has(aside)
      ? html`<h2 class="k-blk__title">
          ${has(title) ? html`<span class="k-blk__name">${title}</span>` : null}
          ${has(aside) ? html`<span class="k-blk__aside">${aside}</span>` : null}
        </h2>`
      : null}
    ${children}
  </section>`;
}

// `sections`: [{ id, label, icon, status: { tone, text } or words, href }]. A row with an href is a link;
// without, a button that calls onPick(id). The current one carries aria-current="page".
export function DocLayout({ title, state, intro, sections, current, onPick, children }) {
  const list = Array.isArray(sections) ? sections.filter((s) => s && s.id !== undefined && s.id !== null) : [];
  const chip = stateParts(state);
  return html`<div class=${cx("k-doc", "k-doc--layout", !list.length && "k-doc--single")}>
    ${list.length
      ? html`<nav class="k-doc__sections" aria-label="Sections">
          <ul class="k-doc__list">
            ${list.map((s) => {
              const on = s.id === current;
              const st = stateParts(s.status);
              // One line an item: a state that needs a look is a dot at the right in its tone; a plain state draws
              // nothing (seven grey dots read as noise). Its words are for a screen reader and on hover either way,
              // so the list never reads as a paragraph and the state is said on the page itself.
              const inner = html`${s.icon ? html`<${Icon} name=${s.icon} size=${16} class="k-doc__pick-icon" />` : html`<span class="k-doc__pick-icon"></span>`}
                <span class="k-doc__pick-name">${s.label}</span>
                ${st
                  ? html`<span class=${cx("k-doc__pick-state", `k-doc__pick-state--${st.tone}`)} title=${stateTitle(st.text)}>
                      ${st.tone !== "neutral" ? html`<span class="k-doc__pick-dot" aria-hidden="true"></span>` : null}<span class="k-sr">${st.text}</span>
                    </span>`
                  : null}`;
              const link = s.href !== undefined && s.href !== null ? safeHref(s.href) : undefined;
              return html`<li key=${s.id}>
                ${link
                  ? html`<a class="k-doc__pick" href=${link} aria-current=${on ? "page" : undefined}
                      onClick=${onPick ? () => onPick(s.id) : undefined}>${inner}</a>`
                  : html`<button type="button" class="k-doc__pick" aria-current=${on ? "page" : undefined}
                      onClick=${() => onPick && onPick(s.id)}>${inner}</button>`}
              </li>`;
            })}
          </ul>
        </nav>`
      : null}
    <div class="k-doc__main">
      <div class="k-doc__head">
        <h1 id="page-title" class="k-doc__title" tabindex="-1">${title}</h1>
        ${chip ? html`<span class=${cx("k-doc__state", `k-doc__state--${chip.tone}`)}>${chip.text}</span>` : null}
      </div>
      ${has(intro) ? html`<p class="k-doc__intro">${intro}</p>` : null}
      ${children}
    </div>
  </div>`;
}

export function Group({ title, aside, say, children }) {
  return html`<section class="k-group">
    ${has(title) || has(aside)
      ? html`<h2 class="k-group__title">
          ${has(title) ? html`<span>${title}</span>` : null}
          ${has(aside) ? html`<span class="k-group__aside">${aside}</span>` : null}
        </h2>`
      : null}
    ${has(say) ? html`<p class="k-say k-group__say">${say}</p>` : null}
    ${has(children) ? html`<div class="k-group__body">${children}</div>` : null}
  </section>`;
}

// One panel of rows, parted by hairlines.
export function Rows({ children }) {
  return html`<div class="k-rows">${children}</div>`;
}

// `icon` is an icon name or anything renderable; `warned` (words) puts a warning under the row, inside the panel.
// A row without an icon is a secondary row: no tile, its words start at the panel's edge. `state` is one state or a
// list of them (a live state beside the standing one), each a chip after the title.
export function Row({ icon, title, state, say, control, warned }) {
  const states = (Array.isArray(state) ? state : [state]).map(stateParts).filter(Boolean);
  const tile = has(icon);
  return html`<div class=${cx("k-rows__row", !tile && "k-rows__row--bare", has(warned) && "k-rows__row--warned")}>
    ${tile
      ? typeof icon === "string"
        ? html`<span class="k-rows__icon k-rows__icon--tile" aria-hidden="true"><${Tile} icon=${icon} size=${32} /></span>`
        : html`<span class="k-rows__icon" aria-hidden="true">${icon}</span>`
      : null}
    <div class="k-rows__text">
      <p class="k-rows__title">
        <span>${title}</span>
        ${states.map((st, i) => html`<span key=${i} class=${cx("k-rows__state", `k-rows__state--${st.tone}`)}>${st.text}</span>`)}
      </p>
      ${has(say) ? html`<p class="k-say">${say}</p>` : null}
    </div>
    ${has(control) ? html`<div class="k-rows__control">${control}</div>` : null}
    ${has(warned) ? html`<div class="k-rows__warned"><${Notice} tone="warn">${warned}<//></div>` : null}
  </div>`;
}

// What must be done first, inside a row's words (fix round B2): `lead` (a line over the list), then a line an item, a
// 16 px green check when it is done or a short dash when it is not (a status, never an open circle that reads as a
// choice). Past three items it folds to "2 of 5 done" and opens
// on a press. `items`: [{ done, text }], `text` anything renderable.
export function Checklist({ lead, items }) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && has(it.text));
  const [open, setOpen] = useState(false);
  const [id] = useState(() => nextId("k-checklist"));
  if (!list.length) return null;
  const done = list.filter((it) => it.done).length;
  const folds = list.length > 3;
  const shown = !folds || open;
  return html`<span class="k-checklist">
    ${has(lead) || folds
      ? html`<span class="k-checklist__lead">
          ${has(lead) ? html`<span>${lead}</span>` : null}
          ${folds
            ? html`<button type="button" class="k-checklist__fold" aria-expanded=${open ? "true" : "false"} aria-controls=${id}
                onClick=${() => setOpen(!open)}>${done} of ${list.length} done<${Icon} name=${open ? "chevron-down" : "chevron-right"} size=${14} /></button>`
            : null}
        </span>`
      : null}
    ${shown
      ? html`<span class="k-checklist__list" id=${id} role="list">
          ${list.map((it, i) => html`<span key=${i} role="listitem" class=${cx("k-checklist__item", it.done && "k-checklist__item--done")}>
            ${it.done
              ? html`<${Icon} name="done" size=${16} class="k-checklist__mark" />`
              : html`<span class="k-checklist__mark k-checklist__mark--todo" aria-hidden="true"></span>`}
            <span class="k-sr">${it.done ? "Done: " : "Not done yet: "}</span>
            <span class="k-checklist__text">${it.text}</span>
          </span>`)}
        </span>`
      : null}
  </span>`;
}
