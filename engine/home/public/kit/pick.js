// PickCard (PLAN-V5 K9, T20; redrawn on the stage by PLAN-COOK T42): the moment the owner chooses between versions of
// one piece. The chosen version is on the stage, as itself: a picture in a shot (it opens larger), a page as its kept
// pictures at one scale, a draft as readable text on a panel. Under the stage, one card per version in a to c order:
// its letter and direction, the Art director's total out of 70, whether it meets the bar, and the one-line reason.
// The rail says who raised it and when, the brand check and the seven scores of the version on the stage, and ends
// with the one primary ("Pick A, Editorial"), then under a divider the note, "Another round" and "Send all back" (a
// note needed). The scores inform: nothing is preselected as best or ranked; the first is only the one shown first.
// PickFoot is that foot on its own, for a page that draws its own stage (a site's task page).
// Nothing an agent wrote is ever set as HTML: a direction's title, a draft's text, a reason and a brand line are
// text nodes; a picture comes only from the `/api/view/<token>` address the server gave, or for a page from the home
// server's own kept picture, `/api/sites/shot/<key>/<name>` (PLAN-V5 C21).
// Acts through POST /api/inbox/act with the item's version and `variant` (a, b or c) for a pick.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { when } from "../lib/format.js";
import { Button, LockedAction } from "./button.js";
import { actBody, DecisionCard, isChangedSinceSeen, reloadInboxItem } from "./decision.js";
import { Icon } from "./icon.js";
import { Blk, StageLayout } from "./layout.js";
import { Dialog } from "./overlays.js";
import { segStep } from "./segmented.js";
import { Frames, Shot, StageBar } from "./stage.js";
import { StatusDot } from "./status.js";
import { OptionCard, Strip } from "./strip.js";
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
  meets: "Meets the bar",
  unscored: "Not scored yet",
  filesMissing: "Files missing",
  strip: "The versions",
  scoresTitle: "The Art director's scores",
  brandTitle: "Brand check",
  openLarger: "Open larger",
  open: "Open",
  more: "More",
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

// The words of the one primary: "Pick A, Editorial". A single piece has no letter and keeps "Pick this one".
export function pickLabel(v) {
  if (!v || typeof v !== "object" || !v.letter) return PICK_WORDS.pick;
  return `Pick ${v.letter}, ${text(v.title)}`;
}

// A version's card facts: the total ("52 of 70"), whether it meets the bar (the chip's tone and words; none when
// the server did not say), and the reason. null when there is no review.
export function scoreFact(review) {
  const s = scoreRows(review, null);
  if (!s) return null;
  return {
    fact: `${s.total} of ${s.of}`,
    tone: s.meets ? "good" : s.below ? "warn" : "neutral",
    bar: s.meets ? PICK_WORDS.meets : s.below ? PICK_WORDS.below : "",
    reason: s.reason,
  };
}

const SHOT_PARTS = /\/shot-([A-Za-z0-9._-]{1,90})-(1280|390)-(light|dark)\.png$/;

// A page's kept pictures as frames: the desktop and the phone picture of the first page and scheme it shows, desktop
// first, each { width, src }. null unless every picture is a page's kept picture.
export function pageFrames(images) {
  const list = Array.isArray(images) ? images.filter((u) => safeViewUrl(u) && SHOT_URL.test(u)) : [];
  if (!list.length || list.length !== images.length) return null;
  const parts = (u) => u.match(SHOT_PARTS);
  const [, page, , scheme] = parts(list[0]);
  const at = (w) => list.find((u) => { const m = parts(u); return m[1] === page && m[2] === w && m[3] === scheme; });
  return ["1280", "390"].map((w) => at(w)).filter(Boolean).map((src) => ({ width: Number(parts(src)[2]), src }));
}

