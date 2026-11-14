// What sits on a stage (PLAN-COOK T33, from the C3 mockup's "S02" and "S01"): a shot, pages at a true width side by
// side at one scale with their pins in the gutter, the bar above them, the list of findings, two pictures as a
// pair and a verdict. Every picture address arrives already checked by its page's helper (R3); every string is text.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, isEmpty } from "./util.js";

const has = (v) => !isEmpty(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const CORNERS = ["tl", "tr", "bl", "br"];

// A label laid on a picture, at one of its corners.
export function PicTag({ at = "tl", children }) {
  return html`<span class=${cx("k-pictag", `k-pictag--${CORNERS.includes(at) ? at : "tl"}`)}>${children}</span>`;
}

// `tags`: [{ text, at }] or words (the first at the top left, the next at the bottom right, then the others).
export function Shot({ src, alt, tags, children }) {
  const list = Array.isArray(tags) ? tags.filter((t) => has(t)) : [];
  const order = ["tl", "br", "tr", "bl"];
  return html`<figure class="k-shot">
    <div class="k-shot__frame">
      ${typeof src === "string" && src ? html`<img class="k-shot__img" src=${src} alt=${typeof alt === "string" ? alt : ""} decoding="async" />` : null}
      ${list.map((t, i) => (typeof t === "object" && !t.type
        ? html`<${PicTag} at=${t.at || order[i % 4]}>${t.text}<//>`
        : html`<${PicTag} at=${order[i % 4]}>${t}<//>`))}
    </div>
    ${has(children) ? html`<figcaption class="k-shot__caption">${children}</figcaption>` : null}
  </figure>`;
}

// The bar above the frames: segments at the left, quiet buttons at the right (put a .k-stagebar__gap between).
export function StageBar({ children }) {
  return html`<div class="k-stagebar">${children}</div>`;
}

// A numbered finding's disc: a button when it can be pressed, else a mark. Pins on a frame pass `pointer`: they answer
// the pointer only, since the list of findings beside them is the same choice in one Tab stop.
export function Pin({ n, on, onClick, label, pointer }) {
  const cls = cx("k-pin", on && "k-pin--on");
  if (onClick) {
    return html`<button type="button" class=${cls} aria-label=${label || `Finding ${n}`} aria-pressed=${on ? "true" : "false"}
      tabindex=${pointer ? "-1" : undefined} onClick=${() => onClick(n)}>${n}</button>`;
  }
  return html`<span class=${cls} aria-hidden="true">${n}</span>`;
}

const DESK = 860;
// A phone frame on a phone shows only the top of its page, this many of the page's pixels; pins further down move to
// the "further down" label there.
const PHONE_CUT = 600;

// The scale a frame is drawn at, read from its drawn width; null until it has been measured.
function useScale(ref, width) {
  const [scale, setScale] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !(width > 0)) return undefined;
    const look = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / width);
    };
    look();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(look);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return scale;
}

// A picture of a page at its true width, scaled to its frame. `pins`: [{ n, x, y, w, h, side }] in the page's own
// pixels; a pin beside the frame sits in the gutter (left, right or top) with a lead to what it marks, a pin below the
// frame's height goes in the "further down" label, and a pin with no place is named in the label.
export function Frame({ width, height = 1048, src, alt, label, pins, selected, onPin }) {
  const w = num(width);
  const h = num(height, 1048) || 1048;
  const ref = useRef(null);
  const scale = useScale(ref, w);
  const all = Array.isArray(pins) ? pins.filter((p) => p && has(p.n)) : [];
  const placed = all.filter((p) => Number.isFinite(p.y) || Number.isFinite(p.x));
  const inside = placed.filter((p) => num(p.y) <= h);
  const below = placed.filter((p) => num(p.y) > h);
  const loose = all.filter((p) => !placed.includes(p));
  const cut = w < DESK ? Math.min(h, PHONE_CUT) : h;
  const deep = inside.filter((p) => num(p.y) > cut);
  const pct = scale ? Math.round(scale * 100) : null;
  const sideOf = (p) => (["left", "right", "top"].includes(p.side) ? p.side : "left");
  const vars = (p) => `--x:${num(p.x)};--y:${num(p.y)};--w:${num(p.w)};--h:${num(p.h)}`;
  return html`<figure class=${cx("k-frame", w >= DESK ? "k-frame--desk" : "k-frame--phone")}>
    <div ref=${ref} class="k-frame__wrap" style=${scale ? `--s:${scale.toFixed(4)}` : undefined}>
      <div class="k-frame__page" style=${w ? `--fw:${w};--fh:${h};--fcut:${cut}` : undefined}>
        ${typeof src === "string" && src ? html`<img class="k-frame__img" src=${src} alt=${typeof alt === "string" ? alt : ""} decoding="async" />` : null}
      </div>
      ${inside.map((p) => html`
        ${Number.isFinite(p.w) && Number.isFinite(p.h) ? html`<i class=${cx("k-frame__mark", p.n === selected && "k-frame__mark--on", deep.includes(p) && "k-frame__deep")} style=${vars(p)} aria-hidden="true"></i>` : null}
        <i class=${cx("k-frame__lead", `k-frame__lead--${sideOf(p)}`, deep.includes(p) && "k-frame__deep")} style=${vars(p)} aria-hidden="true"></i>
        <span class=${cx("k-frame__pin", `k-frame__pin--${sideOf(p)}`, deep.includes(p) && "k-frame__deep")} style=${vars(p)}>
          <${Pin} n=${p.n} on=${p.n === selected} onClick=${onPin} pointer />
        </span>`)}
      ${below.length || deep.length
        ? html`<span class=${cx("k-frame__below", !below.length && "k-frame__below--deep")}>
            ${deep.map((p) => html`<span class="k-frame__deep-only"><${Pin} n=${p.n} on=${p.n === selected} onClick=${onPin} pointer /></span>`)}
            ${below.map((p) => html`<${Pin} n=${p.n} on=${p.n === selected} onClick=${onPin} pointer />`)}
            <span>further down</span><${Icon} name="chevron-down" size=${12} />
          </span>`
        : null}
    </div>
    <figcaption class="k-frame__label">
      ${has(label) ? html`<b>${label}</b>` : null}
      <span>${w} px wide${pct && w >= DESK ? ` · shown at ${pct} percent` : ""}</span>
      ${loose.length ? html`<span class="k-frame__loose">${loose.map((p) => html`<${Pin} n=${p.n} on=${p.n === selected} onClick=${onPin} pointer />`)}</span>` : null}
    </figcaption>
  </figure>`;
}

// Frames side by side at one scale (each grows by its true width), on a stage panel whose padding is the gutter the
// pins sit in, as large as its place's width and height allow. `scale` (a number) fixes the scale instead.
export function Frames({ items, scale, selected, onPin }) {
  const list = Array.isArray(items) ? items.filter((it) => it && num(it.width) > 0) : [];
  const fixed = num(scale) > 0 ? num(scale) : null;
  // What bounds the panel by its place's height (stage.css): the pages' summed width, the tallest, the gaps between.
  const tall = list.reduce((m, it) => Math.max(m, num(it.height, 1048) || 1048), 0);
  const fit = !fixed && list.length ? `--k-frames-w:${list.reduce((t, it) => t + num(it.width), 0)};--k-frames-h:${tall};--k-frames-gaps:${list.length - 1}` : undefined;
  return html`<div class=${cx("k-frames", fixed && "k-frames--fixed", list.length === 1 && "k-frames--one")} style=${fit}>
    ${list.map((it, i) => html`<div key=${i} class=${cx("k-frames__cell", num(it.width) >= DESK ? "k-frames__cell--desk" : "k-frames__cell--phone")} style=${fixed ? `width:${Math.round(num(it.width) * fixed)}px` : `flex-grow:${num(it.width)}`}>
      <${Frame} ...${it} selected=${selected} onPin=${onPin} />
    </div>`)}
  </div>`;
}

// `items`: [{ n, title, detail, code }]. One row is open at a time; rows are buttons in one Tab stop (the chosen row,
// else the first); Up and Down move and choose. With `limit`, a longer list shows that many rows and a last row,
// `more` (its words, the caller's: "Show all 7"), that opens the rest in place; a chosen row further down opens them.
export function Finds({ items, selected, onSelect, limit, more }) {
  const list = Array.isArray(items) ? items.filter((it) => it && has(it.n)) : [];
  const [all, setAll] = useState(false);
  const root = useRef(null);
  const cap = Number.isInteger(limit) && limit > 0 && list.length > limit + 1 ? limit : null;
  const at = list.findIndex((it) => it.n === selected);
  const open = all || !cap || at >= cap;
  const shown = open ? list : list.slice(0, cap);
  const stop = shown.some((it) => it.n === selected) ? selected : shown.length ? shown[0].n : null;
  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(event.currentTarget?.querySelectorAll?.(".k-finds__row") || []);
    const here = rows.indexOf(globalThis.document?.activeElement);
    if (here < 0) return;
    event.preventDefault();
    const next = (here + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next].focus();
    if (onSelect && shown[next]) onSelect(shown[next].n);
  };
  // "Show all": the rest opens in place and focus goes to the first row it opened.
  const showAll = () => {
    setAll(true);
    setTimeout(() => {
      const rows = root.current?.querySelectorAll?.(".k-finds__row");
      if (rows && rows[cap] && typeof rows[cap].focus === "function") rows[cap].focus();
    }, 0);
  };
  return html`<div class="k-finds__box" ref=${root}>
    <ol class="k-finds" onKeyDown=${onKeyDown}>
      ${shown.map((it) => {
        const on = it.n === selected;
        return html`<li key=${it.n}>
          <button type="button" class=${cx("k-finds__row", on && "k-finds__row--on")} aria-pressed=${on ? "true" : "false"}
            tabindex=${it.n === stop ? "0" : "-1"} onClick=${() => onSelect && onSelect(it.n)}>
            <${Pin} n=${it.n} on=${on} />
            <span class="k-finds__what">${it.title}</span>
            ${on && (has(it.detail) || has(it.code))
              ? html`<span class="k-finds__detail">
                  ${has(it.detail) ? html`<span>${it.detail}</span>` : null}
                  ${has(it.code) ? html`<code class="k-finds__code">${it.code}</code>` : null}
                </span>`
              : null}
          </button>
        </li>`;
      })}
    </ol>
    ${open ? null : html`<button type="button" class="k-finds__more" onClick=${showAll}>
      <span>${has(more) ? more : `Show all ${list.length}`}</span><${Icon} name="chevron-down" size=${14} />
    </button>`}
  </div>`;
}

// Two captioned 16:9 pictures. `items`: [{ src, alt, title, sub }].
export function Pair({ items }) {
  const list = Array.isArray(items) ? items.filter(Boolean).slice(0, 2) : [];
  return html`<div class="k-pair">
    ${list.map((it, i) => html`<figure key=${i} class="k-pair__item">
      <div class="k-pair__pic">${typeof it.src === "string" && it.src ? html`<img src=${it.src} alt=${typeof it.alt === "string" ? it.alt : ""} decoding="async" />` : null}</div>
      <figcaption class="k-pair__caption">
        ${has(it.title) ? html`<b>${it.title}</b>` : null}
        ${has(it.sub) ? html`<span class="k-say">${it.sub}</span>` : null}
      </figcaption>
    </figure>`)}
  </div>`;
}

const VERDICT = { good: "check", warn: "alert", bad: "cross" };

// A verdict: a round mark in its tone, the word, and who said it. `inline`: one line, the word then the grey "by"
// words after a middle dot on one baseline; `inline={false}`: the word over its "by" line. Left unset, it is one line
// in a rail and two lines anywhere else (the sheet decides, so a page need not say).
export function Verdict({ tone = "good", title, by, inline }) {
  const t = Object.hasOwn(VERDICT, tone) ? tone : "good";
  return html`<div class=${cx("k-verdict", `k-verdict--${t}`, inline === true && "k-verdict--inline", inline === false && "k-verdict--stack")}>
    <span class="k-verdict__mark" aria-hidden="true"><${Icon} name=${VERDICT[t]} size=${16} /></span>
    <div class="k-verdict__text">
      <p class="k-verdict__title">${title}</p>
      ${has(by) ? html`<p class="k-say k-verdict__by">${by}</p>` : null}
    </div>
  </div>`;
}
