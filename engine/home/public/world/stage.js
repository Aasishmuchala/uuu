// The stage (PLAN-3D D2, D3, D6, D7): the one div the Map and Needs you give the studio. Preact owns this div and
// nothing under the canvas: it draws the fallback at once from the plan and the SceneState, then, only where WebGL2
// exists, the address does not say `world=off`, the stage is at least 240 px wide and the browser does not ask to
// save data, loads ./world.js by import() and hands it a host. Until the world says it is ready the drawn picture
// shows; a load that fails, or a world that loses its context, leaves the drawn picture in place, once, silently.
//
// The tag layer: the names over the picture are DOM text nodes (D9), never drawn into the world. At overview, each
// room's title with its count words and every agent who needs the owner; with a room chosen, that room and every
// agent in it and no other room's tags. Each is placed by the world's `project` after a frame, or by the drawn
// picture's own geometry, and the boxes go through placeTags so no two cross.
//
// The whole stage is aria-hidden and nothing in it takes focus; `label` is spoken by a visually hidden line beside
// it, and "Lighting the studio" (or "the desk") by a visually hidden status line while the world loads.
//
// WorldStage({ mode, state, focus, hover, safeRect, theme, still, label, onPick, onHover, load })
// - state: a result of worldState() (state.js). The world gets only its `scene`; the tags get names and words.
// - onPick(roomId | "door:<id>"), onHover(roomId | "door:<id>" | null): from the picture, drawn or 3D.
// - load: how ./world.js is fetched (the tests give their own); by default import("./world.js").
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { nodeLine } from "../map/map-view.js";
import { drawFallback, DEFAULT_SIZE } from "./fallback.js";
import { cut, TAG_MAX } from "./state.js";
import { placeTags } from "./tags.js";
import { WORDS } from "./words.js";

export const MIN_WIDTH = 240;
export const PHONE_BELOW = 860;
const TAG_H = 22;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const fin = (v) => Number.isFinite(v);
const loadWorld = () => import("./world.js");

