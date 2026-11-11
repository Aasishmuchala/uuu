// The sprite player's arithmetic, pure: no document, no window, no network. CONTRACTS-V2 20.3.
// Frame numbers here are places in the sheet's frame list, counted from 0 as the data file counts them.

const whole = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : fallback);

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;
export const SPEEDS = [0.5, 1, 2];
export const MAX_PALETTE = 64;

// The frames one pass of a tag plays, in order. A missing tag plays every frame forward.
export function sequence(tag, frameCount) {
  const count = Math.max(0, whole(frameCount));
  if (!tag) return Array.from({ length: count }, (_, i) => i);
  const from = whole(tag.from);
  const to = whole(tag.to, from);
  if (from === to) return [from];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const up = [];
  for (let i = lo; i <= hi; i++) up.push(i);
  if (tag.direction === "reverse") return up.reverse();
  if (tag.direction === "pingpong") return up.concat(up.slice(1, -1).reverse());
  return up;
}

// The place after `i` in `seq`: the next one, the first again when looping, or null at the end.
export function nextIndex(seq, i, loop) {
  const len = Array.isArray(seq) ? seq.length : 0;
  if (len === 0) return null;
  if (i + 1 < len) return i + 1;
  return loop ? 0 : null;
}

// The place before `i` in `seq`, the mirror of nextIndex.
export function prevIndex(seq, i, loop) {
  const len = Array.isArray(seq) ? seq.length : 0;
  if (len === 0) return null;
  if (i - 1 >= 0) return i - 1;
  return loop ? len - 1 : null;
}

// The largest whole zoom from 1 to 16 at which a frame fits the box.
export function fitZoom(frameW, frameH, boxW, boxH) {
  const w = Math.max(1, whole(frameW, 1));
  const h = Math.max(1, whole(frameH, 1));
  const z = Math.min(Math.floor(Number(boxW) / w), Math.floor(Number(boxH) / h));
  return clampZoom(Number.isFinite(z) ? z : MIN_ZOOM);
}

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, whole(z, MIN_ZOOM)));
}

// How long a frame stays, in milliseconds, at a speed: its own duration divided by the speed.
export function frameDelay(duration, speed) {
  const d = Math.min(60000, Math.max(10, whole(duration, 100) || 100));
  const s = Number(speed) > 0 ? Number(speed) : 1;
  return d / s;
}

// The frames drawn faintly around the current one: the previous and the next place of the sequence.
export function neighbours(seq, i, loop) {
  const p = prevIndex(seq, i, loop);
  const n = nextIndex(seq, i, loop);
  const prev = p === null || p === i ? null : seq[p];
  const next = n === null || n === i ? null : seq[n];
  return { prev, next };
}

// The place in `seq` to start from, for a frame number from the address (counted from 1, as shown).
export function startPlace(seq, frameNumber) {
  const n = whole(frameNumber, 0);
  if (!Array.isArray(seq) || seq.length === 0 || n < 1) return 0;
  const at = seq.indexOf(n - 1);
  return at < 0 ? 0 : at;
}

// Which tag the address names: its place in `tags`, or -1 for every frame.
export function tagPlace(tags, name) {
  if (!Array.isArray(tags) || name === undefined || name === null || name === "") return -1;
  return tags.findIndex((t) => t && t.name === String(name));
}

// What a key does while the player has focus.
export function keyAction(key) {
  switch (key) {
    case " ":
    case "Spacebar":
      return "toggle";
    case "ArrowLeft":
      return "prev";
    case "ArrowRight":
      return "next";
    case "[":
      return "zoomOut";
    case "]":
      return "zoomIn";
    default:
      return null;
  }
}

// The canvas's text alternative: the title, the frame number and the tag.
export function describeFrame({ title, frame, total, tag }) {
  const name = String(title || "Sprite").slice(0, 120);
  const which = `frame ${whole(frame) + 1} of ${Math.max(0, whole(total))}`;
  const part = tag ? `animation ${String(tag).slice(0, 60)}` : "all frames";
  return `${name}, ${which}, ${part}`;
}

// A palette entry is shown only when it is a plain colour such as #1b1b1f.
export function safeColours(palette) {
  if (!Array.isArray(palette)) return [];
  return palette.filter((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c)).slice(0, MAX_PALETTE);
}

// The canvas size for a zoom: the widest and tallest frame, times the zoom.
export function stageSize(frames, zoom) {
  let w = 1;
  let h = 1;
  for (const f of Array.isArray(frames) ? frames : []) {
    if (!f) continue;
    w = Math.max(w, whole(f.w, 1));
    h = Math.max(h, whole(f.h, 1));
  }
  const z = clampZoom(zoom);
  return { w: w * z, h: h * z, frameW: w, frameH: h };
}
