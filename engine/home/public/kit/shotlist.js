// ShotlistCard (PLAN-V5 K14, T45; redrawn on the stage by PLAN-COOK T40): the moment the owner approves a film's
// shots and what they cost. One treatment is on the stage at a time: its chosen storyboard board, large, with the
// shot's move, prompt, render, model, length and cost under it, and the board before and after. Under the stage one
// card per treatment in a to c order: its boards, letter and direction, cost, length and clips, whether it fits
// today, and the Art director's total with its reason; choosing one puts it on the stage. The rail says who raised
// it and when, then what the treatment costs against today's limit (the home server's numbers only), then how long
// it takes, the brand check, the seven scores and the shots, each a 44 px row that opens in place (so the body
// fits the first screen and no line is ever cut; the scores stand open when the body has room for them). Its foot,
// held at the rail's bottom, holds the one decision: "Approve A and its cost", which opens a confirm that says, in the
// server's own sentence, the most the service (Runway, Higgsfield or both) may charge (nothing is sent before the owner
// presses its button, whose words are the server's too); or, when the treatment
// cannot be approved, one quiet line with a lock and the server's reason, then the one way out that works ("Pick C
// instead, it fits today") with "Raise today's limit" as a quiet button of the same height beside it (that one the
// primary when nothing fits). Under a divider: the note, "Another round" and "Send all back" (a note needed).
// Nothing an agent wrote is ever set as HTML (a title, a move, a prompt, a reason and a brand line are text nodes);
// a board comes only from the `/api/view/<token>` address the server gave, through safeViewUrl. Money figures come
// only from the server's numbers (kit/money.js moneyParts); its sentences are shown as sent.
// Acts through POST /api/inbox/act with the item's version and, for an approval, `variant` (a, b or c).
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { when } from "../lib/format.js";
import { queueHref } from "../lib/queue.js";
import { Button } from "./button.js";
import { Card } from "./card.js";
import { actBody, isChangedSinceSeen, reloadInboxItem } from "./decision.js";
import { Icon } from "./icon.js";
import { Blk, StageLayout } from "./layout.js";
import { MoneyBlock, moneyParts } from "./money.js";
import { Dialog } from "./overlays.js";
import { DecisionOrPick, Scores, brandLine, BRAND_WORDS, letterOf, safeViewUrl, versionsOf } from "./pick.js";
import { PicTag, Shot, StageBar } from "./stage.js";
import { StatusDot } from "./status.js";
import { Notice } from "./states.js";
import { OptionCard, Strip, cropOf, cropVars } from "./strip.js";
import { Tag } from "./tag.js";
import { cx, nextId } from "./util.js";

// ---- Words (rule 9: plain, short; the server's own sentences win where it sends them) ----
// "%s" in a word is the treatment's letter.

export const SHOTLIST_WORDS = {
  approve: "Approve this one and its cost",
  notYet: "Not yet",
  another: "Another round",
  back: "Send all back",
  noteLabel: "Your note",
  noteHint: "Say why, in a few words: your agents read this next time.",
  needNote: "Send all back needs a note. Say what none of them got right.",
  approved: "Approved. The Artist will make the clips. You can follow them in ",
  studio: "Studio",
  treatments: "Treatments",
  shots: "Shots",
  boards: "Storyboard",
  wordsAlone: "Made from words alone",
  bestModel: "Best model",
  readAll: "Read all",
  readLess: "Show less",
  missing: "This treatment's files are missing.",
  missingNext: "It cannot be approved.",
  noPlan: "Nothing to show for this treatment yet.",
  noCost: "This treatment has no cost yet, so it cannot be approved.",
  changed: "This shotlist or its cost changed since you looked. Read it again.",
  changedNext: "Look at the treatments and their cost again, then decide.",
  shared: "None of these can be approved yet. The reason is at the top.",
  cannot: "Cannot be approved yet.",
  settings: "Open Settings",
  health: "Open Health",
  gone: "It is no longer waiting for you.",
  // PLAN-COOK T40: the stage, the strip and the rail's decision.
  approveOne: "Approve %s and its cost",
  pickInstead: "Pick %s instead, it fits today",
  raise: "Raise today's limit",
  overLimit: "Over today's limit",
  fitsToday: "Fits today",
  meets: "meets the bar",
  below: "below the bar",
  costs: "Treatment %s costs",
  overBy: "Treatment %s goes over that by",
  scores: "The Art director's scores",
  brand: "Brand check",
  notePlaceholder: "Say why, in a few words (optional)",
  boardBefore: "The board before",
  boardNext: "The next board",
  open: "Open",
  locked: "Locked",
  approvedKind: "Approved",
  openStudio: "Open Studio",
  // Fix round A2 (T101): the rail's rows that open in place, and the approved state.
  howLong: "How long it takes",
  approvedMark: "Approved",
  whatApproved: "What you approved",
  treatment: "Treatment",
  length: "Length",
  cost: "Cost",
  next: "What happens next",
  shotsApproved: "The shots approved",
  // Fix round A3 (T113): the way back after an approval.
  backNeeds: "Back to Needs you",
  // Fix round A3 (T117): a board of the approved sheet opens larger.
  openLarger: "open it larger",
  // Fix round R5: the approved film's clips, from the home server's film record. "%n of %m made".
  clipsTitle: "The clips",
  clipsMade: "%n of %m made",
  // Fix round R6: the clips' state said once, in the head: "0 of 6 made, all queued".
  clipsAll: "all %s",
};

// A clip's state in the owner's words and the chip's tone: from the newest take of its shot in the home server's film
// record (GET /api/studio/films/:taskId); a shot with no take yet is queued. A tone only where a state is not the
// resting one (queued). `dot` is the row's 6 px mark (kit/status.js StatusDot): the state is said once, in the head
// (clipsSummary), and a row carries only its dot with the words for a screen reader.
export const CLIP_STATES = {
  queued: { text: "Queued", tone: "neutral", dot: "off" },
  making: { text: "Making", tone: "info", dot: "live" },
  made: { text: "Made", tone: "good", dot: "ok" },
  refused: { text: "Refused", tone: "bad", dot: "bad" },
  failed: { text: "Failed", tone: "bad", dot: "bad" },
};

// A word with the treatment's letter in it: withLetter("approveOne", "A") is "Approve A and its cost".
export function withLetter(key, letter) {
  return String(SHOTLIST_WORDS[key] || "").replace("%s", text(letter));
}

const ID = /^[abc]$/;
const SHOT_ID = /^s\d{2,3}$/;
const GOAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const PROMPT_FOLD = 110;