// What the stage shows for a version: { type, images, text, frames }, type one of "missing", "page" (frames),
// "pictures", "draft" (text only) or "none".
export function stageOf(v) {
  if (!v || typeof v !== "object" || v.missing) return { type: "missing", images: [], text: "", frames: null };
  const p = previewParts(v.preview);
  const frames = p.images.length ? pageFrames(p.images) : null;
  if (frames && frames.length) return { type: "page", images: p.images, text: p.text, frames };
  if (p.images.length) return { type: "pictures", images: p.images, text: p.text, frames: null };
  if (p.text) return { type: "draft", images: [], text: p.text, frames: null };
  return { type: "none", images: [], text: "", frames: null };
}

// Where an item opens on its own page (PLAN-COOK decision 9): its task when the server links one, else the item
// on Needs you. A caller with the shell's own address (lib/queue.js queueHref) passes it as `href` instead.
export function openHref(item) {
  const link = item && item.link && typeof item.link === "object" ? item.link : null;
  if (link && link.page === "tasks" && typeof link.id === "string" && link.id) return `#/tasks/${encodeURIComponent(link.id)}`;
  const id = text(item && item.id);
  return id ? `#/needs-you?item=${encodeURIComponent(id)}` : "#/needs-you";
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

// The seven scores as one row of figures, the total first (a label over a 22 px figure), then the reason.
// `compact` draws the row alone, for a fold (the shotlist's "The Art director's scores").
export function Scores({ review, kind, compact = false }) {
  const s = scoreRows(review, kind);
  if (!s) return html`<p class="k-pick__unscored"><${Icon} name="clock" size=${14} /><span>${PICK_WORDS.noReview}</span></p>`;
  return html`<div class=${cx("k-pick-scores", compact && "k-pick-scores--compact")}>
    <dl class="k-pick-scores__row">
      <div class="k-pick-scores__cell k-pick-scores__cell--total">
        <dt>Of ${s.of}</dt>
        <dd>
          <span class="k-pick-scores__n">${s.total}<span class="k-sr"> of ${s.of}</span></span>
          ${s.meets ? html`<span class="k-pick-scores__chip k-pick-scores__chip--good">${PICK_WORDS.meets}</span>`
            : s.below ? html`<span class="k-pick-scores__chip k-pick-scores__chip--warn">${PICK_WORDS.below}</span>` : null}
        </dd>
      </div>
      ${s.rows.map((r) => html`<div key=${r.key} class=${cx("k-pick-scores__cell", r.value !== null && r.value < 6 && "k-pick-scores__cell--low")}>
        <dt>${r.label}</dt>
        <dd><span class="k-pick-scores__n">${r.value === null ? "–" : r.value}<span class="k-sr"> of 10</span></span></dd>
      </div>`)}
    </dl>
    ${!compact && s.reason ? html`<p class="k-pick-scores__reason">${s.reason}</p>` : null}
  </div>`;
}

// The larger view of a version's pictures, one at a time.
function Larger({ images, label, at, onAt, onClose }) {
  const n = images.length;
  if (at < 0 || !n) return null;
  const i = Math.min(at, n - 1);
  return html`<${Dialog} open=${true} title=${n > 1 ? `${label}: picture ${i + 1} of ${n}` : label} size="lg" onClose=${onClose}
    footer=${n > 1 ? html`<div class="k-pick__dialog-nav">
      <${Button} variant="plain" icon="arrow-left" disabled=${i === 0} onClick=${() => onAt(i - 1)}>Previous<//>
      <${Button} variant="plain" icon="arrow-right" disabled=${i === n - 1} onClick=${() => onAt(i + 1)}>Next<//>
    </div>` : null}>
    <figure class="k-pick__large"><img src=${images[i]} alt=${`${label}, picture ${i + 1} of ${n}`} decoding="async" /></figure>
  <//>`;
}

// The stage: the chosen version itself. A picture in a shot with its own Previous and Next when there are many; a page
// as its desktop and phone pictures at one scale on a stage panel; a draft as a readable column on a panel.
function PickStage({ v }) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(-1);
  const s = stageOf(v);
  const label = v ? (v.letter ? `Version ${v.letter}: ${v.title}` : v.title) : PICK_WORDS.versions;
  const big = s.type === "page" ? s.frames.map((f) => f.src) : s.images;
  const n = s.images.length;
  const i = Math.min(at, Math.max(n - 1, 0));
  const name = v ? html`<b>${v.letter ? `Version ${v.letter}` : v.title}</b>${v.letter && v.title !== `Version ${v.letter}` ? html`<span class="k-pick__stage-name">${v.title}</span>` : null}` : null;
  const larger = big.length
    ? html`<${Button} size="sm" icon="fullscreen" class="k-pick__larger" aria-label=${PICK_WORDS.openLarger}
        onClick=${() => setOpen(s.type === "page" ? 0 : i)}><span class="k-pick__larger-word">${PICK_WORDS.openLarger}</span><//>`
    : null;
  const steps = s.type === "pictures" && n > 1
    ? html`<span class="k-pick__count">Picture ${i + 1} of ${n}</span>
        <${Button} size="sm" icon="chevron-left" aria-label="The picture before" disabled=${i === 0} onClick=${() => setAt(i - 1)} />
        <${Button} size="sm" icon="chevron-right" aria-label="The next picture" disabled=${i === n - 1} onClick=${() => setAt(i + 1)} />`
    : null;
  const bar = html`<${StageBar}>${name}<span class="k-stagebar__gap"></span>${steps}${larger}<//>`;
  let body;
  if (s.type === "missing") {
    body = html`<div class="k-pick__empty k-pick__empty--missing">
      <${Icon} name="alert" size=${20} />
      <p class="k-pick__empty-title">${PICK_WORDS.missing}</p>
      <p class="k-pick__empty-next">${PICK_WORDS.missingNext}</p>
    </div>`;
  } else if (s.type === "none") {
    body = html`<div class="k-pick__empty"><p class="k-pick__empty-title">${PICK_WORDS.noPreview}</p></div>`;
  } else if (s.type === "page") {
    body = html`<${Frames} items=${s.frames.map((f) => ({ width: f.width, src: f.src, alt: "", label: f.width >= 1280 ? "Desktop" : "Phone" }))} />`;
  } else if (s.type === "pictures") {
    // The picture opens larger on a click; the bar's "Open larger" is the same thing in one Tab stop.
    body = html`<div class="k-pick__shot" onClick=${() => setOpen(i)}>
      <${Shot} src=${s.images[i]} alt=${`${label}, picture ${i + 1} of ${n}`} tags=${n > 1 ? [{ text: `${i + 1} of ${n}`, at: "br" }] : []} />
    </div>`;
  }
  const words = s.text && s.type !== "missing"
    ? html`<article class=${cx("k-pick__draft", s.type !== "draft" && "k-pick__draft--under")} aria-label=${`${label}, its words`}>
        <div class="k-pick__draft-text">${s.text}</div>
      </article>`
    : null;
  return html`<div class=${cx("k-pick__stage", `k-pick__stage--${s.type}`)}>
    ${bar}${body}${words}
    <${Larger} images=${big} label=${label} at=${open} onAt=${setOpen} onClose=${() => setOpen(-1)} />
  </div>`;
}

