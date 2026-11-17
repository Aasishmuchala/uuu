// The stage as a photograph (the owner chose photographs over 3D on 18 Nov 2026): the one div the Map and Needs you
// give the loft. The owner's own pictures (office/assets.js) fill it, the dusk loft or the golden-morning one by the
// theme, the desk for Needs you; no WebGL, no three.js, nothing drawn by script. The interface sits on the picture:
//
// - The frame: the picture in a box of its own shape, laid out by office/zones.js `viewOf` so the zones stand in the
//   free part of the stage (right of the rail, left of a panel, above the foot); a room opened moves and scales it
//   onto that room's zone (a CSS transform over 650 ms; with motion off, a short cross-fade instead). The loft stands
//   on its plain backdrop, so the stage paints that backdrop's own colours round it (a 3 x 3 pixel ground picture).
// - Light over the picture (map): a warm glow over a zone where someone works, a quiet dim over an idle or an
//   unused zone, a red-amber edge round a zone where someone is stuck; with a room open the other zones dim.
// - Markers (map): one per room placed in a zone (zonesFor: seven at most; the rest are in the list only): a link
//   to the room with its lamps (the kit's Lamp, one per agent, six at most and "+N"), and over it the room's tag
//   (its name and count words) with the agents who are stuck or wait on an approval; hovering, focusing or opening
//   the room shows all its agents. One "Doors" marker by the window wall opens a short list of the three doors,
//   each of which opens that door's panel and nothing more. Every marker is a real link or button with a name for
//   a screen reader; the picture and its light are hidden from readers.
// - A hand-off (diffWorld's `handoff`) draws a soft light travelling between the two zones' anchors (SVG over the
//   picture); a lamp that changed pulses its room's marker once.
// - The desk (Needs you): the stack's place (data-part="stack", the sheets the queue holds) with the page's "N more"
//   beside it; approved, the top sheet lifts off the stack and goes to the model on the desk; set aside, to the tray.
// - A picture that cannot be loaded leaves the plain ground; the markers and the light go with it, and the page's
//   list does everything the picture did.
//
// Server text reaches this file only through worldState() (names cut, as text nodes and escaped attributes); no
// server text enters a style, an address or the SVG. Positions are numbers this file works out.
//
// OfficeStage({ mode, state, focus, hover, safeRect, theme, still, label, note, events, onPick, onHover, video })
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Lamp } from "../kit/index.js";
import { hubLabel, nodeLine } from "../map/map-view.js";
import { cut, TAG_MAX } from "../world/state.js";
import { placeTags } from "../world/tags.js";
import { TAG_WORDS, WORDS, doorsTagLine } from "../world/words.js";
import { PHONE_BELOW, groundPath, lightOf, sourcesOf, videoOf } from "./assets.js";
import { DESK, DOORS, OVERVIEW, ZONES, project, roomTarget, viewOf, zonesFor } from "./zones.js";

// The stage's own words. Pinned by test/office/stage.test.mjs.
export const OFFICE_WORDS = Object.freeze({
  open: "Open",
  shut: "Shut",
  doorsList: "The three doors",
});

export const MOVE_MS = 650;
// The scrim behind the Map's rail fades over 80 px past the rail (styles/pages/map.css).
const SCRIM_FADE = 80;
const LAMPS_SHOWN = 6;
const FLOW_MS = 2200;
const PULSE_MS = 1600;
const FLIGHT_MS = 1100;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const fin = (v) => Number.isFinite(v);
const px = (v) => `${Math.round(v * 10) / 10}px`;

function reducedMotion() {
  const g = globalThis;
  return typeof g.matchMedia === "function" && g.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
}

// The tier from the window, as the pages' own phone rule (under 860 px).
const tierNow = () => (typeof globalThis.innerWidth === "number" && globalThis.innerWidth > 0 && globalThis.innerWidth < PHONE_BELOW ? "phone" : "desktop");

// The light over each zone: "stuck" when an agent there is stuck (a red lamp), "working" when one works, "idle"
// otherwise, "empty" for a zone no room has. Pure. -> { [zoneId]: state }
export function zoneLights(rooms, placed) {
  const out = {};
  for (const id of Object.keys(ZONES)) out[id] = "empty";
  for (const r of arr(rooms)) {
    if (!obj(r) || !placed.has(r.id)) continue;
    const lamps = arr(r.agents).map((a) => (obj(a) ? a.lamp : "off"));
    out[placed.get(r.id)] = lamps.includes("red") ? "stuck" : lamps.includes("on") ? "working" : "idle";
  }
  return out;
}

