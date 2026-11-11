// The sprite player: one sprite drawn from its sheet on a canvas, played frame by frame. CONTRACTS-V2 20.3.
// `frames` and `tags` come from shape `sprite`; `initialTag` and `initialFrame` come from the address through
// the Studio page (frame numbers there count from 1, as shown here). The sheet is loaded as an image only.
import { html, useCallback, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { Button, Empty, ErrorNotice, FileCard, Loading, Tabs } from "../kit/index.js";
import {
  SPEEDS,
  clampZoom,
  describeFrame,
  fitZoom,
  frameDelay,
  keyAction,
  neighbours,
  nextIndex,
  prevIndex,
  safeColours,
  sequence,
  stageSize,
  startPlace,
  tagPlace,
} from "./sprite-math.js";

const MAX_FRAMES = 1024;
const STAGE_W = 480;
const STAGE_H = 320;
const THUMB = 48;
const ALL = "all-frames";
const tagId = (i) => `tag-${i}`;
const text = (v, max = 120) => (v === null || v === undefined ? "" : String(v).slice(0, max));

function keyOf(value) {
  try {
    return JSON.stringify(Array.isArray(value) ? value.slice(0, MAX_FRAMES) : null);
  } catch {
    return "";
  }
}

function reducedMotion() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Only whole, in-range numbers reach the canvas.
function cleanFrames(frames) {
  const n = (v, lo, hi, fallback) => {
    const x = Math.trunc(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
  };
  return (Array.isArray(frames) ? frames.slice(0, MAX_FRAMES) : []).map((f) => ({
    x: n(f && f.x, 0, 16384, 0),
    y: n(f && f.y, 0, 16384, 0),
    w: n(f && f.w, 1, 16384, 1),
    h: n(f && f.h, 1, 16384, 1),
    duration: n(f && f.duration, 10, 60000, 100),
  }));
}

function cleanTags(tags, count) {
  return (Array.isArray(tags) ? tags.slice(0, 256) : [])
    .filter((t) => t && typeof t.name === "string" && Number.isInteger(t.from) && Number.isInteger(t.to))
    .filter((t) => t.from >= 0 && t.to >= t.from && t.to < count)
    .map((t) => ({ name: text(t.name, 60), from: t.from, to: t.to, direction: t.direction }));
}

function drawFrame(ctx, img, f, zoom) {
  if (!f) return;
  ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w * zoom, f.h * zoom);
}

function Thumb({ img, frame, number, current, onPick }) {
  const ref = useRef(null);
  const zoom = Math.max(1, Math.floor(THUMB / Math.max(frame.w, frame.h)));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !img) return;
    canvas.width = frame.w * zoom;
    canvas.height = frame.h * zoom;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(ctx, img, frame, zoom);
  }, [img, frame, zoom]);
  return html`<li class="p-sprite-player__thumb-item">
    <button type="button" class=${`p-sprite-player__thumb${current ? " is-current" : ""}`} aria-pressed=${current ? "true" : "false"}
      aria-label=${`Frame ${number}, ${frame.duration} milliseconds`} onClick=${onPick}>
      <canvas ref=${ref} class="p-sprite-player__thumb-canvas" aria-hidden="true"></canvas>
      <span class="p-sprite-player__thumb-number">${number}</span>
      <span class="p-sprite-player__thumb-time">${frame.duration} ms</span>
    </button>
  </li>`;
}