// The strip: one card per version in a to c order. The chip says the bar (or that it is missing, unscored, or the
// one the owner picked); the line under is the Art director's reason.
function PickStrip({ versions, chosen, onChoose, picked }) {
  return html`<${Strip} label=${PICK_WORDS.strip}>
    ${versions.map((v) => {
      const f = scoreFact(v.review);
      const s = stageOf(v);
      const thumb = s.type === "page" ? s.frames[0].src : s.images[0] || null;
      const state = v.missing ? { tone: "bad", icon: "alert", text: PICK_WORDS.filesMissing }
        : picked && picked === v.id ? { tone: "good", icon: "check", text: PICK_WORDS.youPicked }
        : !f ? { tone: "neutral", text: PICK_WORDS.unscored }
        : f.bar ? { tone: f.tone, text: f.bar } : null;
      return html`<${OptionCard} key=${v.id} checked=${v.id === chosen} onPick=${() => onChoose(v.id)}
        title=${v.letter ? `${v.letter} · ${v.title}` : v.title} amount=${f ? f.fact : null} state=${state}
        say=${f && f.reason ? f.reason : null} boards=${thumb ? [{ src: thumb, alt: "" }] : undefined} />`;
    })}
  <//>`;
}

// The rail's blocks for the version on the stage: its scores, then its brand check.
function PickFacts({ v, kind }) {
  if (!v || v.missing) return null;
  return html`<${Blk} title=${PICK_WORDS.scoresTitle} aside=${v.letter ? `Version ${v.letter}` : null}>
      <${Scores} review=${v.review} kind=${kind} />
    <//>
    <${Blk} title=${PICK_WORDS.brandTitle}><${BrandRow} brand=${v.brand} /><//>`;
}