// The markers for a state: [{ id, zone, title, sub, label, lamps, more, agents }] in the rooms' order, one per room
// placed in a zone. At overview each shows the agents who are stuck or wait on an approval; the room hovered or
// chosen shows all of them; with a room chosen, the others show their lamps alone (`bare`). Pure.
export function marksOf(state, { focus = null, hover = null } = {}) {
  const rooms = arr(obj(state) ? state.rooms : null).filter((r) => obj(r) && typeof r.id === "string");
  const placed = zonesFor(rooms);
  const urgent = (a) => a.lamp === "red" || a.state === "waiting_for_you";
  const chosen = typeof focus === "string" && placed.has(focus) ? focus : null;
  return rooms.filter((r) => placed.has(r.id)).map((r) => {
    const agents = arr(r.agents).filter(obj);
    const all = r.id === chosen || r.id === hover;
    return {
      id: r.id, zone: placed.get(r.id),
      title: cut(r.title, TAG_MAX), whole: String(r.title || ""), sub: nodeLine(r.counts),
      label: hubLabel({ title: r.title, counts: r.counts }),
      lamps: agents.slice(0, LAMPS_SHOWN).map((a) => ({ slug: a.slug, lamp: a.lamp })),
      more: Math.max(0, agents.length - LAMPS_SHOWN),
      agents: agents.filter((a) => all || urgent(a)).map((a) => ({
        slug: a.slug, name: a.tag || cut(a.name, TAG_MAX), whole: a.name, lamp: a.lamp,
        words: a.lamp === "amber" ? TAG_WORDS.needsYou : a.plainState || "",
      })),
      bare: !!chosen && r.id !== chosen,
      chosen: r.id === chosen,
    };
  });
}

// The view for a stage: the overview, a room's zone, or the desk. Pure.
export function stageView({ mode, size, safe, zone, tier }) {
  if (!size) return null;
  if (mode === "desk") return viewOf({ stage: size, safe, target: DESK.focus, fill: 1, least: 1, most: tier === "phone" ? 1.6 : 1.15, cover: true });
  if (zone) return viewOf({ stage: size, safe, target: roomTarget(zone), fill: 0.9, least: 0.6, most: 2.4 });
  // beside a rail the overview keeps clear of the scrim's fade too, so the window wall's marker stands in the light
  const clear = obj(safe) && safe.x > 0 && safe.w > 400 ? { ...safe, x: safe.x + SCRIM_FADE, w: safe.w - SCRIM_FADE } : safe;
  return viewOf({ stage: size, safe: clear, target: OVERVIEW, fill: 0.94, least: 0.45, most: 1 });
}

function sizeOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  const r = el.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
}

const rectKey = (r) => (obj(r) ? [r.x, r.y, r.w, r.h].map((v) => (fin(v) ? Math.round(v) : 0)).join(",") : "");

// The doors' marker and its short list.
function DoorsMark({ doors, onPick, open, setOpen, pulse }) {
  const line = doorsTagLine(doors);
  const label = line ? `${WORDS.doors}: ${line}` : WORDS.doors;
  return html`<div class=${`o-doors${open ? " is-open" : ""}${pulse ? " is-pulse" : ""}`} data-mark="doors"
      onKeyDown=${(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
    <button type="button" class="o-mark o-mark--doors" aria-expanded=${open ? "true" : "false"} aria-label=${label}
        onClick=${() => setOpen(!open)}>
      <span class="o-mark__pin" aria-hidden="true"><span class="o-mark__door-glyph"></span></span>
      <span class="o-mark__tag" aria-hidden="true"><b class="o-mark__name">${WORDS.doors}</b>${line ? html`<span class="o-mark__sub">${line}</span>` : null}</span>
    </button>
    ${open ? html`<ul class="o-doors__list" role="list" aria-label=${OFFICE_WORDS.doorsList}>
      ${doors.map((d) => html`<li key=${d.id}>
        <button type="button" class="o-doors__pick" data-door-pick=${d.id} aria-label=${`${d.title}, ${d.on ? OFFICE_WORDS.open : OFFICE_WORDS.shut}`}
            onClick=${() => { setOpen(false); onPick(`door:${d.id}`); }}>
          <span class=${`o-doors__mark o-doors__mark--${d.state}`} aria-hidden="true"></span>
          <span class="o-doors__name" aria-hidden="true">${cut(d.title, TAG_MAX)}</span>
          <span class="o-doors__state" aria-hidden="true">${d.on ? OFFICE_WORDS.open : OFFICE_WORDS.shut}</span>
        </button>
      </li>`)}
    </ul>` : null}
  </div>`;
}

