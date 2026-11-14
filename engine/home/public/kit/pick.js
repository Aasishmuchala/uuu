// PickCard (PLAN-V5 K9, T20): the moment the owner chooses between versions of one piece. The versions stand side by
// side when the card is wide enough and one at a time, with a lettered stepper and a swipe, when it is not. Each
// shows its direction's name, the piece itself (a picture as a picture that opens larger, a draft as readable
// text), the home server's own brand check as one line, the Art director's seven scores with the total out of 70
// and its one-line reason, and one "Pick this one". Under them: an optional note, "Another round" and "Send all
// back" (a note needed). The scores inform: nothing is preselected or ranked, versions stay in a to c order.
// Nothing an agent wrote is ever set as HTML: a direction's title, a draft's text, a reason and a brand line are
// text nodes; a picture comes only from the `/api/view/<token>` address the server gave, or for a page from the home
// server's own kept picture, `/api/sites/shot/<key>/<name>` (PLAN-V5 C21).
// Acts through POST /api/inbox/act with the item's version and `variant` (a, b or c) for a pick.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { when } from "../lib/format.js";
import { Button } from "./button.js";
import { actBody, DecisionCard, isChangedSinceSeen, reloadInboxItem } from "./decision.js";
import { Icon } from "./icon.js";
import { Dialog } from "./overlays.js";
import { segStep } from "./segmented.js";
import { StatusDot } from "./status.js";
import { Tag } from "./tag.js";
import { Mono } from "./text.js";
import { cx, nextId } from "./util.js";

// ---- Words (rule 9: plain, short; the server's own sentences win where it sends them) ----

export const PICK_WORDS = {
  pick: "Pick this one",
  another: "Another round",
  back: "Send all back",
  noteLabel: "Your note",
  noteHint: "Say why, in a few words: your agents read this next time.",
  needNote: "Send all back needs a note. Say what none of them got right.",
  below: "Below the bar",
  belowAsk: "This version is below the bar the Art director holds. Pick it anyway?",
  yesPick: "Yes, pick it",
  missing: "This version's files are missing.",
  missingNext: "It cannot be picked.",
  noReview: "Not scored yet. The Art director has not looked at this round.",
  noPreview: "Nothing to show for this version yet.",
  picked: "Picked. Your choice and note are kept for next time.",
  youPicked: "You picked this one",
  changed: "These versions changed since you looked. Read them again.",
  changedNext: "Look at the versions again, then decide.",
  readAll: "Read all",
  readLess: "Show less",
  versions: "Versions",
  pickLead: "Pick one to accept this task. Your note goes with whatever you press.",
  pickNudge: "This task is accepted by picking one of its versions.",
  goPick: "Go to the versions",
};

export const BRAND_WORDS = {
  pass: "Fits your brand kit",
  noKit: "No brand kit yet, so colours and type were not checked",
  running: "Still checking against your brand kit",
  unknown: "Could not be checked",
  openKit: "Open the brand kit",
};

// The server's own lines that mean something to this card (lib/brandcheck.mjs SAY).
const KIT_MISSING = /^There is no brand kit yet/;
const STILL_RUNNING = /^The brand check is still running/;

const AXES = [
  ["brand", "Brand"],
  ["hierarchy", "Hierarchy"],
  ["composition", "Composition"],
  ["finish", "Finish"],
  ["idea", "Idea"],
  ["voice", "Voice"],
  ["kind", null],
];
// The seventh axis is the kind's own (K8): what it asks of that kind of piece, in one word.
const KIND_AXIS = { carousel: "Sequence", poster: "Sequence", post: "Flow", newsletter: "Flow", "title-card": "Motion", film: "Motion", page: "Screens" };

const ID = /^(?:[abc]|piece)$/;
const VIEW_URL = /^\/api\/view\/[A-Za-z0-9_-]{1,4096}$/;
const TEXT_FOLD_CHARS = 420;
const TEXT_FOLD_LINES = 9;
const BRAND_SHOWN = 2;