// True when the address asks for no 3D: `world=off` in the query or in the hash's query.
export function worldOff(where) {
  const text = typeof where === "string" ? where : "";
  return /(^|[?&#])world=off(&|$|#)/.test(text);
}

// The conditions of D3, from plain facts.
export function worldAllowed({ webgl2, query, width, saveData } = {}) {
  return webgl2 === true && !worldOff(query) && fin(width) && width >= MIN_WIDTH && saveData !== true;
}

// The facts, read from the page.
function envOf(width) {
  const g = globalThis;
  const loc = g.location || {};
  const hash = typeof loc.hash === "string" ? loc.hash : "";
  const query = `${typeof loc.search === "string" ? loc.search : ""}&${hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : ""}`;
  const conn = g.navigator && g.navigator.connection;
  return { webgl2: typeof g.WebGL2RenderingContext === "function", query, width, saveData: !!(conn && conn.saveData === true) };
}

function sizeOf(el) {
  if (el && typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
  }
  if (el && el.clientWidth > 0 && el.clientHeight > 0) return { width: el.clientWidth, height: el.clientHeight };
  return null;
}

// The tags for a state: [{ id, kind, text, sub, title, lamp }]. Text is the DOM's (cut to TAG_MAX, the whole name in
// `title`); ids are the anchors the world and the drawn picture know.
export function tagsOf(state, { mode = "map", focus = null } = {}) {
  if (mode !== "map" || !obj(state)) return [];
  const rooms = arr(state.rooms).filter((r) => obj(r) && r.inPlan === true);
  const roomTag = (r) => ({ id: r.anchor || r.id, kind: "room", text: cut(r.title, TAG_MAX), sub: nodeLine(r.counts), title: r.title, lamp: null });
  const agentTag = (a) => ({ id: a.anchor || `agent:${a.slug}`, kind: "agent", text: a.tag || cut(a.name, TAG_MAX), sub: a.plainState || "", title: a.name, lamp: a.lamp });
  const chosen = typeof focus === "string" ? rooms.find((r) => r.id === focus) : null;
  if (chosen) return [roomTag(chosen), ...arr(chosen.agents).filter(obj).map(agentTag)];
  const needs = rooms.flatMap((r) => arr(r.agents).filter((a) => obj(a) && a.needsYou === true)).map(agentTag);
  return [...needs, ...rooms.map(roomTag)];
}

const rectKey = (r) => (obj(r) ? [r.x, r.y, r.w, r.h].map((v) => (fin(v) ? Math.round(v) : 0)).join(",") : "");

export function WorldStage(props) {
  const p = obj(props) ? props : {};
  const mode = p.mode === "desk" ? "desk" : "map";
  const state = obj(p.state) ? p.state : null;
  const scene = state && obj(state.scene) ? state.scene : null;
  const focus = typeof p.focus === "string" ? p.focus : null;
  const hover = typeof p.hover === "string" ? p.hover : null;
  const safeRect = obj(p.safeRect) ? p.safeRect : null;
  const theme = p.theme === "light" ? "light" : "dark";
  const still = p.still === true;
  const label = typeof p.label === "string" ? p.label : "";

  const [world, setWorld] = useState("fallback");
  const stageRef = useRef(null);
  const fbRef = useRef(null);
  const canvasRef = useRef(null);
  const lineRef = useRef(null);
  const tagsRef = useRef(null);
  const drawn = useRef(null);
  const handle = useRef(null);
  const ready = useRef(false);
  const latest = useRef(p);
  latest.current = { ...p, focus, hover, safeRect, theme, still, scene, mode };

  const sceneKey = scene ? JSON.stringify(scene) : "";
  const safeKey = rectKey(safeRect);
  const tags = tagsOf(state, { mode, focus });
  const tagKey = tags.map((t) => t.id).join(" ");

  const pick = (id) => { const f = latest.current.onPick; if (typeof f === "function") f(id); };
  const point = (id) => { const f = latest.current.onHover; if (typeof f === "function") f(id); };

  // Place every tag: where the world or the drawn picture says its anchor is, then through placeTags.
  function layoutTags() {
    const layer = tagsRef.current;
    if (!layer) return;
    const size = sizeOf(stageRef.current) || DEFAULT_SIZE;
    const s = latest.current.safeRect;
    const bounds = obj(s) && fin(s.w) && fin(s.h) && s.w > 0 && s.h > 0 ? { x: s.x || 0, y: s.y || 0, w: s.w, h: s.h } : { x: 0, y: 0, w: size.width, h: size.height };
    const els = arr(layer.childNodes).filter((c) => c.nodeType === 1);
    const boxes = [];
    const away = [];
    for (const el of els) {
      const id = el.getAttribute("data-tag");
      let at = null;
      try {
        at = ready.current && handle.current ? handle.current.project(id) : drawn.current ? drawn.current.point(id) : null;
      } catch {
        at = null;
      }
      const w = el.offsetWidth > 0 ? el.offsetWidth : Math.min(260, 16 + 6.4 * (el.getAttribute("data-chars") | 0));
      const h = el.offsetHeight > 0 ? el.offsetHeight : TAG_H;
      if (!at || at.visible === false || !fin(at.x) || !fin(at.y)) { away.push(el); continue; }
      const room = el.getAttribute("data-kind") === "room";
      boxes.push({ id, el, x: room ? at.x : at.x - w / 2, y: room ? at.y : at.y - h - 4, w, h });
    }
    for (const el of away) el.setAttribute("data-placed", "hidden");
    for (const b of placeTags(boxes, bounds)) {
      b.el.setAttribute("data-placed", b.hidden ? "hidden" : "shown");
      if (!b.hidden) b.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
    }
  }

  function frameFallback() {
    if (!drawn.current) return;
    const size = sizeOf(stageRef.current) || DEFAULT_SIZE;
    const cur = latest.current;
    drawn.current.frame({ width: size.width, height: size.height, safe: cur.safeRect, focus: cur.focus });
    drawn.current.setFocus(cur.focus);
    drawn.current.setHover(cur.hover);
  }

  // The drawn picture, at once, and again whenever the scene, the mode or the theme changes.
  useLayoutEffect(() => {
    if (!fbRef.current) return;
    drawn.current = drawFallback(fbRef.current, { mode, plan: scene ? scene.plan : null, scene: scene || {}, theme, onPick: pick, onHover: point });
    frameFallback();
    layoutTags();
  }, [sceneKey, mode, theme]);

  // Framing, the chosen room and the hovered one follow the page.
  useLayoutEffect(() => {
    frameFallback();
    layoutTags();
  }, [focus, hover, safeKey, tagKey]);

  // The world, under the conditions of D3, once per mode.
  useLayoutEffect(() => {
    let alive = true;
    const size = sizeOf(stageRef.current);
    if (!worldAllowed(envOf(size ? size.width : NaN))) { setWorld("fallback"); return undefined; }
    setWorld("loading");
    const giveUp = () => {
      if (!alive) return;
      ready.current = false;
      const h = handle.current;
      handle.current = null;
      if (h) try { h.release(); } catch { /* already gone */ }
      setWorld("fallback");
      layoutTags();
    };
    const cur = latest.current;
    const loader = typeof cur.load === "function" ? cur.load : loadWorld;
    Promise.resolve()
      .then(() => loader())
      .then((m) => {
        if (!alive) return null;
        if (!m || typeof m.acquire !== "function") throw new Error("no world");
        return m.acquire(canvasRef.current, {
          mode, tier: size.width < PHONE_BELOW ? "phone" : "desktop", theme: cur.theme, still: cur.still,
          onProgress: (v) => { const l = lineRef.current; if (l && fin(v)) l.style.transform = `scaleX(${Math.max(0, Math.min(1, v))})`; },
          onPick: (id) => pick(id),
          onHover: (id) => point(id),
          onLost: giveUp,
        });
      })
      .then((h) => {
        if (!h) return;
        if (!alive) { try { h.release(); } catch { /* gone */ } return; }
        handle.current = h;
        const now = latest.current;
        if (now.scene) h.setScene(now.scene);
        h.setTheme(now.theme);
        h.setStill(now.still);
        h.focus(now.focus);
        h.hover(now.hover);
        if (obj(now.safeRect)) h.setSafeRect(now.safeRect);
        if (typeof h.onFrame === "function") h.onFrame(() => layoutTags());
        ready.current = true;
        setWorld("ready");
        layoutTags();
      })
      .catch(giveUp);
    return () => {
      alive = false;
      ready.current = false;
      const h = handle.current;
      handle.current = null;
      if (h) try { h.release(); } catch { /* gone */ }
    };
  }, [mode]);

  // What the page says, handed on to a world that is ready.
  const tell = (fn) => {
    const h = handle.current;
    if (!h || !ready.current) return;
    try { fn(h); } catch { /* the world keeps its last picture */ }
  };
  useEffect(() => { if (scene) tell((h) => h.setScene(scene)); }, [sceneKey, world]);
  useEffect(() => tell((h) => h.focus(focus)), [focus, world]);
  useEffect(() => tell((h) => h.hover(hover)), [hover, world]);
  useEffect(() => { if (safeRect) tell((h) => h.setSafeRect(safeRect)); }, [safeKey, world]);
  useEffect(() => tell((h) => h.setTheme(theme)), [theme, world]);
  useEffect(() => tell((h) => h.setStill(still)), [still, world]);

  // A stage that changes size frames again.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof globalThis.ResizeObserver !== "function") return undefined;
    const ro = new globalThis.ResizeObserver(() => { frameFallback(); layoutTags(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const status = world === "loading" ? (mode === "desk" ? WORDS.lightingDesk : WORDS.lightingStudio) : "";
  return html`
    <div class=${`w-stage w-stage--${mode}`} ref=${stageRef} aria-hidden="true" data-world=${world} data-mode=${mode} data-theme-stage=${theme}>
      <div class="w-fallback" ref=${fbRef}></div>
      <div class="w-canvas" ref=${canvasRef}></div>
      <div class="w-tags" ref=${tagsRef}>
        ${tags.map((t) => html`<span key=${t.id} class=${`w-tag w-tag--${t.kind}`} data-tag=${t.id} data-kind=${t.kind}
            data-chars=${t.text.length + t.sub.length + 1} data-placed="hidden" title=${t.title}>
          ${t.lamp ? html`<i class=${`w-tag__lamp w-tag__lamp--${t.lamp}`}></i>` : null}<b class="w-tag__name">${t.text}</b>${t.sub ? html`<span class="w-tag__sub">${t.sub}</span>` : null}</span>`)}
      </div>
      <div class="w-line" ref=${lineRef}></div>
    </div>
    ${label ? html`<p class="u-visually-hidden">${label}</p>` : null}
    <p class="u-visually-hidden" role="status">${status}</p>`;
}

export default WorldStage;