// The act path, shared by the card and by PickFoot: the note, what is being sent, the one confirm, "changed since
// you looked" (the item is read again and the newer one shown; nothing is sent again), and what it became.
function usePickAct({ item, readOnly, onDone }) {
  const [note, setNoteNow] = useState("");
  const [needNote, setNeedNote] = useState(false);
  const [busy, setBusy] = useState(null); // { action, variant } while the server answers
  const [error, setError] = useState(null);
  const [confirmFor, setConfirmFor] = useState(null);
  const [done, setDone] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [reloading, setReloading] = useState(false);
  const [gone, setGone] = useState(false);
  const noteRef = useRef(null);
  const yesRef = useRef(null);
  const opener = useRef(null);
  const changed = isChangedSinceSeen(error);

  const propVersion = item ? item.version : undefined;
  useEffect(() => { setFresh(null); setGone(false); }, [propVersion]);

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
  const stopped = Boolean(busy) || reloading || gone;
  const refocus = () => {
    const o = opener.current;
    const el = o && (o.base || o);
    if (el && el.isConnected !== false && typeof el.focus === "function") setTimeout(() => el.focus(), 0);
  };

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
      const version = variant ? versionsOf(shown).find((v) => v.id === variant) || null : null;
      const out = { action, variant: variant || null, message, version, title: cap(shown.title, 200), id: shown.id };
      setBusy(null);
      setConfirmFor(null);
      setNoteNow("");
      setDone(out);
      if (onDone) onDone({ item: shown, action, variant: variant || null, message, done: out });
    } catch (e) {
      setBusy(null);
      setError(e);
      // Focus stays where the owner was: the button pressed is enabled again.
      refocus();
    }
  };

  return {
    shown, note, needNote, busy, error, changed, reloading, gone, stopped, confirmFor, done, fresh, noteRef, yesRef,
    setNote: (value) => { setNoteNow(value); if (needNote && value.trim()) setNeedNote(false); },
    act: (action, ev) => { opener.current = ev && ev.currentTarget ? ev.currentTarget : null; send(action); },
    pick: (v, ev) => {
      if (stopped || !v || v.missing) return;
      opener.current = ev && ev.currentTarget ? ev.currentTarget : null;
      if (belowBar(v.review)) { setConfirmFor(v.id); return; }
      send("pick", v.id);
    },
    confirm: (v) => send("pick", v.id),
    cancel: () => { setConfirmFor(null); refocus(); },
  };
}