const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => {
  const s = text(v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// ---- Pure helpers (tested in test/kit-shotlist.test.mjs) ----

// True for a Needs-you item that is a film's shotlist (kind "shotlist"). One with a problem and no treatments
// still is: the card says what is wrong and offers to send it back.
export function isShotlistItem(item) {
  return Boolean(item && typeof item === "object" && item.kind === "shotlist");
}

// "$1.50" for 150 credits: one credit is one US cent. Anything that is not a whole count of credits is "".
export function creditsDollars(credits) {
  return Number.isInteger(credits) && credits >= 0 ? `$${(credits / 100).toFixed(2)}` : "";
}

// "5 clips", "1 clip".
const clips = (n) => `${n} ${n === 1 ? "clip" : "clips"}`;

// The words of the confirm for one treatment: { title, body, button }, or null when the treatment has no cost (it
// cannot be approved, so there is nothing to confirm). The body and the button are the home server's own (cost.confirm:
// the service or services that may charge and the most each may, PLAN-3D-ALL S1), shown whole as sent; the page
// composes no sentence that holds an amount. A server that sends none gives no body (the cost's own sentence still
// shows) and the button without an amount.
export function confirmWords(v) {
  const most = v && v.cost && v.cost.most;
  const shots = list(v && v.shotlist && v.shotlist.shots);
  if (!Number.isInteger(most) || most < 0 || !shots.length) return null;
  const name = cap(v.direction && v.direction.title, 80) || (v.id ? `Version ${letterOf(v.id)}` : "this treatment");
  const sent = v.cost.confirm && typeof v.cost.confirm === "object" ? v.cost.confirm : {};
  const said = (x) => (typeof x === "string" ? x : "");
  return {
    title: `Approve ${name}?`,
    body: said(sent.body),
    button: said(sent.button).trim() ? said(sent.button) : SHOTLIST_WORDS.approve,
  };
}

// The approve button's name for a screen reader, which hears which treatment it belongs to.
export function approveLabel(v) {
  const letter = v && v.letter ? `: version ${v.letter}` : "";
  const name = cap(v && v.title, 80);
  return `${SHOTLIST_WORDS.approve}${letter}${name ? `, ${name}` : ""}`;
}

// Why a treatment cannot be approved, with the link that helps: { text, link: { href, label } | null }, or null
// when it can be. The server's sentence is shown as it is; a link is added only when it speaks of Settings or Health.
export function blockedOf(v) {
  const t = cap(v && v.blocked, 400);
  if (!t) return null;
  return { text: t, link: linkFor(t) };
}

function linkFor(sentence) {
  if (/\bSettings\b/.test(sentence)) return { href: "#/settings?s=generation", label: SHOTLIST_WORDS.settings };
  if (/\bHealth\b/.test(sentence)) return { href: "#/health", label: SHOTLIST_WORDS.health };
  return null;
}

// The link under a refused approval: the codes that are about Settings (the limit, generation being off), and the
// ledger, which Health explains.
export function refusalLink(error) {
  const code = error && error.code;
  if (code === "over_limit" || code === "job_not_ready") return { href: "#/settings?s=generation", label: SHOTLIST_WORDS.settings };
  if (code === "ledger_unreadable") return { href: "#/health", label: SHOTLIST_WORDS.health };
  return null;
}

// When every treatment on the card is held back for the same reason (generation off, the ledger unreadable), the
// reason is said once, at the top: that sentence with its link, else null.
export function sharedBlock(item) {
  const open = versionsOf(item).filter((v) => !v.missing);
  if (open.length < 2) return null;
  const first = blockedOf(open[0]);
  return first && open.every((v) => v.blocked === open[0].blocked) ? first : null;
}

// The shots of a treatment as the table shows them: [{ id, label: "s01 · 5 s", render, move, prompt, model,
// credits, wordsAlone, best, board, crop }], `board` the server's viewer address for that shot's storyboard or "",
// `crop` its picture box as kit/strip.js cropOf reads it, or null.
export function shotRows(v) {
  const boards = new Map();
  for (const b of boardRows(v)) boards.set(b.shot, b);
  return list(v && v.shotlist && v.shotlist.shots).filter((s) => s && typeof s === "object" && s.id).map((s) => {
    const secs = Number.isFinite(s.seconds) ? ` · ${s.seconds} s` : "";
    return {
      id: text(s.id),
      label: `${text(s.id)}${secs}`,
      render: cap(s.render, 120),
      move: cap(s.move, 200),
      prompt: cap(s.prompt, 600),
      model: cap(s.model, 60),
      credits: Number.isInteger(s.credits) ? s.credits : null,
      wordsAlone: s.kind === "text_to_video",
      best: s.best === true,
      board: boards.has(text(s.id)) ? boards.get(text(s.id)).url : "",
      crop: boards.has(text(s.id)) ? boards.get(text(s.id)).crop : null,
    };
  });
}

// The boards of a treatment for its strip, in the order of its shots: [{ shot, url, crop }], `crop` the picture box
// the server checked (kit/strip.js cropOf), so the band of words the Artist's tool draws under it is left out; null
// when there is none, and then the whole board is drawn.
export function boardRows(v) {
  const out = [];
  const seen = new Set();
  for (const b of list(v && v.boards)) {
    const url = b && safeViewUrl(b.url);
    if (url && typeof b.shot === "string" && !seen.has(b.shot)) { seen.add(b.shot); out.push({ shot: b.shot, url, crop: cropOf(b) }); }
  }
  return out;
}

// Whether a prompt is long enough to be clamped behind "Read all".
export const foldsPrompt = (p) => text(p).length > PROMPT_FOLD;

// The facts about a treatment under its name: "30 s · 6 clips · 1280:720".
export function factsOf(v) {
  const sl = v && v.shotlist;
  if (!sl) return "";
  const n = list(sl.shots).length;
  return [Number.isFinite(sl.seconds) ? `${sl.seconds} s` : "", n ? clips(n) : "", cap(sl.ratio, 20)].filter(Boolean).join(" · ");
}

// The film's task id from its card: `staged:shotlist:<goal id>`, else the item's own link.
export function goalIdOf(item) {
  const m = /^staged:shotlist:(.+)$/.exec(text(item && item.id));
  const id = m ? m[1] : text(item && item.link && item.link.id);
  return GOAL_ID.test(id) ? id : "";
}

// Where the owner follows an approved film: Studio, on that film.
export function studioHref(item) {
  const id = goalIdOf(item);
  return id ? `#/dashboards/studio?film=${encodeURIComponent(id)}` : "#/dashboards/studio";
}

// The body of POST /api/inbox/act: the item, the action, the note, the version the owner saw, and for an approval
// the treatment's id.
export function shotlistBody(item, action, note, variant) {
  const body = actBody(item && item.id, action, note || "", item && item.version);
  if (action === "approve" && ID.test(text(variant))) body.variant = variant;
  return body;
}

// Whether the card offers an action (its server list is the truth; a card without a list offers all three).
export function cardOffers(item, id) {
  const acts = list(item && item.actions);
  return !acts.length || acts.some((a) => a && a.id === id);
}

// The server's "Today's limit" and "This month" lines for the head, without the line about treatments.
export function limitLines(item) {
  return list(item && item.details)
    .filter((d) => d && typeof d === "object" && d.label !== "Treatments" && cap(d.value, 200))
    .slice(0, 4).map((d) => ({ label: cap(d.label, 60), value: cap(d.value, 200) }));
}

// A headline whose lines never end on a word of one letter ("Approve a shotlist: A / film of ..."): such a word is
// joined to the next by a no-break space. Only spaces change; every word stays as sent.
export function keepShort(title) {
  return text(title).replace(/(^|\s)(\S)\s+(?=\S)/g, "$1$2\u00a0");
}

// The clips of an approved film, in the order of the approved shots: { rows: [{ id, words, state }], made } from the
// film record's shots (`state` a key of CLIP_STATES: the newest take's, "queued" with none); null when the record has
// no shots (nothing is guessed then). `rows` are the approved treatment's shots (shotRows), for the order and the
// words; a shot of the record that is not among them is still listed, after them.
export function clipStates(film, rows) {
  const shots = list(film && film.shots).filter((s) => s && typeof s === "object" && SHOT_ID.test(text(s.id)));
  if (!shots.length) return null;
  const byId = new Map(shots.map((s) => [text(s.id), s]));
  const mine = list(rows).filter((r) => r && byId.has(r.id));
  const out = [];
  const seen = new Set();
  for (const id of [...mine.map((r) => r.id), ...shots.map((s) => text(s.id))]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    const takes = list(s.takes).filter((t) => t && typeof t === "object");
    const last = takes.length ? text(takes[takes.length - 1].state) : "";
    const row = mine.find((r) => r.id === id);
    out.push({ id, words: (row && row.move) || cap(s.move, 200), state: Object.hasOwn(CLIP_STATES, last) ? last : "queued" });
  }
  return { rows: out, made: out.filter((r) => r.state === "made").length };
}

// "0 of 6 made".
export function madeWords(made, of) {
  return SHOTLIST_WORDS.clipsMade.replace("%n", String(made)).replace("%m", String(of));
}

// The clips' state said once: "0 of 6 made, all queued", "2 of 6 made, 1 making, 3 queued", "6 of 6 made".
export function clipsSummary(c) {
  const rows = list(c && c.rows);
  const made = rows.filter((r) => r.state === "made").length;
  const base = madeWords(made, rows.length);
  const rest = Object.keys(CLIP_STATES).filter((k) => k !== "made")
    .map((k) => [k, rows.filter((r) => r.state === k).length]).filter(([, n]) => n > 0);
  const word = (k) => CLIP_STATES[k].text.toLowerCase();
  if (!rest.length) return base;
  if (!made && rest.length === 1) return `${base}, ${SHOTLIST_WORDS.clipsAll.replace("%s", word(rest[0][0]))}`;
  return [base, ...rest.map(([k, n]) => `${n} ${word(k)}`)].join(", ");
}

// ---- The stage, the strip and the decision (PLAN-COOK T40) ----

// The money block's parts for one treatment, from the home server's numbers only (the treatment's cost and the
// item's generation limits), or null when they are missing (then the server's sentences are shown instead).
export function treatmentMoney(item, v) {
  const c = v && v.cost && typeof v.cost === "object" ? v.cost : null;
  const g = item && item.generation && typeof item.generation === "object" ? item.generation : null;
  if (!c || !g) return null;
  return moneyParts({ base: c.base, most: c.most, daily: g.daily, dayLeft: g.dayLeft, monthly: g.monthly, monthLeft: g.monthLeft });
}

// Whether the server lets this treatment be approved now: it has a cost, it is approvable and nothing blocks it.
export function canApprove(v) {
  return Boolean(v && !v.missing && v.approvable && !v.blocked && v.cost && typeof v.cost === "object");
}

// The card's one chip: { tone, icon, text }. Over today's limit by the server's numbers, else held back by the
// server, else it fits today.
export function treatmentChip(item, v) {
  if (!v) return null;
  if (v.missing) return { tone: "bad", icon: "alert", text: SHOTLIST_WORDS.missingNext };
  const parts = treatmentMoney(item, v);
  if (parts && parts.blocked) return { tone: "bad", icon: "lock", text: SHOTLIST_WORDS.overLimit };
  if (!canApprove(v)) return { tone: "bad", icon: "lock", text: SHOTLIST_WORDS.locked };
  return { tone: "good", icon: "check", text: SHOTLIST_WORDS.fitsToday };
}

// The cards' chips, one a treatment in the strip's order: each card's chip only when the treatments differ in it
// (three "Fits today" say nothing the money block does not); else none at all.
export function stripChips(item, versions) {
  const chips = list(versions).map((v) => treatmentChip(item, v));
  const words = new Set(chips.map((c) => (c ? `${c.tone} ${c.text}` : "")));
  return words.size > 1 ? chips : chips.map(() => null);
}

// The other treatment the owner can approve instead of `v`, in a to c order, or null.
export function insteadOf(item, v) {
  return versionsOf(item).find((x) => x.id !== (v && v.id) && canApprove(x)) || null;
}

// The way out of a blocked treatment: { href, label }. A sentence about today's limit raises it in Settings; one
// about Settings or Health opens that page; anything else has none.
export function wayOut(sentence) {
  const t = text(sentence);
  if (/today's limit/i.test(t)) return { href: "#/settings?s=generation", label: SHOTLIST_WORDS.raise };
  return linkFor(t);
}

// "30 s · 6 clips" for a card.
export function lengthWords(v) {
  const sl = v && v.shotlist;
  if (!sl) return "";
  const n = list(sl.shots).length;
  return [Number.isFinite(sl.seconds) ? `${sl.seconds} s` : "", n ? clips(n) : ""].filter(Boolean).join(" · ");
}

// "52 of 70, meets the bar: calm and exact" from the Art director's review, or "".
export function verdictWords(review) {
  const r = review && typeof review === "object" ? review : null;
  if (!r || !Number.isFinite(r.total) || !Number.isFinite(r.of)) return cap(r && r.reason, 200);
  const bar = r.meets === true ? SHOTLIST_WORDS.meets : r.meets === false ? SHOTLIST_WORDS.below : "";
  const reason = cap(r.reason, 200);
  return `${r.total} of ${r.of}${bar ? `, ${bar}` : ""}${reason ? `: ${reason}` : ""}`;
}

// "1280 × 720" for the server's "1280:720".
export function ratioWords(ratio) {
  const r = cap(ratio, 20);
  const m = /^(\d{2,5}):(\d{2,5})$/.exec(r);
  return m ? `${m[1]} × ${m[2]}` : r;
}

// The kind line over the title: "Chief of staff · today 08:09 · round 1".
export function shotlistKind(item) {
  const round = Number.isInteger(item && item.round) ? `round ${item.round}` : "";
  return [cap(item && item.raisedBy, 60), when(item && item.when), round].filter(Boolean).join(" · ");
}

// How much of the rail's body to leave empty at its foot so that no line is cut there: `room` is the body's height,
// `bottoms` where each whole part ends (a block, a row, a line opened under a row) from the body's top. 0 when all of
// it fits; else the room under the last part that ends inside the body (the rest is reached by scrolling).
export function wholeCut(room, bottoms) {
  const ends = list(bottoms).filter((b) => Number.isFinite(b) && b > 0);
  if (!Number.isFinite(room) || room <= 0 || !ends.length || Math.max(...ends) <= room + 1) return 0;
  const inside = ends.filter((b) => b <= room + 0.5);
  return inside.length ? Math.max(0, Math.floor(room - Math.max(...inside))) : 0;
}

const WHOLE = [".k-sl__rail > .k-blk", ".k-sl__rail > .k-sl__cost", ".k-sl__rail > .k-sl__notice", ".k-sl__rail > .k-sl__done-head", ".k-sl__fold-head",
  ".k-sl__fold[open] .k-sl__fold-body > *", ".k-blk__title", ".k-blk > .k-sl__say", ".k-sl__fact", ".k-pick-scores__cell"].join(", ");

// Keeps the rail from cutting a line: measures where the parts of its scroller end and sets the room to leave empty
// under the last whole one (see shotlist.css), again whenever the scroller or its parts change size or a row opens or
// closes. On a wide window the scroller is the rows under the money (.k-sl__folds, so the money and what is above it
// never move or clip: --k-sl-fcut); else, and after an approval, the rail's body (--k-sl-cut).
function scrollerOf(wrap) {
  const folds = wrap && wrap.querySelector ? wrap.querySelector(".k-sl__folds") : null;
  const body = wrap && wrap.parentElement;
  if (folds && typeof getComputedStyle === "function" && /auto|scroll/.test(getComputedStyle(folds).overflowY || "")) {
    return { el: folds, name: "--k-sl-fcut" };
  }
  return body ? { el: body, name: "--k-sl-cut" } : null;
}

function useWholeLines(ref) {
  useEffect(() => {
    const wrap = ref.current;
    const body = wrap && wrap.parentElement;
    if (!body || !body.style || typeof ResizeObserver !== "function") return undefined;
    let was = null;
    const look = () => {
      const s = scrollerOf(wrap);
      if (was && (!s || was.el !== s.el)) was.el.style.removeProperty(was.name);
      was = s;
      if (!s || !s.el.style) return;
      const top = s.el.getBoundingClientRect().top - s.el.scrollTop;
      const bottoms = [...s.el.querySelectorAll(WHOLE)].map((e) => e.getBoundingClientRect())
        .filter((r) => r.height > 0).map((r) => r.bottom - top);
      const cut = wholeCut(s.el.clientHeight, bottoms);
      if (cut > 0) s.el.style.setProperty(s.name, `${cut}px`); else s.el.style.removeProperty(s.name);
    };
    look();
    const ro = new ResizeObserver(look);
    ro.observe(body);
    ro.observe(wrap);
    const folds = wrap.querySelector ? wrap.querySelector(".k-sl__folds") : null;
    if (folds) ro.observe(folds);
    // A row opened in the scroller is brought into view whole, as far as its head can go to the top.
    const opened = (e) => {
      const d = e.target;
      const s = scrollerOf(wrap);
      if (d && d.open && s && s.el !== body && s.el.contains(d) && typeof s.el.scrollBy === "function") {
        const box = s.el.getBoundingClientRect();
        const r = d.getBoundingClientRect();
        const by = Math.min(r.bottom - box.bottom, r.top - box.top);
        if (by > 0) s.el.scrollBy({ top: by });
      }
      look();
    };
    wrap.addEventListener("toggle", opened, true);
    wrap.addEventListener("scroll", look, true);
    return () => {
      ro.disconnect();
      wrap.removeEventListener("toggle", opened, true);
      wrap.removeEventListener("scroll", look, true);
      body.style.removeProperty("--k-sl-cut");
      if (was && was.el.style) was.el.style.removeProperty(was.name);
    };
  });
}

// The scores stand open when the rows under the money have room for them (a wide window: those rows are the rail's
// scroller there), so the band above the foot is used and nothing is cut; else they wait behind their row. Decided once a treatment on the stage, as soon as the body has its height; the owner's own opening and closing
// is kept after that.
function useRoomForScores(railRef, scoresRef, key) {
  useLayoutEffect(() => {
    const wrap = railRef.current;
    const body = wrap && wrap.parentElement;
    if (!body || typeof window === "undefined" || typeof window.matchMedia !== "function" || typeof ResizeObserver !== "function") return undefined;
    let decided = false;
    const look = () => {
      const d = scoresRef.current;
      const s = scrollerOf(wrap);
      const el = s && s.el;
      if (decided || !d || !el || !(el.clientHeight > 0)) return;
      if (!window.matchMedia("(min-width: 860px)").matches) return;
      decided = true;
      if (d.open || el.scrollHeight > el.clientHeight + 1) return;
      d.open = true;
      if (el.scrollHeight > el.clientHeight + 1) d.open = false;
    };
    look();
    const ro = new ResizeObserver(look);
    ro.observe(body);
    return () => ro.disconnect();
  }, [key]);
}

// ---- Parts ----

// A board in a frame the sheet sizes: with a crop only its picture box shows, covering the frame (shotlist.css
// .k-sl__crop); without one the whole board, as before.
function Pic({ src, crop, cls, alt = "" }) {
  const vars = src ? cropVars(crop) : undefined;
  const img = src ? html`<img src=${src} alt=${alt} loading="lazy" decoding="async" />` : null;
  return html`<span class=${cx("k-sl__pic", cls, vars && "k-sl__pic--crop")} style=${vars}>
    ${vars ? html`<span class="k-sl__crop">${img}</span>` : img}
  </span>`;
}

// What stands in place of an approval that cannot be given: one quiet line, a lock and the reason as sent. Read as a
// group named by the action, so a screen reader hears what is locked and why.
function LockLine({ id, label, why }) {
  return html`<div class="k-sl__lock" role="group" aria-label=${label} aria-describedby=${id}>
    <${Icon} name="lock" size=${14} />
    <p class="k-sl__lock-why" id=${id}>${why}</p>
  </div>`;
}

// The facts under the board on the stage: "from tower.png · gen4_turbo · 5 s".
function shotFacts(s) {
  return [s.wordsAlone ? SHOTLIST_WORDS.wordsAlone : s.render ? `from ${s.render}` : "", s.model,
    s.label.includes(" · ") ? s.label.split(" · ")[1] : ""].filter(Boolean).join(" · ");
}

// The stage: the chosen board, large, the bar above it, the reel of boards beside it and the shot's words under it.
function TreatmentStage({ v, at, onAt }) {
  const boards = boardRows(v);
  const rows = shotRows(v);
  const n = boards.length;
  const i = n ? Math.min(Math.max(at, 0), n - 1) : 0;
  const b = n ? boards[i] : null;
  const s = (b && rows.find((r) => r.id === b.shot)) || (!n ? rows[0] : null) || null;
  const name = v.letter ? `Treatment ${v.letter}` : v.title;
  const ratio = ratioWords(v.shotlist && v.shotlist.ratio);
  const bar = html`<${StageBar}>
    <span class="k-sl__bar-name">${SHOTLIST_WORDS.boards}</span>${ratio ? html`<span class="k-sl__ratio">${ratio}</span>` : null}
    <span class="k-stagebar__gap"></span>
    ${n > 1 ? html`<span class="k-sl__count" aria-live="polite">${`${i + 1} of ${n}`}</span>
      <${Button} size="sm" icon="chevron-left" aria-label=${SHOTLIST_WORDS.boardBefore} disabled=${i === 0} onClick=${() => onAt(i - 1)} />
      <${Button} size="sm" icon="chevron-right" aria-label=${SHOTLIST_WORDS.boardNext} disabled=${i === n - 1} onClick=${() => onAt(i + 1)} />` : null}
  <//>`;
  if (v.missing || !n) {
    return html`${bar}<div class="k-sl__empty"><p>${v.missing ? SHOTLIST_WORDS.missing : SHOTLIST_WORDS.noPlan}</p>
      ${v.missing ? html`<p class="k-sl__empty-next">${SHOTLIST_WORDS.missingNext}</p>` : null}</div>
      ${s ? html`<${Caption} s=${s} />` : null}`;
  }
  // The boards take the rest of the stage's height (a size container, shotlist.css): the board with its caption and
  // the reel are as large as that place allows, and centred in it.
  // A board with a picture box is drawn in a frame of the box's shape (--k-sl-ar), the picture laid so only the box
  // shows; the reel's boards take the same shape, each its own box covering it.
  const vars = cropVars(b.crop);
  return html`${bar}
    <div class=${cx("k-sl__boards", n > 1 && "k-sl__boards--reel")} style=${n > 1 ? `--k-sl-n: ${n};` : undefined}>
      <div class=${cx("k-sl__fit", vars && "k-sl__fit--crop")} style=${vars ? `--k-sl-ar: ${b.crop.ratio}; ${vars}` : undefined}>
        <${Shot} src=${b.url} alt=${`${name}, board ${b.shot}`} tags=${[{ text: b.shot, at: "tl" }]}>
          ${s ? html`<${Caption} s=${s} />` : null}
        <//>
        ${n > 1 ? html`<div class="k-sl__reel">
          ${boards.map((x, k) => html`<button key=${x.shot} type="button" class="k-sl__reel-board" tabindex="-1"
            aria-label=${`${name}, board ${x.shot}`} aria-pressed=${k === i ? "true" : "false"} onClick=${() => onAt(k)}>
            <${Pic} src=${x.url} crop=${x.crop} /><span class="k-sl__reel-id" aria-hidden="true">${x.shot}</span>
          </button>`)}
        </div>` : null}
      </div>
    </div>`;
}

function Caption({ s }) {
  const title = s.move ? `${s.id} · ${s.move}` : s.id;
  return html`<div class="k-sl__caption">
    <span class="k-sl__caption-title">${title}</span>
    ${s.credits !== null ? html`<span class="k-sl__caption-cost">${creditsDollars(s.credits)}</span>` : html`<span></span>`}
    ${s.prompt ? html`<span class="k-sl__caption-prompt">${s.prompt}</span>` : html`<span></span>`}
    <span class="k-sl__caption-facts">${shotFacts(s)}</span>
  </div>`;
}

// The props of one treatment's card in the strip. The strip is given OptionCards themselves (not a wrapper), so it
// knows it is a radio group: one Tab stop, the arrows move the treatment.
function cardProps({ item, v, checked, board, chip, onPick }) {
  const boards = boardRows(v).map((b, k) => ({
    src: b.url, crop: b.crop, alt: "", label: `${v.letter ? `Treatment ${v.letter}` : v.title}, board ${b.shot}`, on: checked && k === board,
  }));
  const cost = v.cost && Number.isInteger(v.cost.base) ? creditsDollars(v.cost.base) : "";
  return {
    checked, onPick, title: v.letter ? `${v.letter} · ${v.title}` : v.title, amount: cost, sub: lengthWords(v),
    state: chip, say: v.missing ? SHOTLIST_WORDS.missing : verdictWords(v.review), boards: boards.length ? boards : undefined,
  };
}

// A row of the rail, 44 px, that opens in place: a line icon, its name, a short fact that ends 8 px before the 20 px
// chevron column at the right. With nothing under it, it is a plain row (nothing to open) and its chevron column is
// kept empty, so every row's fact ends on one edge. `dref` is the row's <details>.
function Fold({ title, aside, icon, dref, children }) {
  const head = html`${icon ? html`<${Icon} name=${icon} size=${16} class="k-sl__fold-icon" />` : null}
    <span class="k-sl__fold-name">${title}</span>
    ${aside ? html`<span class="k-sl__fold-aside">${aside}</span>` : null}`;
  if (!children) {
    return html`<div class="k-sl__fold k-sl__fold--still"><div class="k-sl__fold-head">${head}<span class="k-sl__fold-mark" aria-hidden="true"></span></div></div>`;
  }
  return html`<details class="k-sl__fold" ref=${dref}>
    <summary class="k-sl__fold-head">${head}<span class="k-sl__fold-mark" aria-hidden="true"><${Icon} name="chevron-down" size=${16} /></span></summary>
    <div class="k-sl__fold-body">${children}</div>
  </details>`;
}

// The brand check as a row: its state in words, opening to the check's own lines, as sent, and the way to the kit.
function BrandFold({ brand }) {
  const b = brandLine(brand);
  const body = b.lines.length || b.kit ? html`
    ${b.lines.length ? html`<ul class="k-sl__brand-lines">${b.lines.map((l, i) => html`<li key=${i}>${l}</li>`)}</ul>` : null}
    ${b.kit ? html`<a class="k-sl__link" href="#/files/brand-kit">${BRAND_WORDS.openKit}</a>` : null}` : null;
  return html`<${Fold} icon="brush" title=${SHOTLIST_WORDS.brand} aside=${b.text.replace(/^Brand check: /, "")}>${body}<//>`;
}

// The shots as a table: the board, the move with its prompt and facts, the cost on the right edge.
function ShotTable({ v }) {
  const rows = shotRows(v);
  if (!rows.length) return null;
  return html`<table class="k-sl__table">
    <thead><tr><th scope="col"><span class="k-sr">Board</span></th><th scope="col">Shot</th><th scope="col" class="k-sl__num">Cost</th></tr></thead>
    <tbody>
      ${rows.map((s) => html`<tr key=${s.id}>
        <td class="k-sl__table-pic">${s.board ? html`<${Pic} src=${s.board} crop=${s.crop} />` : null}</td>
        <td>
          <p class="k-sl__table-move">${s.move ? `${s.id} · ${s.move}` : s.id}</p>
          ${s.prompt ? html`<p class="k-sl__table-prompt">${s.prompt}</p>` : null}
          <p class="k-sl__table-facts">
            <span>${[s.render, s.model, s.label.includes(" · ") ? s.label.split(" · ")[1] : ""].filter(Boolean).join(" · ")}</span>
            ${s.wordsAlone ? html`<${Tag}>${SHOTLIST_WORDS.wordsAlone}<//>` : null}
            ${s.best ? html`<${Tag} tone="ok">${SHOTLIST_WORDS.bestModel}<//>` : null}
          </p>
        </td>
        <td class="k-sl__num">${s.credits !== null ? creditsDollars(s.credits) : ""}</td>
      </tr>`)}
    </tbody>
  </table>`;
}

// What the treatment costs: the money block from the server's numbers, or its sentences when the numbers are missing.
function Money({ item, v }) {
  if (v.missing) return null;
  const c = v.cost && typeof v.cost === "object" ? v.cost : null;
  const label = withLetter("costs", v.letter || "");
  if (!c) return html`<${Blk}><p class="k-sl__say">${SHOTLIST_WORDS.noCost}</p><//>`;
  const parts = treatmentMoney(item, v);
  const limits = parts ? [] : limitLines(item);
  // Fix round R6: the cost, its meter and its rows are the rail's one raised card; the rest of the rail is rows.
  return html`<div class="k-sl__cost"><${Card} padding="md" class="k-sl__cost-card">
    <${MoneyBlock} label=${label} parts=${parts} words=${parts ? [] : [cap(c.words, 500)]} overWords=${withLetter("overBy", v.letter || "")} />
    ${limits.length ? html`<dl class="k-sl__limits">
      ${limits.map((d, i) => html`<div key=${i} class="k-sl__limit"><dt>${d.label}</dt><dd>${d.value}</dd></div>`)}
    </dl>` : null}
  <//></div>`;
}

// How long the confirm's yes stays inert after the confirm appears (PLAN-3D D10): a second press that lands at once
// (a double click, Enter held down) spends nothing.
export const CONFIRM_INERT_MS = 600;

// The confirm takes focus on its words, not on a button (PLAN-3D T10): the owner reads what is spent first, and
// neither Enter nor Space can act before Tab reaches a button. Its yes is aria-disabled and ignores clicks, Enter
// and Space for its first 600 ms. It carries money sentences, so it is on paper (PLAN-3D-ALL D4, U7).
function Confirm({ v, busy, onYes, onNo }) {
  const w = confirmWords(v);
  const [armed, setArmed] = useState(false);
  // From the moment it is drawn (a layout effect: not a frame later).
  useLayoutEffect(() => {
    const t = setTimeout(() => setArmed(true), CONFIRM_INERT_MS);
    return () => clearTimeout(t);
  }, []);
  if (!w) return null;
  const words = cap(v.cost && v.cost.words, 500);
  const yes = () => { if (armed) onYes(); };
  return html`<${Dialog} open=${true} paper=${true} title=${w.title} size="sm" onClose=${() => { if (!busy) onNo(); }}
    footer=${html`<${Button} variant="plain" disabled=${busy} onClick=${onNo}>${SHOTLIST_WORDS.notYet}<//>
      <${Button} variant="primary" busy=${busy} aria-disabled=${armed ? undefined : "true"} onClick=${yes}>${w.button}<//>`}>
    <div class="k-sl__confirm-text" tabindex="-1" data-autofocus="">
      ${w.body ? html`<p class="k-sl__confirm">${w.body}</p>` : null}
      ${words ? html`<p class="k-sl__confirm k-sl__confirm--words">${words}</p>` : null}
    </div>
  <//>`;
}

// The line under a board of the approved sheet: the shot's words, then "5 s · $0.25".
function tileFacts(r) {
  return [r.label.includes(" · ") ? r.label.split(" · ")[1] : "", r.credits !== null ? creditsDollars(r.credits) : ""].filter(Boolean).join(" · ");
}

function TileLine({ r }) {
  return html`<p class="k-sl__tile-line">
    <span class="k-sl__tile-words" title=${r.move || undefined}>${r.move || r.id}</span>
    <span class="k-sl__tile-facts">${tileFacts(r)}</span>
  </p>`;
}

// A board of the approved sheet opened larger: the kit's full-size Dialog (a viewer starts on its Close button), the
// board as large as the window allows with its line under it, and the board before and the next in the head.
function BoardViewer({ name, rows, at, onAt, onClose }) {
  const r = rows[at];
  if (!r) return null;
  const n = rows.length;
  const vars = cropVars(r.crop);
  return html`<${Dialog} open=${true} size="full" title=${`${name}, board ${r.id}`} onClose=${onClose}
    tools=${n > 1 ? html`<div class="k-sl__view-pager">
      <${Button} variant="quiet" size="sm" icon="chevron-left" aria-label=${SHOTLIST_WORDS.boardBefore} disabled=${at === 0} onClick=${() => onAt(at - 1)} />
      <span class="k-sl__count" aria-live="polite">${`${at + 1} of ${n}`}</span>
      <${Button} variant="quiet" size="sm" icon="chevron-right" aria-label=${SHOTLIST_WORDS.boardNext} disabled=${at === n - 1} onClick=${() => onAt(at + 1)} />
    </div>` : undefined}>
    <div class="k-sl__view" style=${vars ? `--k-sl-vr: ${r.crop.ratio};` : undefined}>
      <figure class="k-sl__view-fig">
        <span class="k-sl__view-frame">
          <${Pic} src=${r.board} crop=${r.crop} alt=${`${name}, board ${r.id}`} />
          <${PicTag} at="tl">${r.id}<//>
        </span>
        <figcaption><${TileLine} r=${r} /></figcaption>
      </figure>
    </div>
  <//>`;
}

// What the card becomes after an action. An approval shows what was approved as a sheet of all its boards: the bar at
// the top as in the other states, then every board cropped to its picture, three across (two on a phone), each with its
// shot's number on the picture and one line under it (the shot's words, then its seconds and cost); a board opens
// larger in the kit's viewer. The rail says it is approved and when, what was approved (the treatment, its length and
// clips, its cost from the server's numbers), the clips as the home server's film record gives them (fix round R5: one
// row a shot with its state, "0 of 6 made"; one read of GET /api/studio/films/:taskId when the card is drawn, and
// nothing at all when that record has no shots: no state of a clip is guessed here), what happens next in the server's
// words, then "Open Studio" (the one primary) with "Back to Needs you" beside it. Anything else is the server's message
// on one line.
export function ShotlistDone({ done, focus = true }) {
  const ref = useRef(null);
  const railRef = useRef(null);
  const [open, setOpen] = useState(null);
  const film = goalIdOf({ id: done && done.id });
  const record = useResource(done && done.action === "approve" && done.version && film ? `/api/studio/films/${encodeURIComponent(film)}` : null);
  useEffect(() => { if (focus && ref.current && typeof ref.current.focus === "function") ref.current.focus(); }, []);
  useWholeLines(railRef);
  if (!done) return null;
  const v = done.version || null;
  const approved = done.action === "approve";
  const choice = v && approved ? (v.letter ? `You approved ${v.letter}: ${v.title}` : `You approved ${v.title}`) : "";
  const said = text(done.message) || (approved ? `${SHOTLIST_WORDS.approved}${SHOTLIST_WORDS.studio}.` : "");
  if (approved && v) {
    const name = v.letter ? `Treatment ${v.letter}` : v.title;
    const rows = shotRows(v);
    const shown = rows.filter((r) => r.board);
    const c = v.cost && typeof v.cost === "object" ? v.cost : null;
    const at = when(done.at);
    const ratio = ratioWords(v.shotlist && v.shotlist.ratio);
    // The stage: the bar with what was approved, then the sheet of boards.
    const bar = html`<${StageBar}>
      <span class="k-sl__bar-name">${SHOTLIST_WORDS.boards}</span>${ratio ? html`<span class="k-sl__ratio">${ratio}</span>` : null}
      <span class="k-stagebar__gap"></span>
      <span class="k-sl__done-choice"><${Icon} name="check" size=${16} /><span>${choice}</span></span>
    <//>`;
    const sheet = rows.length ? html`<ol class="k-sl__sheet" aria-label=${SHOTLIST_WORDS.shotsApproved}>
      ${rows.map((r) => {
        const k = shown.indexOf(r);
        const pic = html`<${Pic} src=${r.board} crop=${r.crop} /><${PicTag} at="tl">${r.id}<//>`;
        return html`<li key=${r.id} class="k-sl__tile">
          ${k >= 0 ? html`<button type="button" class="k-sl__tile-pic" aria-label=${`${name}, board ${r.id}, ${SHOTLIST_WORDS.openLarger}`}
            onClick=${() => setOpen(k)}>${pic}</button>` : html`<span class="k-sl__tile-pic k-sl__tile-pic--none">${pic}</span>`}
          <${TileLine} r=${r} />
        </li>`;
      })}
    </ol>` : html`<div class="k-sl__empty"><p>${v.title}</p></div>`;
    const stage = html`${bar}${sheet}`;
    const facts = [
      { label: SHOTLIST_WORDS.treatment, value: v.letter ? `${v.letter} · ${v.title}` : v.title },
      { label: SHOTLIST_WORDS.length, value: lengthWords(v) },
      { label: SHOTLIST_WORDS.cost, value: c && Number.isInteger(c.base)
        ? [`about ${creditsDollars(c.base)}`, Number.isInteger(c.most) && c.most > c.base ? `up to ${creditsDollars(c.most)}` : ""].filter(Boolean).join(", ") : "" },
    ].filter((f) => f.value);
    const time = c ? cap(c.time, 300) : "";
    const clipsNow = clipStates(record.data, rows);
    const rail = html`<div class="k-sl__rail" ref=${railRef}>
      <div class="k-sl__done-head">
        <p class="k-sl__done-mark">
          <span class="k-sl__approved"><${Tag} tone="good"><${Icon} name="check" size=${12} />${SHOTLIST_WORDS.approvedMark}<//></span>
          ${at ? html`<span class="k-sl__done-at">${at}</span>` : null}
        </p>
        <p class="k-sl__done-message">${said}</p>
      </div>
      <${Blk} title=${SHOTLIST_WORDS.whatApproved}>
        <dl class="k-sl__facts">${facts.map((f) => html`<div key=${f.label} class="k-sl__fact"><dt>${f.label}</dt><dd>${f.value}</dd></div>`)}</dl>
      <//>
      ${clipsNow ? html`<${Blk} title=${SHOTLIST_WORDS.clipsTitle} aside=${clipsSummary(clipsNow)}>
        <ul class="k-sl__clips">${clipsNow.rows.map((r) => html`<li key=${r.id} class="k-sl__clip">
          <${StatusDot} tone=${CLIP_STATES[r.state].dot} label=${CLIP_STATES[r.state].text} hideLabel=${true} pulse=${false} />
          <span class="k-sl__clip-id">${r.id}</span>
          <span class="k-sl__clip-words" title=${r.words || undefined}>${r.words}</span>
        </li>`)}</ul>
      <//>` : null}
      ${time ? html`<${Blk} title=${SHOTLIST_WORDS.next}><p class="k-sl__say">${time}</p><//>` : null}
      ${done.studio ? html`<div class="k-sl__done-go">
        <${Button} variant="primary" href=${done.studio}>${SHOTLIST_WORDS.openStudio}<//>
        <${Button} variant="ghost" href="#/needs-you">${SHOTLIST_WORDS.backNeeds}<//>
      </div>` : null}
    </div>`;
    return html`<div class="k-sl k-sl--done" role="status" tabindex="-1" ref=${ref}>
      <${StageLayout} title=${keepShort(done.title || v.title)} label=${name} stage=${stage} rail=${rail} />
      ${open !== null && shown[open] ? html`<${BoardViewer} name=${name} rows=${shown} at=${open} onAt=${setOpen} onClose=${() => setOpen(null)} />` : null}
    </div>`;
  }
  return html`<div class="k-sl k-sl--done k-sl--done-line" role="status" tabindex="-1" ref=${ref}>
    <${Icon} name="check" size=${16} />
    <div class="k-sl__done-text">
      ${done.title ? html`<p class="k-sl__done-title">${done.title}</p>` : null}
      <p class="k-sl__done-message">${said}</p>
    </div>
  </div>`;
}

// The compact use in a list: the head, what the first treatment that can be approved costs, and "Open".
function ShotlistCompact({ item }) {
  const versions = versionsOf(item).filter((v) => !v.missing);
  const v = versions.find(canApprove) || versions[0] || null;
  return html`<article class="k-sl k-sl--compact" aria-label=${text(item.title)}>
    <p class="k-sl__kind">${shotlistKind(item)}</p>
    <h3 class="k-sl__compact-title">${text(item.title)}</h3>
    ${item.summary ? html`<p class="k-sl__say">${text(item.summary)}</p>` : null}
    ${v && v.cost ? html`<div class="k-sl__compact-money">
      <${MoneyBlock} label=${withLetter("costs", v.letter || "")} parts=${treatmentMoney(item, v)} words=${[cap(v.cost.words, 500)]}
        overWords=${withLetter("overBy", v.letter || "")} />
    </div>` : null}
    <div class="k-sl__compact-foot"><${Button} href=${queueHref(item)}>${SHOTLIST_WORDS.open}<//></div>
  </article>`;
}

// ShotlistCard({ item, onDone, compact, focusDone }) for a Needs-you item of kind "shotlist". `compact` (a list's
// card) draws the head, the money and "Open"; otherwise the card is the whole stage.
export function ShotlistCard({ item = null, onDone, compact = false, focusDone = true }) {
  const [baseId] = useState(() => nextId("k-sl"));
  const [note, setNote] = useState("");
  const [needNote, setNeedNote] = useState(false);
  const [busy, setBusy] = useState(null); // { action, variant } while the server answers
  const [error, setError] = useState(null);
  const [confirmFor, setConfirmFor] = useState(null);
  const [done, setDone] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [reloading, setReloading] = useState(false);
  const [gone, setGone] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [board, setBoard] = useState(0);
  const [moved, setMoved] = useState(false);
  const noteRef = useRef(null);
  const footRef = useRef(null);
  const opener = useRef(null);
  const railRef = useRef(null);
  const scoresRef = useRef(null);
  const changed = isChangedSinceSeen(error);
  useWholeLines(railRef);
  useRoomForScores(railRef, scoresRef, chosen);

  const propVersion = item ? item.version : undefined;
  useEffect(() => { setFresh(null); setGone(false); }, [propVersion]);

  // "Changed since you looked": the confirm closes (the note stays) and the item is read again, so the owner sees
  // the treatments and their cost as they are now. Nothing is sent again.
  const itemId = item ? item.id : null;
  useEffect(() => {
    if (!changed || !itemId) return undefined;
    let live = true;
    setConfirmFor(null);
    setReloading(true);
    reloadInboxItem(itemId)
      .then((now) => { if (!live) return; if (now && isShotlistItem(now)) setFresh(now); else setGone(true); })
      .catch(() => {})
      .finally(() => { if (live) setReloading(false); });
    return () => { live = false; };
  }, [changed, error]);

  // After "Pick C instead" the decision stays where the owner was: focus goes to the foot's primary action.
  useEffect(() => {
    if (!moved) return;
    setMoved(false);
    const el = footRef.current;
    const b = el && el.querySelector ? el.querySelector(".k-sl__primary .k-btn--primary") : null;
    if (b && typeof b.focus === "function") b.focus();
  }, [moved]);

  const shown = fresh && item && fresh.id === item.id ? fresh : item;
  if (!shown) return null;
  if (done) return html`<${ShotlistDone} done=${done} focus=${focusDone} />`;
  if (compact) return html`<${ShotlistCompact} item=${shown} />`;

  const versions = versionsOf(shown);
  const v = versions.find((x) => x.id === chosen) || versions[0] || null;
  const stopped = Boolean(busy) || reloading || gone;
  const shared = sharedBlock(shown);
  const confirmV = confirmFor ? versions.find((x) => x.id === confirmFor && !x.missing) || null : null;
  const problem = cap(shown.problem, 400);

  const refocus = () => {
    const o = opener.current;
    const el = o && (o.base || o);
    if (el && el.isConnected !== false && typeof el.focus === "function") setTimeout(() => el.focus(), 0);
  };

  const send = async (action, variant) => {
    if (stopped) return;
    const words = note.trim();
    if (action === "send_back" && !words) {
      setNeedNote(true);
      if (noteRef.current) noteRef.current.focus();
      return;
    }
    setNeedNote(false);
    setBusy({ action, variant: variant || null });
    setError(null);
    try {
      const res = await api.post("/api/inbox/act", shotlistBody(shown, action, words, variant));
      // The server's own sentence, as sent; the card's words only when it sends none.
      const said = text(res && res.message);
      const message = said || (action === "approve" ? `${SHOTLIST_WORDS.approved}${SHOTLIST_WORDS.studio}.` : "Done.");
      const version = variant ? versions.find((x) => x.id === variant) || null : null;
      const out = {
        kind: "shotlist", action, variant: variant || null, message, version, title: cap(shown.title, 200), id: shown.id, at: new Date().toISOString(),
        studio: action === "approve" ? studioHref(shown) : null,
      };
      setBusy(null);
      setConfirmFor(null);
      setNote("");
      setDone(out);
      if (onDone) onDone({ item: shown, action, variant: variant || null, message, done: out });
    } catch (e) {
      setBusy(null);
      setConfirmFor(null);
      setError(e);
      // Focus stays where the owner was: the button pressed is enabled again.
      refocus();
    }
  };

  const onApprove = (x, ev) => {
    if (stopped) return;
    opener.current = ev && ev.currentTarget ? ev.currentTarget : null;
    setConfirmFor(x.id);
  };
  const cancelConfirm = () => {
    setConfirmFor(null);
    refocus();
  };
  const choose = (id) => {
    if (v && id === v.id) return;
    setChosen(id);
    setBoard(0);
  };

  const noteId = `${baseId}-note`;
  const link = refusalLink(error);
  const name = v ? (v.letter ? `Treatment ${v.letter}` : v.title) : "";

  // ---- The stage and the strip
  const stage = v
    ? html`<${TreatmentStage} v=${v} at=${board} onAt=${setBoard} />`
    : html`<div class="k-sl__empty"><p>${problem || SHOTLIST_WORDS.noPlan}</p></div>`;
  const chips = stripChips(shown, versions);
  const strip = versions.length
    ? html`<${Strip} label=${SHOTLIST_WORDS.treatments}>
        ${versions.map((x, k) => html`<${OptionCard} key=${x.id} ...${cardProps({ item: shown, v: x, checked: Boolean(v && x.id === v.id), board,
          chip: chips[k], onPick: () => choose(x.id) })} />`)}
      <//>`
    : null;

  // ---- The rail's foot: the one decision, then under a divider the note and the send-back actions
  let decision = null;
  let phoneLock = null;
  if (v) {
    const approveText = withLetter("approveOne", v.letter || "");
    if (canApprove(v)) {
      decision = html`<${Button} variant="primary" class="k-sl__approve" busy=${Boolean(busy) && busy.action === "approve" && busy.variant === v.id}
        aria-label=${approveLabel(v)} disabled=${stopped} onClick=${(e) => onApprove(v, e)}>${approveText}<//>`;
    } else {
      const reason = v.missing ? `${SHOTLIST_WORDS.missing} ${SHOTLIST_WORDS.missingNext}`
        : shared ? SHOTLIST_WORDS.shared
        : cap(v.blocked, 400) || (!v.cost ? SHOTLIST_WORDS.noCost : SHOTLIST_WORDS.cannot);
      const alt = shared ? null : insteadOf(shown, v);
      const out = wayOut(shared ? shared.text : v.blocked);
      const second = alt && out ? html`<${Button} variant="ghost" class="k-sl__second" href=${out.href}>${out.label}<//>` : null;
      decision = html`<${LockLine} id=${`${baseId}-why`} label=${approveText} why=${reason} />
        ${alt ? html`<${Button} variant="primary" disabled=${stopped}
            onClick=${() => { choose(alt.id); setMoved(true); }}>${withLetter("pickInstead", alt.letter)}<//>` : null}
        ${out && !alt ? html`<${Button} variant="primary" href=${out.href}>${out.label}<//>` : null}
        ${second}`;
      // A phone keeps only the way out in its sticky foot; the lock line and the second way read in the rail's flow.
      phoneLock = html`<div class="k-sl__phone-lock"><${LockLine} id=${`${baseId}-why-phone`} label=${approveText} why=${reason} />
        ${alt && out ? html`<${Button} variant="ghost" href=${out.href}>${out.label}<//>` : null}</div>`;
    }
  }
  // ---- The rail's body
  const rail = html`<div class="k-sl__rail" ref=${railRef}>
    ${problem && v ? html`<div class="k-sl__notice"><${Notice} tone="warn">${problem}<//></div>` : null}
    ${shared ? html`<div class="k-sl__notice" role="note"><${Notice} tone="warn">${shared.text}<//></div>` : null}
    ${changed ? html`<div class="k-sl__notice" role="alert"><${Notice} tone="warn" title=${text(error && error.message) || SHOTLIST_WORDS.changed}>
        ${reloading ? "Reading them again…" : gone ? SHOTLIST_WORDS.gone : text(error && error.next) || SHOTLIST_WORDS.changedNext}
      <//></div>` : null}
    ${phoneLock}
    ${v ? html`<${Money} item=${shown} v=${v} />` : null}
    ${v && !v.missing ? html`<div class="k-sl__folds">
      ${v.cost && cap(v.cost.time, 300) ? html`<${Fold} icon="clock" title=${SHOTLIST_WORDS.howLong}>
        <p class="k-sl__say">${cap(v.cost.time, 300)}</p>
      <//>` : null}
      <${BrandFold} brand=${v.brand} />
      <${Fold} icon="trend" dref=${scoresRef} title=${SHOTLIST_WORDS.scores} aside=${v.review && Number.isFinite(v.review.total) && Number.isFinite(v.review.of) ? `${v.review.total} of ${v.review.of}` : ""}>
        <${Scores} compact review=${v.review} kind="film" />
      <//>
      ${shotRows(v).length ? html`<${Fold} icon="film" title=${SHOTLIST_WORDS.shots} aside=${clips(shotRows(v).length)}><${ShotTable} v=${v} /><//>` : null}
    </div>` : null}
  </div>`;

  const failed = error && !changed
    ? html`<p class="k-sl__error" role="alert"><${Icon} name="alert" size=${16} /><span>${text(error.message) || "That did not work."}${error.next ? ` ${text(error.next)}` : ""}
        ${link ? html` <a class="k-sl__link" href=${link.href}>${link.label}</a>` : null}</span></p>`
    : null;
  const rest = cardOffers(shown, "another") || cardOffers(shown, "send_back") ? html`
    <div class=${cx("k-sl__note", needNote && "k-sl__note--needed")}>
      <label class="k-sr" for=${noteId}>${SHOTLIST_WORDS.noteLabel}</label>
      <textarea id=${noteId} ref=${noteRef} class="k-textarea k-sl__note-field" rows="1" maxLength=${4000}
        aria-describedby=${`${noteId}-hint`} aria-invalid=${needNote ? "true" : undefined} value=${note} disabled=${Boolean(busy)}
        placeholder=${SHOTLIST_WORDS.notePlaceholder} onInput=${(e) => { setNote(e.currentTarget.value); if (needNote && e.currentTarget.value.trim()) setNeedNote(false); }}></textarea>
      <p class=${cx("k-sl__hint", !needNote && "k-sr")} id=${`${noteId}-hint`}>${needNote ? html`<${Icon} name="alert" size=${14} /><span>${SHOTLIST_WORDS.needNote}</span>` : SHOTLIST_WORDS.noteHint}</p>
    </div>
    <div class="k-sl__pair">
      ${cardOffers(shown, "another") ? html`<${Button} variant="quiet" icon="loop" busy=${Boolean(busy) && busy.action === "another"} disabled=${stopped}
        onClick=${(e) => { opener.current = e.currentTarget; send("another"); }}>${SHOTLIST_WORDS.another}<//>` : null}
      ${cardOffers(shown, "send_back") ? html`<${Button} variant="quiet" icon="reply" busy=${Boolean(busy) && busy.action === "send_back"} disabled=${stopped}
        onClick=${(e) => { opener.current = e.currentTarget; send("send_back"); }}>${SHOTLIST_WORDS.back}<//>` : null}
    </div>` : null;
  const primary = decision || failed ? html`<div class="k-sl__primary" ref=${footRef}>${failed}${decision}</div>` : null;

  return html`<article class="k-sl" aria-label=${text(shown.title)} aria-busy=${busy ? "true" : undefined}>
    <${StageLayout} kind=${shotlistKind(shown)} title=${keepShort(shown.title)} lede=${shown.summary ? text(shown.summary) : null}
      label=${name ? `${SHOTLIST_WORDS.boards}, ${name}` : SHOTLIST_WORDS.boards}
      stage=${stage} strip=${strip} rail=${rail} foot=${{ primary, rest }} />
    ${confirmV ? html`<${Confirm} v=${confirmV} busy=${Boolean(busy)} onYes=${() => send("approve", confirmV.id)} onNo=${cancelConfirm} />` : null}
  </article>`;
}

// The one approval card for any Needs-you item: the shotlist card for a film's shotlist, else what kit/pick.js
// gives (a card of versions, or DecisionCard). kit/index.js exports this as DecisionCard, so every list of items
// (the drawer too) shows the shotlist as one.
export function DecisionOrShotlist(props) {
  return isShotlistItem(props && props.item) ? html`<${ShotlistCard} ...${props} />` : html`<${DecisionOrPick} ...${props} />`;
}