const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => {
  const s = text(v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// ---- Pure helpers (tested in test/kit-pick.test.mjs) ----

// True for a Needs-you item that is a card of versions to pick from (kind "pick" with its variants).
export function isPickItem(item) {
  return Boolean(item && typeof item === "object" && item.kind === "pick" && list(item.variants).some((v) => v && ID.test(text(v.id))));
}

// The seven axes in words, the seventh named for the kind of piece.
export function axisWords(kind) {
  return AXES.map(([key, label]) => ({ key, label: label || (Object.hasOwn(KIND_AXIS, kind) ? KIND_AXIS[kind] : "Its kind") }));
}

const score = (n) => (Number.isInteger(n) && n >= 0 && n <= 10 ? n : null);

// The Art director's review as the card shows it: one row per axis (0 to 10, or null), the total out of 70, whether
// it meets the bar (from the server's `meets`, worked out there from the numbers), and the reason as one line.
// null when there is no review.
export function scoreRows(review, kind) {
  if (!review || typeof review !== "object") return null;
  const scores = review.scores && typeof review.scores === "object" ? review.scores : {};
  const rows = axisWords(kind).map((a) => ({ ...a, value: score(Object.hasOwn(scores, a.key) ? scores[a.key] : null) }));
  const sum = rows.reduce((n, r) => n + (r.value ?? 0), 0);
  const total = Number.isInteger(review.total) && review.total >= 0 && review.total <= 70 ? review.total : sum;
  return { rows, total, of: 70, meets: review.meets === true, below: review.meets === false, reason: cap(review.reason, 200) };
}

// True when the owner should be asked once before picking: the Art director's numbers put it below the bar.
export function belowBar(review) {
  return Boolean(review && typeof review === "object" && review.meets === false);
}

// The brand check as one plain line: { tone, text, lines, kit, running }. `lines` are the server's reasons (the
// kit-missing line is said by `kit` instead, with a link to the kit page).
export function brandLine(brand) {
  const b = brand && typeof brand === "object" ? brand : {};
  const all = list(b.lines).filter((l) => typeof l === "string" && l.trim()).slice(0, 10).map((l) => cap(l, 300));
  const kit = all.some((l) => KIT_MISSING.test(l));
  const lines = all.filter((l) => !KIT_MISSING.test(l));
  const n = lines.length;
  if (b.result === "pass") return { tone: "ok", text: BRAND_WORDS.pass, lines, kit, running: false };
  if (b.result === "warn") {
    if (!n && kit) return { tone: "warn", text: BRAND_WORDS.noKit, lines, kit, running: false };
    return { tone: "warn", text: `Brand check: ${n <= 1 ? "1 thing" : `${n} things`} to look at`, lines, kit, running: false };
  }
  if (b.result === "fail") return { tone: "bad", text: `Brand check: ${n <= 1 ? "1 thing" : `${n} things`} to fix`, lines, kit, running: false };
  if (b.result === "unknown" && all.some((l) => STILL_RUNNING.test(l))) return { tone: "wait", text: BRAND_WORDS.running, lines: [], kit: false, running: true };
  return { tone: "off", text: BRAND_WORDS.unknown, lines, kit, running: false };
}

// The versions in a to c order (never by score), each { id, letter, title, direction, preview, brand, review,
// missing }. Ids the server lists as missing come in as versions that cannot be picked.
export function versionsOf(src) {
  const seen = new Set();
  const out = [];
  for (const v of list(src && src.variants)) {
    if (!v || typeof v !== "object" || !ID.test(text(v.id)) || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({ ...v, missing: false });
  }
  for (const id of list(src && src.missing)) {
    if (typeof id !== "string" || !ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, direction: null, preview: [], brand: null, review: null, missing: true });
  }
  return out
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((v) => ({ ...v, letter: letterOf(v.id), title: titleOf(v) }));
}

// "A", "B", "C"; a single piece has no letter.
export function letterOf(id) {
  return id === "piece" ? "" : text(id).toUpperCase();
}

function titleOf(v) {
  const t = cap(v && v.direction && v.direction.title, 80);
  if (t) return t;
  return v && v.id === "piece" ? "Your piece" : `Version ${letterOf(v && v.id)}`;
}

// A picture's address only when it is the server's own viewer address, or exactly the address of a page's kept
// picture (PLAN-V5 C21: a 64-hex key and a shot's name, nothing more); anything else is not shown.
const SHOT_URL = /^\/api\/sites\/shot\/[0-9a-f]{64}\/shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;
export function safeViewUrl(url) {
  return typeof url === "string" && (VIEW_URL.test(url) || SHOT_URL.test(url)) ? url : null;
}

// What a version shows: its pictures (server addresses only) and its text (as text).
export function previewParts(preview) {
  const images = [];
  let body = "";
  for (const p of list(preview).slice(0, 12)) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "image") {
      const url = safeViewUrl(p.url);
      if (url) images.push(url);
    } else if (p.type === "text" && !body && typeof p.text === "string") {
      body = p.text.slice(0, 2000).trim();
    }
  }
  return { images, text: body };
}