// The foot, as its two parts: `primary` (what changed, the one filled button or its confirm, a refusal in the
// server's words) and `rest` (the note, "Another round" and "Send all back", under a divider). `inline`: the
// primary at the default height and its own width, for a dialog's foot (PickPrimary).
function footParts(a, v, baseId, inline = false) {
  const noteId = `${baseId}-note`;
  const mine = a.busy && a.busy.action === "pick";
  let decide = null;
  if (v && v.missing) {
    decide = html`<${LockedAction} label=${pickLabel(v)} why=${`${PICK_WORDS.missing} ${PICK_WORDS.missingNext}`} tag="" />`;
  } else if (v && a.confirmFor === v.id) {
    decide = html`<div class="k-pick__confirm" role="group" aria-label="Confirm the pick"
        onKeyDown=${(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); a.cancel(); } }}>
        <p class="k-pick__confirm-ask">${PICK_WORDS.belowAsk}</p>
        <div class="k-pick__pair">
          <${Button} variant="quiet" disabled=${mine} onClick=${a.cancel}>Cancel<//>
          <${Button} variant="primary" busy=${mine} disabled=${a.stopped} ref=${a.yesRef} onClick=${() => a.confirm(v)}>${PICK_WORDS.yesPick}<//>
        </div>
      </div>`;
  } else if (v) {
    decide = html`<${Button} variant="primary" size=${inline ? "md" : "lg"} class=${inline ? undefined : "k-pick__button"} busy=${mine} disabled=${a.stopped}
      onClick=${(e) => a.pick(v, e)}>${pickLabel(v)}<//>`;
  }
  const primary = html`${a.changed ? html`<div class="k-pick__alert" role="alert">
      <${Icon} name="alert" size=${16} />
      <div>
        <p class="k-pick__alert-title">${text(a.error && a.error.message) || PICK_WORDS.changed}</p>
        <p class="k-pick__alert-next">${a.reloading ? "Reading them again…" : a.gone ? "It is no longer waiting for you." : text(a.error && a.error.next) || PICK_WORDS.changedNext}</p>
      </div>
    </div>` : null}
    ${decide}
    ${a.error && !a.changed ? html`<p class="k-pick__error" role="alert"><${Icon} name="alert" size=${14} /><span>${text(a.error.message) || "That did not work."}${a.error.next ? ` ${text(a.error.next)}` : ""}</span></p>` : null}`;
  const rest = html`<div class=${cx("k-pick__note", a.needNote && "k-pick__note--needed")}>
      <label class="k-sr" for=${noteId}>${PICK_WORDS.noteLabel}</label>
      <textarea id=${noteId} ref=${a.noteRef} class="k-textarea k-pick__note-field" rows="1" maxLength=${4000}
        aria-describedby=${`${noteId}-hint`} aria-invalid=${a.needNote ? "true" : undefined} value=${a.note} disabled=${Boolean(a.busy)}
        placeholder=${PICK_WORDS.noteLabel} onInput=${(e) => a.setNote(e.currentTarget.value)}></textarea>
      <p class="k-pick__hint" id=${`${noteId}-hint`}>${a.needNote ? html`<${Icon} name="alert" size=${14} /><span>${PICK_WORDS.needNote}</span>` : PICK_WORDS.noteHint}</p>
    </div>
    <div class="k-pick__pair">
      <${Button} busy=${a.busy && a.busy.action === "another"} disabled=${a.stopped} onClick=${(e) => a.act("another", e)}>${PICK_WORDS.another}<//>
      <${Button} busy=${a.busy && a.busy.action === "reopen"} disabled=${a.stopped} onClick=${(e) => a.act("reopen", e)}>${PICK_WORDS.back}<//>
    </div>`;
  return { primary, rest };
}

// The stepper of a narrow card: one button per version, the one in view pressed. Left and Right move along.
// (The shotlist card still uses it; the pick card's own choice is the strip.)
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

// What the card becomes after an action: one line with what was picked, and the server's message.
export function PickDone({ done, focus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (focus && ref.current && typeof ref.current.focus === "function") ref.current.focus(); }, []);
  if (!done) return null;
  const v = done.version || null;
  const s = v ? stageOf(v) : null;
  const shot = s ? (s.type === "page" ? s.frames[0].src : s.images[0] || null) : null;
  return html`<div class="k-pick k-pick--done" role="status" tabindex="-1" ref=${ref}>
    ${shot && html`<img class="k-pick__done-shot" src=${shot} alt="" loading="lazy" decoding="async" />`}
    <div class="k-pick__done-text">
      ${done.title && html`<p class="k-pick__done-title">${done.title}</p>`}
      ${v && done.action === "pick" && html`<p class="k-pick__done-choice"><${Icon} name="check" size=${14} /><span>${v.letter ? `You picked ${v.letter}: ${v.title}` : `You picked ${v.title}`}</span></p>`}
      <p class="k-pick__done-message">${text(done.message)}</p>
    </div>
  </div>`;
}