export function OfficeStage(props) {
  const p = obj(props) ? props : {};
  const mode = p.mode === "desk" ? "desk" : "map";
  const state = obj(p.state) ? p.state : null;
  const focus = typeof p.focus === "string" ? p.focus : null;
  const hover = typeof p.hover === "string" ? p.hover : null;
  const safe = obj(p.safeRect) ? p.safeRect : null;
  const light = lightOf(p.theme);
  const calm = p.still === true || reducedMotion();
  const label = typeof p.label === "string" ? p.label : "";
  const note = typeof p.note === "string" ? p.note : "";
  const picture = mode === "desk" ? "desk" : "loft";

  const [tier] = useState(tierNow);
  const [size, setSize] = useState(null);
  const [status, setStatus] = useState("loading");
  const [settled, setSettled] = useState(false);
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [flows, setFlows] = useState([]);
  const [pulses, setPulses] = useState([]);
  const [flights, setFlights] = useState([]);
  const [fade, setFade] = useState(0);
  const stageRef = useRef(null);
  const marksRef = useRef(null);
  const imgRef = useRef(null);
  const videoRef = useRef(null);
  const timers = useRef([]);
  const seq = useRef(0);
  const latest = useRef(p);
  latest.current = p;

  const rooms = state ? arr(state.rooms) : [];
  const placed = zonesFor(rooms);
  const zone = mode === "map" && focus && placed.has(focus) ? placed.get(focus) : null;
  const view = stageView({ mode, size, safe, zone, tier });
  const viewKey = view ? `${view.x},${view.y},${view.s},${view.w},${view.h}` : "";
  const marks = mode === "map" ? marksOf(state, { focus, hover }) : [];
  const doors = mode === "map" && state ? arr(state.doors).filter(obj) : [];
  const lights = mode === "map" ? zoneLights(rooms, placed) : {};
  const src = sourcesOf(picture, light, tier);
  const video = videoOf({ picture, light, tier, still: calm, video: p.video === undefined ? undefined : p.video });

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); timers.current = []; }, []);

  // The stage's size, read again when it changes.
  useLayoutEffect(() => {
    const el = stageRef.current;
    const read = () => { const s = sizeOf(el); if (s) setSize((o) => (o && o.w === s.w && o.h === s.h ? o : s)); };
    read();
    if (!el || typeof globalThis.ResizeObserver !== "function") return undefined;
    const ro = new globalThis.ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The first placement does not glide; later ones do.
  useEffect(() => { if (view && !settled) later(() => setSettled(true), 60); }, [viewKey]);

  // With motion off a change of view is a short cross-fade.
  const lastView = useRef("");
  useEffect(() => {
    if (lastView.current && viewKey && lastView.current !== viewKey && calm) setFade((n) => n + 1);
    lastView.current = viewKey;
  }, [viewKey]);

  // A picture already in the browser's memory may have loaded before its listener could hear it.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && img.complete === true && img.naturalWidth > 0) setStatus("ready");
  }, [src.src]);
  useEffect(() => { setStatus("loading"); }, [picture, light]);

  // The moving picture: paused while the tab is hidden.
  useEffect(() => {
    const v = videoRef.current;
    const doc = globalThis.document;
    if (!v || !doc || typeof doc.addEventListener !== "function") return undefined;
    const on = () => {
      try {
        if (doc.visibilityState === "hidden") v.pause();
        else { const r = v.play(); if (r && typeof r.catch === "function") r.catch(() => {}); }
      } catch { /* the still stays */ }
    };
    doc.addEventListener("visibilitychange", on);
    return () => doc.removeEventListener("visibilitychange", on);
  }, [video]);

  // What an update brings: a hand-off's light, a lamp's pulse, the desk's sheet.
  const events = Array.isArray(p.events) ? p.events : null;
  useEffect(() => {
    if (!events || !events.length) return;
    const slugRoom = new Map();
    for (const r of rooms) for (const a of arr(r && r.agents)) if (obj(a)) slugRoom.set(a.slug, r.id);
    const newFlows = [];
    const newPulses = [];
    const newFlights = [];
    for (const e of events) {
      if (!obj(e) || e.animate !== true) continue;
      if (mode === "map" && e.type === "handoff") {
        const a = placed.get(slugRoom.get(e.from));
        const b = placed.get(slugRoom.get(e.to));
        if (a && b && a !== b) newFlows.push({ key: `f${++seq.current}`, from: ZONES[a].anchor, to: ZONES[b].anchor });
      } else if (mode === "map" && e.type === "lamp" && placed.has(e.room)) newPulses.push(e.room);
      else if (mode === "map" && e.type === "door") newPulses.push("doors");
      else if (mode === "desk" && (e.type === "approve" || e.type === "aside")) newFlights.push({ key: `s${++seq.current}`, to: e.type === "approve" ? "model" : "tray" });
    }
    if (newFlows.length) {
      setFlows((o) => [...o, ...newFlows].slice(-3));
      later(() => setFlows((o) => o.filter((f) => !newFlows.includes(f))), calm ? 900 : FLOW_MS);
    }
    if (newPulses.length) {
      const ids = [...new Set(newPulses)];
      setPulses((o) => [...new Set([...o, ...ids])]);
      later(() => setPulses((o) => o.filter((x) => !ids.includes(x))), PULSE_MS);
    }
    if (newFlights.length) {
      setFlights((o) => [...o, ...newFlights].slice(-2));
      later(() => setFlights((o) => o.filter((f) => !newFlights.includes(f))), calm ? 400 : FLIGHT_MS);
    }
  }, [events]);

  // Where each marker stands (stage pixels), and whether its anchor is in the free rectangle at all.
  const bounds = view ? (safe && fin(safe.w) && safe.w > 40 ? { x: safe.x || 0, y: safe.y || 0, w: safe.w, h: safe.h } : { x: 0, y: 0, w: size.w, h: size.h }) : null;
  const placeOf = (anchor) => {
    const at = view ? project(view, anchor) : null;
    if (!at) return { style: undefined, away: "false" };
    const inside = at.x >= bounds.x - 2 && at.x <= bounds.x + bounds.w + 2 && at.y >= bounds.y - 2 && at.y <= bounds.y + bounds.h + 2;
    return { style: `transform: translate(${px(at.x)}, ${px(at.y)})`, away: inside ? "false" : "true", at };
  };

  // The tags placed so no two cross and none covers a marker's lamps, inside the free rectangle: the room opened
  // first, then the others in the rooms' order, the doors last.
  const tagKey = `${marks.map((m) => `${m.id}:${m.agents.length}:${m.bare ? 1 : 0}`).join(" ")}|${doors.length}|${doorsOpen ? 1 : 0}`;
  useLayoutEffect(() => {
    const layer = marksRef.current;
    if (!layer || !view) return;
    const pins = [];
    const boxes = [];
    for (const el of Array.from(layer.childNodes || []).filter((c) => c.nodeType === 1)) {
      if (el.getAttribute("data-away") === "true") continue;
      const zid = el.getAttribute("data-zone");
      const at = project(view, zid === "doors" ? DOORS.anchor : ZONES[zid] ? ZONES[zid].anchor : null);
      if (!at) continue;
      const pin = typeof el.querySelector === "function" ? el.querySelector(".o-mark__pin") : null;
      const pw = pin && pin.offsetWidth > 0 ? pin.offsetWidth : 18;
      const ph = pin && pin.offsetHeight > 0 ? pin.offsetHeight : 18;
      pins.push({ pin: true, x: at.x - pw / 2, y: at.y - ph / 2, w: pw, h: ph });
      const tag = typeof el.querySelector === "function" ? el.querySelector(".o-mark__tag") : null;
      if (!tag) continue;
      const w = tag.offsetWidth > 0 ? tag.offsetWidth : 120;
      const h = tag.offsetHeight > 0 ? tag.offsetHeight : 22;
      boxes.push({ tag, at, x: at.x - w / 2, y: at.y - h - 14, w, h, chosen: el.getAttribute("data-chosen") === "true" });
    }
    boxes.sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0));
    // the lamps first, where they stand, so the tags go round them
    const out = placeTags([...pins, ...boxes], bounds).slice(pins.length);
    for (const b of out) {
      b.tag.setAttribute("data-placed", b.hidden ? "hidden" : "shown");
      if (!b.hidden) b.tag.style.transform = `translate(${px(b.x - b.at.x)}, ${px(b.y - b.at.y)})`;
    }
  }, [viewKey, tagKey, rectKey(safe), status]);

  const pick = (id) => { const f = latest.current.onPick; if (typeof f === "function") f(id); };
  const point = (id) => { const f = latest.current.onHover; if (typeof f === "function") f(id); };

  const frameStyle = view ? `width: ${px(view.w)}; height: ${px(view.h)}; transform: translate(${px(view.x)}, ${px(view.y)}) scale(${view.s})` : undefined;
  const failed = status === "failed";
  const sheets = state && obj(state.stack) && fin(state.stack.sheets) ? state.stack.sheets : 0;

  // The desk's places in stage pixels (the stack, the note beside it, where a sheet goes).
  const stackAt = mode === "desk" && view ? project(view, DESK.stack) : null;
  const noteAt = stackAt ? (() => {
    const b = safe && fin(safe.w) && safe.w > 40 ? safe : { x: 0, y: 0, w: size.w, h: size.h };
    return { x: Math.min(Math.max(stackAt.x + 24, b.x + 12), b.x + b.w - 96), y: Math.min(Math.max(stackAt.y - 12, b.y + 12), b.y + b.h - 40) };
  })() : null;
  const flightTo = (to) => {
    if (!view) return { dx: 0, dy: 0 };
    const a = project({ ...view, x: 0, y: 0, s: 1 }, DESK.stack);
    const b = project({ ...view, x: 0, y: 0, s: 1 }, to === "model" ? DESK.model : DESK.tray);
    return { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y) };
  };

  const status_ = status === "loading" ? (mode === "desk" ? WORDS.lightingDesk : WORDS.lightingStudio) : "";
  const cls = ["o-stage", `o-stage--${mode}`, calm ? "o-stage--still" : "", settled ? "is-settled" : "", view ? "is-placed" : "", zone ? "is-room" : ""].filter(Boolean).join(" ");

  return html`
    <div class=${cls} ref=${stageRef} data-office=${status} data-light=${light} data-tier=${tier} data-mode=${mode}>
      <img class="o-ground" src=${groundPath(picture, light)} alt="" aria-hidden="true" data-cook-picture draggable="false" />
      <div class=${`o-frame${fade ? ` o-frame--fade${fade % 2}` : ""}`} style=${frameStyle} aria-hidden="true" data-cook-picture>
        <img class="o-img" ref=${imgRef} src=${src.src} srcset=${src.srcset} sizes=${src.sizes} alt="" decoding="async" draggable="false"
          onLoad=${() => setStatus("ready")} onError=${() => setStatus("failed")} />
        ${video && !failed ? html`<video class="o-video" ref=${videoRef} src=${video} poster=${src.src} muted autoplay loop playsinline preload="auto" disablepictureinpicture></video>` : null}
        ${mode === "map" && !failed ? html`<div class="o-light" style=${zone ? `--o-cx: ${ZONES[zone].anchor.x}%; --o-cy: ${ZONES[zone].anchor.y}%` : undefined}>
          ${Object.keys(ZONES).map((id) => {
            const b = ZONES[id].box;
            const lit = lights[id] || "empty";
            const away = zone && id !== zone;
            const marked = hover && placed.get(hover) === id;
            return html`<i key=${id} class=${`o-zone o-zone--${lit}${away ? " is-away" : ""}${marked ? " is-marked" : ""}${zone === id ? " is-chosen" : ""}`} data-zone-light=${id}
              style=${`left: ${b.x}%; top: ${b.y}%; width: ${b.w}%; height: ${b.h}%`}></i>`;
          })}
        </div>` : null}
        ${flows.length ? html`<svg class="o-flow" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          ${flows.map((f) => {
            const mx = (f.from.x + f.to.x) / 2;
            const my = Math.min(f.from.y, f.to.y) - Math.max(6, Math.abs(f.to.x - f.from.x) * 0.35);
            const d = `M ${f.from.x} ${f.from.y} Q ${mx.toFixed(2)} ${Math.max(2, my).toFixed(2)} ${f.to.x} ${f.to.y}`;
            return html`<g key=${f.key} class="o-flow__one"><path class="o-flow__trail" d=${d} pathLength="100"></path><path class="o-flow__glow" d=${d} pathLength="100"></path><path class="o-flow__spark" d=${d} pathLength="100"></path></g>`;
          })}
        </svg>` : null}
      </div>
      ${mode === "map" && !failed ? html`<div class="o-marks" ref=${marksRef}>
        ${marks.map((m) => { const at = placeOf(ZONES[m.zone].anchor); return html`<a key=${m.id} class=${`o-mark o-mark--room${m.bare ? " is-bare" : ""}${m.chosen ? " is-chosen" : ""}${pulses.includes(m.id) ? " is-pulse" : ""}${hover === m.id ? " is-marked" : ""}`}
            href=${`#/map/${m.id}`} data-zone=${m.zone} data-room=${m.id} data-chosen=${m.chosen ? "true" : "false"} aria-label=${m.label}
            style=${at.style} data-away=${at.away}
            aria-current=${m.chosen ? "true" : undefined}
            onClick=${(e) => { if (e && typeof e.preventDefault === "function") e.preventDefault(); pick(m.id); }}
            onMouseEnter=${() => point(m.id)} onMouseLeave=${() => point(null)} onFocus=${() => point(m.id)} onBlur=${() => point(null)}>
          <span class="o-mark__pin" aria-hidden="true">
            ${m.lamps.length ? m.lamps.map((l) => html`<${Lamp} key=${l.slug} state=${l.lamp} />`) : html`<span class="o-mark__dot"></span>`}
            ${m.more ? html`<span class="o-mark__more u-num">+${m.more}</span>` : null}
          </span>
          ${m.bare ? null : html`<span class="o-mark__tag" aria-hidden="true" data-placed="hidden" title=${m.whole}>
            <span class="o-mark__head"><b class="o-mark__name">${m.title}</b><span class="o-mark__sub">${m.sub}</span></span>
            ${m.agents.length ? html`<span class="o-mark__agents">${m.agents.map((a) => html`<span key=${a.slug} class="o-mark__agent" title=${a.whole}>
              <${Lamp} state=${a.lamp} /><span class="o-mark__agent-name">${a.name}</span>${a.words ? html`<span class="o-mark__agent-state">${a.words}</span>` : null}
            </span>`)}</span>` : null}
          </span>`}
        </a>`; })}
        ${doors.length ? html`<div class="o-mark-at" data-zone="doors" style=${placeOf(DOORS.anchor).style} data-away=${placeOf(DOORS.anchor).away}><${DoorsMark} doors=${doors} onPick=${pick} open=${doorsOpen} setOpen=${setDoorsOpen} pulse=${pulses.includes("doors")} /></div>` : null}
      </div>` : null}
      ${mode === "desk" ? html`<span class="o-stack" data-part="stack" data-sheets=${String(sheets)} aria-hidden="true"
          style=${stackAt ? `transform: translate(${px(stackAt.x)}, ${px(stackAt.y)})` : undefined}>
        ${flights.map((f) => { const t = flightTo(f.to); return html`<i key=${f.key} class=${`o-sheet o-sheet--${f.to}`}
          style=${`--o-dx: ${Math.round(t.dx * (view ? view.s : 1))}px; --o-dy: ${Math.round(t.dy * (view ? view.s : 1))}px; --o-w: ${view ? Math.round(view.w * view.s * 0.2) : 160}px`}></i>`; })}
      </span>` : null}
      ${mode === "desk" && note ? html`<span class="o-note u-num" aria-hidden="true"
          style=${noteAt ? `transform: translate(${px(noteAt.x)}, ${px(noteAt.y)})` : undefined}>${note}</span>` : null}
    </div>
    ${label ? html`<p class="u-visually-hidden">${label}</p>` : null}
    <p class="u-visually-hidden" role="status">${status_}</p>`;
}

export default OfficeStage;