// Whether a draft's text is long enough to fold behind "Read all".
export function foldsText(t) {
  const s = text(t);
  return s.length > TEXT_FOLD_CHARS || s.split("\n").length > TEXT_FOLD_LINES;
}

// The body of POST /api/inbox/act: the item, the action, the note, the version the owner saw, and for a pick the
// version's id.
export function pickBody(item, action, note, variant) {
  const body = actBody(item && item.id, action, note || "", item && item.version);
  if (action === "pick" && ID.test(text(variant)) && variant !== "piece") body.variant = variant;
  return body;
}

// The stepper's place from the strip's scroll: the version most in view.
export function stepAt(scrollLeft, width, count) {
  const n = Math.floor(Number(count) || 0);
  const w = Number(width);
  if (n <= 0 || !(w > 0)) return 0;
  return Math.max(0, Math.min(n - 1, Math.round((Number(scrollLeft) || 0) / w)));
}

// ---- Parts ----

export function BrandRow({ brand }) {
  const [all, setAll] = useState(false);
  const b = brandLine(brand);
  const shown = all ? b.lines : b.lines.slice(0, BRAND_SHOWN);
  return html`<div class=${cx("k-pick__brand", `k-pick__brand--${b.tone}`)}>
    <${StatusDot} tone=${b.tone} label=${b.text} pulse=${b.running} />
    ${shown.length > 0 && html`<ul class="k-pick__brand-lines">${shown.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>`}
    ${b.lines.length > BRAND_SHOWN && html`<button type="button" class="k-pick__more" aria-expanded=${all ? "true" : "false"}
      onClick=${() => setAll(!all)}>${all ? "Show fewer" : `Show all ${b.lines.length}`}</button>`}
    ${b.kit && html`<a class="k-pick__link" href="#/files/brand-kit">${BRAND_WORDS.openKit}</a>`}
  </div>`;
}

export function Scores({ review, kind }) {
  const s = scoreRows(review, kind);
  if (!s) return html`<p class="k-pick__unscored"><${Icon} name="clock" size=${14} /><span>${PICK_WORDS.noReview}</span></p>`;
  return html`<div class="k-pick__review">
    <p class="k-pick__total-by">The Art director's scores</p>
    <div class="k-pick__total">
      <span class="k-pick__total-n">${s.total}</span>
      <span class="k-pick__total-of">of ${s.of}</span>
      ${s.below && html`<${Tag} tone="warn">${PICK_WORDS.below}<//>`}
    </div>
    ${s.reason && html`<p class="k-pick__reason">${s.reason}</p>`}
    <dl class="k-pick__axes">
      ${s.rows.map((r) => html`<div key=${r.key} class=${cx("k-pick__axis", r.value !== null && r.value < 6 && "k-pick__axis--low")}>
        <dt>${r.label}</dt>
        <dd>
          <span class="k-pick__bar" aria-hidden="true"><span class="k-pick__fill" style=${{ width: `${(r.value ?? 0) * 10}%` }}></span></span>
          <span class="k-pick__n">${r.value === null ? "–" : r.value}<span class="k-sr"> of 10</span></span>
        </dd>
      </div>`)}
    </dl>
  </div>`;
}

function Pictures({ images, label }) {
  const [open, setOpen] = useState(-1);
  if (!images.length) return null;
  const n = images.length;
  const at = open < 0 ? 0 : Math.min(open, n - 1);
  return html`<div class="k-pick__pictures">
    <button type="button" class="k-pick__shot" onClick=${() => setOpen(0)} aria-label=${`${label}: open the picture larger`}>
      <img src=${images[0]} alt="" decoding="async" />
      <span class="k-pick__zoom" aria-hidden="true"><${Icon} name="external" size=${14} /></span>
    </button>
    ${n > 1 && html`<div class="k-pick__thumbs">
      ${images.slice(1, 6).map((src, i) => html`<button type="button" key=${src} class="k-pick__thumb" onClick=${() => setOpen(i + 1)}
        aria-label=${`${label}: open picture ${i + 2} of ${n} larger`}><img src=${src} alt="" loading="lazy" decoding="async" /></button>`)}
    </div>`}
    <${Dialog} open=${open >= 0} title=${n > 1 ? `${label}: picture ${at + 1} of ${n}` : label} size="lg" onClose=${() => setOpen(-1)}
      footer=${n > 1 ? html`<div class="k-pick__dialog-nav">
        <${Button} variant="plain" icon="arrow-left" disabled=${at === 0} onClick=${() => setOpen(at - 1)}>Previous<//>
        <${Button} variant="plain" icon="arrow-right" disabled=${at === n - 1} onClick=${() => setOpen(at + 1)}>Next<//>
      </div>` : null}>
      <figure class="k-pick__large"><img src=${images[at]} alt=${`${label}, picture ${at + 1} of ${n}`} decoding="async" /></figure>
    <//>
  </div>`;
}

function Words({ body, id }) {
  const [open, setOpen] = useState(false);
  const folds = foldsText(body);
  return html`<div class="k-pick__words">
    <div id=${id} class=${cx("k-pick__text", folds && !open && "k-pick__text--folded")}>${body}</div>
    ${folds && html`<button type="button" class="k-pick__more" aria-expanded=${open ? "true" : "false"} aria-controls=${id}
      onClick=${() => setOpen(!open)}>${open ? PICK_WORDS.readLess : PICK_WORDS.readAll}</button>`}
  </div>`;
}

function Preview({ v, baseId }) {
  const p = previewParts(v.preview);
  const label = v.letter ? `Version ${v.letter}: ${v.title}` : v.title;
  if (!p.images.length && !p.text) return html`<p class="k-pick__none">${PICK_WORDS.noPreview}</p>`;
  return html`<div class="k-pick__preview">
    <${Pictures} images=${p.images} label=${label} />
    ${p.text && html`<${Words} body=${p.text} id=${`${baseId}-text`} />`}
  </div>`;
}

function Head({ v, level, picked }) {
  const H = `h${Math.min(Math.max(level, 2), 6)}`;
  return html`<div class="k-pick__head">
    ${v.letter && html`<span class="k-pick__letter" aria-hidden="true">${v.letter}</span>`}
    <div class="k-pick__names">
      <${H} class="k-pick__name">${v.letter ? html`<span class="k-sr">Version ${v.letter}: </span>` : null}${v.title}<//>
    </div>
    ${picked && html`<${Tag} tone="ok">${PICK_WORDS.youPicked}<//>`}
  </div>`;
}

function Version({ v, kind, level, baseId, readOnly, picked, busy, stopped, confirming, onPick, onConfirm, onCancel, yesRef }) {
  const id = `${baseId}-${v.id}`;
  if (v.missing) {
    return html`<li class="k-pick__version k-pick__version--missing" id=${id}>
      <${Head} v=${v} level=${level} />
      <p class="k-pick__none k-pick__none--missing"><${Icon} name="alert" size=${14} /><span>${PICK_WORDS.missing}</span></p>
      <p class="k-pick__caption">${PICK_WORDS.missingNext}</p>
    </li>`;
  }
  const mine = busy && busy.action === "pick" && busy.variant === v.id;
  return html`<li class=${cx("k-pick__version", picked && "k-pick__version--picked")} id=${id}>
    <${Head} v=${v} level=${level} picked=${picked} />
    <${Preview} v=${v} baseId=${id} />
    <${BrandRow} brand=${v.brand} />
    <${Scores} review=${v.review} kind=${kind} />
    ${!readOnly && html`<div class="k-pick__choose">
      ${confirming
        ? html`<div class="k-pick__confirm" role="group" aria-label="Confirm the pick"
            onKeyDown=${(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
            <p>${PICK_WORDS.belowAsk}</p>
            <div class="k-pick__row">
              <${Button} variant="primary" busy=${mine} disabled=${stopped} ref=${yesRef} onClick=${() => onConfirm(v)}>${PICK_WORDS.yesPick}<//>
              <${Button} variant="quiet" disabled=${mine} onClick=${onCancel}>Cancel<//>
            </div>
          </div>`
        : html`<${Button} variant="primary" class="k-pick__button" busy=${mine} disabled=${stopped}
            aria-label=${v.letter ? `${PICK_WORDS.pick}: version ${v.letter}, ${v.title}` : undefined} onClick=${(e) => onPick(v, e)}>${PICK_WORDS.pick}<//>`}
    </div>`}
  </li>`;
}

// The stepper of a narrow card: one button per version, the one in view pressed. Left and Right move along.
export function Steps({ versions, current, onStep, baseId }) {
  const onKeyDown = (event) => {
    const next = segStep(current, versions.length, event.key);
    if (next < 0) return;
    event.preventDefault();
    onStep(next, true);
  };
  return html`<div class="k-pick__steps" role="group" aria-label="Versions, one at a time" onKeyDown=${onKeyDown}>
    ${versions.map((v, i) => html`<button type="button" key=${v.id} class="k-pick__step" data-step=${i}
      aria-pressed=${i === current ? "true" : "false"} aria-controls=${`${baseId}-${v.id}`} onClick=${() => onStep(i, false)}>
      <span class="k-pick__step-letter" aria-hidden="true">${v.letter || i + 1}</span>
      <span class="k-pick__step-name">${v.missing ? "Missing" : v.title}</span>
    </button>`)}
  </div>`;
}

// What the card becomes after an action: the server's message, and for a pick the version chosen.
export function PickDone({ done, focus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (focus && ref.current && typeof ref.current.focus === "function") ref.current.focus(); }, []);
  if (!done) return null;
  const v = done.version || null;
  const shot = v ? previewParts(v.preview).images[0] || null : null;
  return html`<div class="k-pick k-pick--done" role="status" tabindex="-1" ref=${ref}>
    ${shot && html`<img class="k-pick__done-shot" src=${shot} alt="" loading="lazy" decoding="async" />`}
    <div class="k-pick__done-text">
      ${done.title && html`<p class="k-pick__done-title">${done.title}</p>`}
      ${v && done.action === "pick" && html`<p class="k-pick__done-choice"><${Icon} name="check" size=${14} /><span>${v.letter ? `You picked ${v.letter}: ${v.title}` : `You picked ${v.title}`}</span></p>`}
      <p class="k-pick__done-message">${text(done.message)}</p>
    </div>
  </div>`;
}

// PickCard({ item, onDone, compact, bare, level, focusDone }) for a Needs-you item of kind "pick", or
// PickCard({ pieces, readOnly: true, picked, bare, level }) for a task's versions as GET /api/tasks/:id/pieces
// gives them. `bare` leaves out the card's own title (the task page has one). `picked` is the id the owner chose.
export function PickCard({ item = null, pieces = null, onDone, compact = false, bare = false, readOnly = false, picked = null, level = 4, focusDone = true }) {
  const [baseId] = useState(() => nextId("k-pick"));
  const [note, setNote] = useState("");
  const [needNote, setNeedNote] = useState(false);
  const [busy, setBusy] = useState(null); // { action, variant } while the server answers
  const [error, setError] = useState(null);
  const [confirmFor, setConfirmFor] = useState(null);
  const [done, setDone] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [reloading, setReloading] = useState(false);
  const [gone, setGone] = useState(false);
  const [current, setCurrent] = useState(0);
  const noteRef = useRef(null);
  const yesRef = useRef(null);
  const track = useRef(null);
  const opener = useRef(null);
  const changed = isChangedSinceSeen(error);

  const propVersion = item ? item.version : undefined;
  useEffect(() => { setFresh(null); setGone(false); }, [propVersion]);

  // "Changed since you looked": the confirm closes (the note stays) and the item is read again, so the owner sees
  // the versions as they are now. Nothing is sent again.
  const itemId = item ? item.id : null;
  useEffect(() => {
    if (!changed || !itemId || readOnly) return undefined;
    let live = true;
    setConfirmFor(null);
    setReloading(true);
    reloadInboxItem(itemId)
      .then((now) => { if (!live) return; if (now && isPickItem(now)) setFresh(now); else setGone(true); })
      .catch(() => {})
      .finally(() => { if (live) setReloading(false); });
    return () => { live = false; };
  }, [changed, error]);

  useEffect(() => {
    const yes = yesRef.current;
    const el = yes && (yes.base || yes);
    if (confirmFor && el && typeof el.focus === "function") el.focus();
  }, [confirmFor]);

  const shown = readOnly ? null : fresh && item && fresh.id === item.id ? fresh : item;
  const src = shown || pieces;
  if (!src) return null;
  if (done) return html`<${PickDone} done=${done} focus=${focusDone} />`;

  const kind = shown ? shown.pieceKind : pieces && pieces.kind;
  const versions = versionsOf(src);
  const pickable = versions.filter((v) => !v.missing);
  const round = Number.isInteger(src.round) ? src.round : null;
  const stopped = Boolean(busy) || reloading || gone;
  const n = versions.length;

  const send = async (action, variant) => {
    if (!shown || stopped) return;
    const words = note.trim();
    if (action === "reopen" && !words) {
      setNeedNote(true);
      if (noteRef.current) noteRef.current.focus();
      return;
    }
    setNeedNote(false);
    setBusy({ action, variant: variant || null });
    setError(null);
    try {
      const res = await api.post("/api/inbox/act", pickBody(shown, action, words, variant));
      const message = text(res && res.message) || (action === "pick" ? PICK_WORDS.picked : "Done.");
      const version = variant ? versions.find((v) => v.id === variant) || null : null;
      const out = { action, variant: variant || null, message, version, title: cap(shown.title, 200), id: shown.id };
      setBusy(null);
      setConfirmFor(null);
      setNote("");
      setDone(out);
      if (onDone) onDone({ item: shown, action, variant: variant || null, message, done: out });
    } catch (e) {
      setBusy(null);
      setError(e);
      // Focus stays where the owner was: the button pressed is enabled again.
      const o = opener.current;
      const el = o && (o.base || o);
      if (el && el.isConnected !== false && typeof el.focus === "function") setTimeout(() => el.focus(), 0);
    }
  };

  const onPick = (v, ev) => {
    if (stopped) return;
    opener.current = ev && ev.currentTarget ? ev.currentTarget : null;
    if (belowBar(v.review)) { setConfirmFor(v.id); return; }
    send("pick", v.id);
  };
  const cancelConfirm = () => {
    setConfirmFor(null);
    const o = opener.current;
    if (o && o.isConnected !== false && typeof o.focus === "function") setTimeout(() => o.focus(), 0);
  };

  // The narrow strip: the stepper follows the swipe, and a step scrolls its version into view.
  const onScroll = (e) => {
    const el = e.currentTarget;
    const at = stepAt(el.scrollLeft, el.clientWidth, n);
    if (at !== current) setCurrent(at);
  };
  const onStep = (i, fromKeys) => {
    setCurrent(i);
    const el = track.current;
    const child = el && el.children ? el.children[i] : null;
    if (el && child && typeof el.scrollTo === "function") {
      const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: child.offsetLeft - el.children[0].offsetLeft, behavior: still ? "auto" : "smooth" });
    }
    if (fromKeys && typeof document !== "undefined") {
      const b = document.querySelector && document.querySelector(`#${baseId}-steps [data-step="${i}"]`);
      if (b && typeof b.focus === "function") b.focus();
    }
  };

  const context = shown ? [text(shown.raisedBy), when(shown.when)].filter(Boolean) : [];
  const noteId = `${baseId}-note`;

  return html`<article class=${cx("k-pick", compact && "k-pick--compact", bare && "k-pick--bare", readOnly && "k-pick--read")}
      aria-label=${shown ? text(shown.title) : PICK_WORDS.versions} aria-busy=${busy ? "true" : undefined}>
    ${!bare && shown && html`<header class="k-pick__top">
      <p class="k-pick__over"><${Icon} name="layers" size=${14} /><span>${pickable.length > 1 ? `${pickable.length} versions to choose from` : "One version"}${round ? ` · round ${round}` : ""}</span></p>
      <h3 class="k-pick__title">${text(shown.title)}</h3>
      ${(context.length > 0 || shown.identifier) && html`<p class="k-pick__context">
        ${context.map((c, i) => html`${i > 0 && html`<span aria-hidden="true"> · </span>`}<span>${c}</span>`)}
        ${shown.identifier && html`${context.length > 0 && html`<span aria-hidden="true"> · </span>`}<${Mono}>${text(shown.identifier)}<//>`}
      </p>`}
      ${!compact && shown.summary && html`<p class="k-pick__summary">${text(shown.summary)}</p>`}
    </header>`}
    ${changed && html`<div class="k-pick__alert" role="alert">
      <${Icon} name="alert" />
      <div>
        <p class="k-pick__alert-title">${text(error && error.message) || PICK_WORDS.changed}</p>
        <p class="k-pick__alert-next">${reloading ? "Reading them again…" : gone ? "It is no longer waiting for you." : text(error && error.next) || PICK_WORDS.changedNext}</p>
      </div>
    </div>`}
    <div class="k-pick__stage">
      ${n > 1 && html`<div id=${`${baseId}-steps`} class="k-pick__steps-wrap"><${Steps} versions=${versions} current=${current} onStep=${onStep} baseId=${baseId} /></div>`}
      <ol class=${cx("k-pick__versions", n === 1 && "k-pick__versions--one")} style=${{ "--k-pick-n": String(Math.max(n, 1)) }}
        ref=${track} onScroll=${n > 1 ? onScroll : undefined} aria-label=${PICK_WORDS.versions}>
        ${versions.map((v) => html`<${Version} key=${v.id} v=${v} kind=${kind} level=${level} baseId=${baseId}
          readOnly=${readOnly || !shown} picked=${picked && picked === v.id} busy=${busy} stopped=${stopped}
          confirming=${confirmFor === v.id} onPick=${onPick} onConfirm=${(x) => send("pick", x.id)} onCancel=${cancelConfirm} yesRef=${yesRef} />`)}
      </ol>
    </div>
    ${!readOnly && shown && html`<div class="k-pick__foot"><div class="k-pick__foot-in">
      <div class=${cx("k-pick__note", needNote && "k-pick__note--needed")}>
        <label class="k-pick__note-label" for=${noteId}>${PICK_WORDS.noteLabel}</label>
        <textarea id=${noteId} ref=${noteRef} class="k-textarea k-pick__note-field" rows="2" maxLength=${4000}
          aria-describedby=${`${noteId}-hint`} aria-invalid=${needNote ? "true" : undefined} value=${note} disabled=${Boolean(busy)}
          placeholder="Optional" onInput=${(e) => { setNote(e.currentTarget.value); if (needNote && e.currentTarget.value.trim()) setNeedNote(false); }}></textarea>
        <p class="k-pick__hint" id=${`${noteId}-hint`}>${needNote ? html`<${Icon} name="alert" size=${14} /><span>${PICK_WORDS.needNote}</span>` : PICK_WORDS.noteHint}</p>
      </div>
      <div class="k-pick__rest">
        <${Button} variant="plain" icon="loop" busy=${busy && busy.action === "another"} disabled=${stopped}
          onClick=${(e) => { opener.current = e.currentTarget; send("another"); }}>${PICK_WORDS.another}<//>
        <${Button} variant="quiet" icon="reply" busy=${busy && busy.action === "reopen"} disabled=${stopped}
          onClick=${(e) => { opener.current = e.currentTarget; send("reopen"); }}>${PICK_WORDS.back}<//>
      </div>
    </div></div>`}
    ${error && !changed && html`<p class="k-pick__error" role="alert"><${Icon} name="alert" /><span>${text(error.message) || "That did not work."}${error.next ? ` ${text(error.next)}` : ""}</span></p>`}
  </article>`;
}

// The one approval card for any Needs-you item: a card of versions when the item is one, else DecisionCard as
// it is. kit/index.js exports this as DecisionCard, so every list of items (the drawer too) shows the pick.
export function DecisionOrPick(props) {
  return isPickItem(props && props.item) ? html`<${PickCard} ...${props} />` : html`<${DecisionCard} ...${props} />`;
}

// A task's versions on its page: the card to pick from while the task waits on the owner (`item`), else the
// versions as they are (`pieces`), read-only, the picked one marked when it is known. `problem` is one sentence.
export function Versions({ item = null, pieces = null, picked = null, onDone, id }) {
  const pick = isPickItem(item) ? item : null;
  const problem = !pick && pieces && typeof pieces.problem === "string" && pieces.problem ? cap(pieces.problem, 300) : "";
  const hasVersions = pick || (pieces && !pieces.single && versionsOf(pieces).length > 0);
  const single = !pick && pieces && pieces.single === true && versionsOf(pieces).length === 1 ? versionsOf(pieces)[0] : null;
  if (!pick && !problem && !hasVersions && !(single && pieces.kind)) return null;
  const lead = pick ? PICK_WORDS.pickLead : single ? "The brand check and the Art director's scores for this piece." : "";
  return html`<section class="k-pick-section" id=${id} tabindex="-1" aria-labelledby=${id ? `${id}-h` : undefined}>
    <div class="k-pick-section__head">
      <h2 class="k-pick-section__title" id=${id ? `${id}-h` : undefined}>${single ? "Checks on this piece" : PICK_WORDS.versions}</h2>
      ${(pick || pieces) && Number.isInteger((pick || pieces).round) ? html`<span class="k-pick-section__round">Round ${(pick || pieces).round}</span>` : null}
    </div>
    ${lead && html`<p class="k-pick-section__lead">${lead}</p>`}
    ${problem ? html`<p class="k-pick__none">${problem}</p>`
      : single ? html`<div class="k-pick-section__single"><${BrandRow} brand=${single.brand} /><${Scores} review=${single.review} kind=${pieces.kind} /></div>`
      : pick ? html`<${PickCard} item=${pick} bare=${true} level=${3} focusDone=${false} onDone=${onDone} />`
      : html`<${PickCard} pieces=${pieces} readOnly=${true} picked=${picked} bare=${true} level=${3} />`}
  </section>`;
}

// In the acceptance panel, in place of Accept: where to go to accept a task of versions.
export function PickNudge({ target }) {
  const go = () => {
    const el = typeof document !== "undefined" && document.getElementById ? document.getElementById(target) : null;
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  };
  return html`<div class="k-pick-nudge">
    <p>${PICK_WORDS.pickNudge}</p>
    <${Button} variant="primary" icon="layers" onClick=${go}>${PICK_WORDS.goPick}<//>
  </div>`;
}