// A list's use: the head, the versions as a row of small pictures, and "Open".
function PickCompact({ shown, versions, round, href }) {
  const pickable = versions.filter((v) => !v.missing);
  const context = [text(shown.raisedBy), when(shown.when)].filter(Boolean);
  return html`<article class="k-pick k-pick--compact" aria-label=${text(shown.title)}>
    <div class="k-pick__chead">
      <p class="k-pick__kind"><${Icon} name="layers" size=${14} /><span>${pickable.length > 1 ? `${pickable.length} versions to choose from` : "One version"}${round ? ` · round ${round}` : ""}</span></p>
      <h3 class="k-pick__title">${text(shown.title)}</h3>
      ${(context.length > 0 || shown.identifier) && html`<p class="k-pick__context">
        ${context.map((c, i) => html`${i > 0 && html`<span aria-hidden="true"> · </span>`}<span>${c}</span>`)}
        ${shown.identifier && html`${context.length > 0 && html`<span aria-hidden="true"> · </span>`}<${Mono}>${text(shown.identifier)}<//>`}
      </p>`}
    </div>
    <ul class="k-pick__minis" aria-label=${PICK_WORDS.versions}>
      ${versions.map((v) => {
        const s = stageOf(v);
        const src = s.type === "page" ? s.frames[0].src : s.images[0] || null;
        return html`<li key=${v.id} class="k-pick__mini">
          <span class=${cx("k-pick__mini-pic", !src && "k-pick__mini-pic--words")} aria-hidden="true">
            ${src ? html`<img src=${src} alt="" loading="lazy" decoding="async" />` : v.letter || "·"}
          </span>
          <span class="k-pick__mini-name">${v.letter ? `${v.letter} · ${v.title}` : v.title}</span>
        </li>`;
      })}
    </ul>
    <div class="k-pick__copen"><${Button} href=${href || openHref(shown)}>${PICK_WORDS.open}<//></div>
  </article>`;
}

// PickCard({ item, onDone, compact, bare, level, focusDone, href }) for a Needs-you item of kind "pick", or
// PickCard({ pieces, readOnly: true, picked, bare, level }) for a task's versions as GET /api/tasks/:id/pieces
// gives them. On its own it is a whole stage (StageLayout, its title the page's h1); `bare` draws the same parts in
// one column inside a page that has its own title (the task page); `compact` is a list's row. `picked` is the id
// the owner chose. `href` is where "Open" goes in the compact use.
export function PickCard({ item = null, pieces = null, onDone, compact = false, bare = false, readOnly = false, picked = null, level = 4, focusDone = true, href }) {
  const [baseId] = useState(() => nextId("k-pick"));
  const [chosenId, setChosen] = useState(null);
  const a = usePickAct({ item, readOnly, onDone });
  const shown = a.shown;
  const src = shown || pieces;
  if (!src) return null;
  if (a.done) return html`<${PickDone} done=${a.done} focus=${focusDone} />`;

  const kind = shown ? shown.pieceKind : pieces && pieces.kind;
  const versions = versionsOf(src);
  const round = Number.isInteger(src.round) ? src.round : null;
  if (compact && shown) return html`<${PickCompact} shown=${shown} versions=${versions} round=${round} href=${href} />`;

  const v = versions.find((x) => x.id === chosenId)
    || (picked && versions.find((x) => x.id === picked))
    || versions.find((x) => !x.missing) || versions[0] || null;
  const stage = html`<${PickStage} key=${v ? v.id : "none"} v=${v} />`;
  const strip = versions.length > 1
    ? html`<${PickStrip} versions=${versions} chosen=${v && v.id} onChoose=${setChosen} picked=${picked} />`
    : null;
  const facts = html`<${PickFacts} v=${v} kind=${kind} />`;
  const foot = !readOnly && shown ? footParts(a, v, baseId) : null;
  const busy = a.busy ? "true" : undefined;

  if (bare) {
    return html`<div class=${cx("k-pick", "k-pick--bare", readOnly && "k-pick--read")} aria-busy=${busy} data-level=${level}>
      <div class="k-pick__ground" role="region" aria-label=${v ? `How ${v.letter ? `version ${v.letter}` : "it"} looks` : PICK_WORDS.versions}>${stage}</div>
      ${strip ? html`<div class="k-pick__strip">${strip}</div>` : null}
      <div class=${cx("k-pick__panel", !foot && "k-pick__panel--facts")}>
        <div class="k-pick__facts">${facts}</div>
        ${foot ? html`<div class="k-pick__act">
          <div class="k-pick__primary">${foot.primary}</div>
          <div class="k-pick__rest">${foot.rest}</div>
        </div>` : null}
      </div>
    </div>`;
  }

  const kindLine = [shown ? text(shown.raisedBy) : "", shown ? when(shown.when) : "", round ? `round ${round}` : ""].filter(Boolean).join(" · ");
  return html`<div class=${cx("k-pick", "k-pick--stage", readOnly && "k-pick--read")} aria-busy=${busy}>
    <${StageLayout} kind=${kindLine || null} title=${shown ? text(shown.title) : PICK_WORDS.versions}
      lede=${shown && shown.summary ? text(shown.summary) : null}
      label=${v ? `How ${v.letter ? `version ${v.letter}` : "it"} looks` : PICK_WORDS.versions}
      stage=${stage} strip=${strip} rail=${facts} foot=${foot} />
  </div>`;
}