export function SpritePlayer({ sheetUrl, frames, tags, palette, title, gif, initialTag, initialFrame }) {
  // Keyed by content, so the same sprite fetched again does not move the player.
  const framesKey = keyOf(frames);
  const tagsKey = keyOf(tags);
  const list = useMemo(() => cleanFrames(frames), [framesKey]);
  const named = useMemo(() => cleanTags(tags, list.length), [tagsKey, list.length]);
  const colours = useMemo(() => safeColours(palette), [palette]);
  const size = useMemo(() => stageSize(list, 1), [list]);
  const name = text(title) || "Sprite";

  const [tagAt, setTagAt] = useState(() => tagPlace(named, initialTag));
  const seq = useMemo(() => (tagAt >= 0 && named[tagAt] ? sequence(named[tagAt], list.length) : sequence(null, list.length)), [tagAt, named, list.length]);
  const [place, setPlace] = useState(() => startPlace(seq, initialFrame));
  // It plays at once, unless motion is reduced or the address asks for one frame.
  const [playing, setPlaying] = useState(() => !reducedMotion() && !(Number(initialFrame) >= 1));
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [onion, setOnion] = useState(false);
  const [zoom, setZoom] = useState(() => fitZoom(size.frameW, size.frameH, STAGE_W, STAGE_H));
  const [sheet, setSheet] = useState({ state: "loading", img: null });
  const [attempt, setAttempt] = useState(0);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const fitted = useRef(false);

  // A new address (another tag or frame) moves the player there.
  useEffect(() => {
    const i = tagPlace(named, initialTag);
    setTagAt(i);
    setPlace(startPlace(sequence(i >= 0 ? named[i] : null, list.length), initialFrame));
  }, [initialTag, initialFrame, named, list.length]);

  const at = Math.min(place, Math.max(0, seq.length - 1));
  const frameNo = seq.length ? seq[at] : 0;
  const tagName = tagAt >= 0 && named[tagAt] ? named[tagAt].name : "";

  // The sheet, as an image only. Nothing is drawn before it has loaded.
  useEffect(() => {
    if (!sheetUrl || typeof Image === "undefined") {
      setSheet({ state: "error", img: null });
      return undefined;
    }
    let alive = true;
    setSheet({ state: "loading", img: null });
    const img = new Image();
    img.decoding = "async";
    img.onload = () => alive && setSheet({ state: "ready", img });
    img.onerror = () => alive && setSheet({ state: "error", img: null });
    img.src = String(sheetUrl);
    return () => {
      alive = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [sheetUrl, attempt]);

  // Once the stage is on screen, the largest whole zoom that fits its width.
  useEffect(() => {
    if (fitted.current || sheet.state !== "ready" || !stageRef.current) return;
    fitted.current = true;
    const w = stageRef.current.clientWidth || STAGE_W;
    setZoom(fitZoom(size.frameW, size.frameH, Math.max(w - 16, size.frameW), STAGE_H));
  }, [sheet.state, size.frameW, size.frameH]);

  // Draw the current frame, with the onion skin when it is on.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = sheet.img;
    if (!canvas || !img || sheet.state !== "ready" || !seq.length) return;
    const dims = stageSize(list, zoom);
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const near = onion ? neighbours(seq, at, loop) : { prev: null, next: null };
    if (near.prev !== null) {
      ctx.globalAlpha = 0.3;
      drawFrame(ctx, img, list[near.prev], zoom);
    }
    ctx.globalAlpha = 1;
    drawFrame(ctx, img, list[seq[at]], zoom);
    if (near.next !== null) {
      ctx.globalAlpha = 0.3;
      drawFrame(ctx, img, list[near.next], zoom);
    }
    ctx.globalAlpha = 1;
  }, [sheet, list, seq, at, zoom, onion, loop]);

  // Playing: each frame stays for its own duration divided by the speed.
  const placeRef = useRef(at);
  placeRef.current = at;
  useEffect(() => {
    if (!playing || sheet.state !== "ready" || seq.length < 2 || typeof requestAnimationFrame !== "function") return undefined;
    let handle = 0;
    let since = null;
    const tick = (now) => {
      if (since === null) since = now;
      const here = placeRef.current;
      const wait = frameDelay(list[seq[here]] ? list[seq[here]].duration : 100, speed);
      if (now - since >= wait) {
        const next = nextIndex(seq, here, loop);
        if (next === null) {
          setPlaying(false);
          return;
        }
        since = now - Math.min(now - since - wait, wait);
        placeRef.current = next;
        setPlace(next);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, sheet.state, seq, list, speed, loop]);

  const step = useCallback(
    (dir) => {
      setPlaying(false);
      const to = dir < 0 ? prevIndex(seq, at, true) : nextIndex(seq, at, true);
      if (to !== null) setPlace(to);
    },
    [seq, at],
  );

  const togglePlay = useCallback(() => {
    if (!playing && nextIndex(seq, at, loop) === null) setPlace(0);
    setPlaying(!playing);
  }, [playing, seq, at, loop]);

  const pickTag = (id) => {
    const i = id === ALL ? -1 : named.findIndex((_, k) => tagId(k) === id);
    setTagAt(i);
    setPlace(0);
  };

  const pickFrame = (i) => {
    setPlaying(false);
    const inSeq = seq.indexOf(i);
    if (inSeq >= 0) {
      setPlace(inSeq);
      return;
    }
    setTagAt(-1);
    setPlace(i);
  };

  const onKeyDown = (event) => {
    const action = keyAction(event.key);
    if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const tagNameOf = target && target.tagName ? String(target.tagName).toLowerCase() : "";
    if (tagNameOf === "input" || tagNameOf === "textarea" || tagNameOf === "select") return;
    if (target && typeof target.closest === "function" && target.closest('[role="tablist"]')) return;
    // A focused button keeps Space for itself.
    if (action === "toggle" && (tagNameOf === "button" || tagNameOf === "a")) return;
    event.preventDefault();
    if (action === "toggle") togglePlay();
    else if (action === "prev") step(-1);
    else if (action === "next") step(1);
    else if (action === "zoomOut") setZoom((z) => clampZoom(z - 1));
    else if (action === "zoomIn") setZoom((z) => clampZoom(z + 1));
  };

  if (!list.length) {
    return html`<div class="p-sprite-player">
      <${Empty} title="No frames" text="This sprite has no frames to show." />
    </div>`;
  }

  const tabs = [{ id: ALL, label: "All frames", count: list.length }].concat(
    named.map((t, i) => ({ id: tagId(i), label: t.name, count: t.to - t.from + 1 })),
  );
  const alt = describeFrame({ title: name, frame: frameNo, total: list.length, tag: tagName });
  const ready = sheet.state === "ready";

  return html`<div class="p-sprite-player" onKeyDown=${onKeyDown}>
    <${Tabs} tabs=${tabs} current=${tagAt >= 0 ? tagId(tagAt) : ALL} onChange=${pickTag} label="Animations" />

    <div class="p-sprite-player__stage" ref=${stageRef} tabindex="0" role="group" aria-label=${`${name} player. Space plays or pauses, the arrow keys step, the square brackets zoom.`}>
      ${sheet.state === "error"
        ? html`<${ErrorNotice} error=${new Error("The sheet could not be loaded.")} onRetry=${() => setAttempt((n) => n + 1)} />`
        : ready
          ? html`<canvas ref=${canvasRef} class="p-sprite-player__canvas" role="img" aria-label=${alt}>${alt}</canvas>`
          : html`<${Loading} lines=${2} label="Loading the sprite" />`}
    </div>

    <p class="p-sprite-player__where">
      <span class="p-sprite-player__frame-no">Frame ${frameNo + 1} of ${list.length}</span>
      <span class="p-sprite-player__where-tag">${tagName || "All frames"}</span>
      <span class="p-sprite-player__where-zoom">${zoom}×</span>
    </p>

    <div class="p-sprite-player__controls" role="group" aria-label="Playback">
      <${Button} variant="plain" onClick=${() => step(-1)} disabled=${!ready}>Previous frame</${Button}>
      <${Button} variant="primary" icon=${playing ? "pause" : "play"} onClick=${togglePlay} disabled=${!ready}>${playing ? "Pause" : "Play"}</${Button}>
      <${Button} variant="plain" onClick=${() => step(1)} disabled=${!ready}>Next frame</${Button}>
      <button type="button" class=${`p-sprite-player__toggle p-sprite-player__toggle--md${loop ? " is-on" : ""}`} aria-pressed=${loop ? "true" : "false"} onClick=${() => setLoop(!loop)}>
        Loop ${loop ? "on" : "off"}
      </button>
      <button type="button" class=${`p-sprite-player__toggle p-sprite-player__toggle--md${onion ? " is-on" : ""}`} aria-pressed=${onion ? "true" : "false"} onClick=${() => setOnion(!onion)}>
        Onion skin ${onion ? "on" : "off"}
      </button>
    </div>

    <div class="p-sprite-player__controls" role="group" aria-label="Speed and zoom">
      <span class="p-sprite-player__label">Speed</span>
      ${SPEEDS.map(
        (s) => html`<button type="button" class=${`p-sprite-player__toggle${speed === s ? " is-on" : ""}`} aria-pressed=${speed === s ? "true" : "false"}
          aria-label=${`Speed ${s} times`} onClick=${() => setSpeed(s)}>${s}×</button>`,
      )}
      <span class="p-sprite-player__label">Zoom</span>
      <button type="button" class="p-sprite-player__toggle" aria-label="Zoom out" disabled=${zoom <= 1} onClick=${() => setZoom((z) => clampZoom(z - 1))}>−</button>
      <span class="p-sprite-player__zoom">${zoom}×</span>
      <button type="button" class="p-sprite-player__toggle" aria-label="Zoom in" disabled=${zoom >= 16} onClick=${() => setZoom((z) => clampZoom(z + 1))}>+</button>
    </div>

    <section class="p-sprite-player__part" aria-label="Frames">
      <h3 class="p-sprite-player__heading">Frames</h3>
      <ol class="p-sprite-player__strip">
        ${list.map(
          (f, i) => html`<${Thumb} key=${i} img=${ready ? sheet.img : null} frame=${f} number=${i + 1} current=${i === frameNo} onPick=${() => pickFrame(i)} />`,
        )}
      </ol>
    </section>

    ${colours.length
      ? html`<section class="p-sprite-player__part" aria-label="Colours">
          <h3 class="p-sprite-player__heading">Colours</h3>
          <ul class="p-sprite-player__palette">
            ${colours.map(
              (c) => html`<li class="p-sprite-player__colour">
                <span class="p-sprite-player__swatch" style=${`background-color: ${c}`} aria-hidden="true"></span>
                <span class="p-sprite-player__hex">${c.toLowerCase()}</span>
              </li>`,
            )}
          </ul>
        </section>`
      : null}

    ${gif
      ? html`<section class="p-sprite-player__part" aria-label="Animation file">
          <h3 class="p-sprite-player__heading">Animation file</h3>
          <${FileCard} file=${gif} />
        </section>`
      : null}
  </div>`;
}

export default SpritePlayer;