// The foot on its own, for a page that draws its own stage and strip (a site's task page, T51): the one primary for
// the version the page shows (`chosen`, a, b or c), then under a divider the note, "Another round" and "Send all
// back", with the act path. On a phone the primary shows with "More", which opens the rest in a sheet. `onChanged`
// hears the item as it is now after "changed since you looked", so the page can redraw its stage.
export function PickFoot({ item, chosen, onDone, onChanged, focusDone = true }) {
  const [baseId] = useState(() => nextId("k-pick"));
  const [sheet, setSheet] = useState(false);
  const a = usePickAct({ item: isPickItem(item) ? item : null, readOnly: false, onDone });
  const fresh = a.fresh;
  useEffect(() => { if (fresh && onChanged) onChanged(fresh); }, [fresh]);
  if (!a.shown) return null;
  if (a.done) return html`<${PickDone} done=${a.done} focus=${focusDone} />`;
  const versions = versionsOf(a.shown);
  const v = versions.find((x) => x.id === chosen) || versions.find((x) => !x.missing) || null;
  const { primary, rest } = footParts(a, v, baseId);
  return html`<div class="k-pick-foot" aria-busy=${a.busy ? "true" : undefined}>
    <div class="k-pick-foot__primary">${primary}</div>
    <div class="k-pick-foot__rest">${rest}</div>
    <${Button} class="k-pick-foot__more" aria-haspopup="dialog" aria-expanded=${sheet ? "true" : "false"}
      onClick=${() => setSheet(true)}>${PICK_WORDS.more}<//>
    <${Dialog} open=${sheet} title=${PICK_WORDS.more} size="sm" onClose=${() => setSheet(false)}>
      <div class="k-pick-foot__sheet">${rest}</div>
    <//>
  </div>`;
}

// The pick's one primary alone, for the larger picture's foot (PLAN-COOK T112): the same act path as PickFoot's for
// the version shown (`chosen`), its confirm below the bar and a refusal in place; no note and no quieter actions
// (they stay in the rail). Nothing for an item that is not a pick, a version it does not list, or once it is done
// (`onDone` hears it, as from PickFoot).
export function PickPrimary({ item, chosen, onDone, onChanged }) {
  const [baseId] = useState(() => nextId("k-pick"));
  const a = usePickAct({ item: isPickItem(item) ? item : null, readOnly: false, onDone });
  const fresh = a.fresh;
  useEffect(() => { if (fresh && onChanged) onChanged(fresh); }, [fresh]);
  if (!a.shown || a.done) return null;
  const v = versionsOf(a.shown).find((x) => x.id === chosen) || null;
  if (!v) return null;
  return html`<div class="k-pick-primary" aria-busy=${a.busy ? "true" : undefined}>${footParts(a, v, baseId, true).primary}</div>`;
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
