// A task, as a conversation with its acceptance beside it (CONTRACTS-V3 30, "A task"; CONTRACTS-V2 17.3), drawn by
// PLAN-COOK T51 in one of three layouts:
//   A task that built a site (PLAN-V5 K16, T54) is a stage (kit/layout.js StageLayout): the site's pictures on the stage
//   and its versions in the strip (kit/site.js, T41); the rail says what it is ("A site to accept · round 1"), the
//   title and one line, then what the page viewer found, the acceptance facts (the state, the rounds and their checks,
//   what can come next) and, at its foot, the acceptance: the pick while a pick waits (kit/pick.js PickFoot), else
//   Accept with Send back and its note under a divider, and Stop in the menu. Under the first screen: the story in one
//   reading column, the checks, the files and how it went.
//   A task whose versions have pictures and no site is the pick card's own stage (kit/pick.js PickCard), the story
//   and the acceptance under it.
//   Any other task is the column: the back chip, the title, a line with the agent, the size, the job it came from and
//   the task it follows, then the story in time order (the owner's words, each document as it was written, the
//   agents' comments, a marker for each check round, the result with its files). For a question task the story is
//   the answer, told in rounds (kit/conversation.js: each round a card). Beside the column when there is room (under
//   the title when there is not): the acceptance rail with the state, Accept and Send back, the other Needs-you items,
//   the rounds and their checks, what can come next, how it went (the facts the task gives, then its stages), the
//   files, a note and stop. Beside the column the page takes a composed width (at most 1100 px, centred in the pane)
//   and the rail runs its whole height on the panel surface (T104). When the round passed and the task waits on the
//   owner, the first text file of the result (md or txt) is read under the story in a card (T114): what the owner is
//   accepting, on the page. Below 860 px a bar above the tab bar holds Accept and Send back.
// The versions come from GET /api/tasks/:id/pieces and the sites from GET /api/tasks/:id/sites. When a route is not
// there (404, an older home server) or fails, the page is the column as it was.
// Address state: ?round=<n>, ?check=<n>, ?doc=<stage id>, ?files=1. Everything here was written by agents:
// shown as text only, sizes capped, no link followed. A result file's text is read once through GET /api/view/<token>
// (the reader kit/checks.js Evidence uses: the server answers text only as JSON, never as a page) and drawn by the
// kit's Markdown as elements, never set as HTML.
// PLAN-3D-ALL U8: a surface screen. The column's title, its line of facts and its turn stand in the room header
// (kit/room.js), the picture of the task's department's room (else the desk); the conversation, the rail, the
// checks and the composer stay on the ground and the panels. On paper (kit/sheet.js) only what the owner reads and
// decides: a document of the story (the brief, the plan, the summary), the result's text being read, a question's
// answer, each other thing waiting on the owner, and the pick (its foot on a site's stage, the whole card while it
// waits). A site's stage and strip are never on paper and its pictures never tinted; the stage keeps its own title.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, fullWhen, waitingLine, when } from "../lib/format.js";
import { go } from "../lib/router.js";
import {
  AnswerView, Avatar, Blk, Button, Card, Chip, CheckList, Conversation, DecisionCard, DocView, Empty, ErrorNotice, Evidence,
  FILE_ICONS, FileCard, Icon, Loading, Markdown, Menu, PickCard, PickFoot, PickNudge, Scores, SiteFold, SiteRail, SiteStage, SiteStrip, SiteView,
  RoomHeader, Sheet, StageLayout, StatusDot, Tabs, TextArea, Timeline, Versions, brandLine, changedText, durationWords, fileKind, frontMatter,
  glimpseFor, isChangedSinceSeen, isPickItem, jobHref, stageLabel, stageOf, useInboxAct, useSiteView, versionsOf,
} from "../kit/index.js";

const BACK = { href: "#/tasks", label: "All tasks" };
const YOU = { slug: "you", name: "You" };
const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => { const s = text(v); return s.length > n ? `${s.slice(0, n)}…` : s; };
const ms = (iso) => { const t = Date.parse(text(iso)); return Number.isFinite(t) ? t : NaN; };
const NARROW = 860;
const WIDE = 1080;

// The rail's section headings.
export const PANEL_WORDS = { acceptance: "Acceptance", checks: "The checks", also: "Also waiting on you", how: "How it went", steps: "Every step" };

// How it went: the facts the task gives, each only when the data has it.
export const HOW_WORDS = { started: "Started", took: "Took", who: "Done by", rounds: "Rounds" };

// The result's text file read on the page.
export const READ_WORDS = { open: "Open", label: "What you are accepting", part: "Only the start of this file is shown." };

// Beside the column the page is at most this wide, centred in the pane, and reaches the pane's edges and its foot.
export const COMPOSED = 1100;

// Pure. How far the page reaches past the pane's padding to fill it, and the gutter that centres a composed width in
// it: { left, right, top, bottom, gutter } in px. `pane` is the pane's box ({ left, right, width }), `content` the
// page's own box inside the padding ({ left, right }), `pad` the padding's top and bottom.
export function bleedOf(pane, content, pad) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const left = Math.max(0, Math.round(n(content && content.left) - n(pane && pane.left)));
  const right = Math.max(0, Math.round(n(pane && pane.right) - n(content && content.right)));
  const gutter = Math.max(0, Math.floor((n(pane && pane.width) - COMPOSED) / 2));
  return { left, right, top: Math.max(0, n(pad && pad.top)), bottom: Math.max(0, n(pad && pad.bottom)), gutter };
}

// --- Pure helpers (tested in test/pages/task.test.mjs) ---------------------------------------------------------

// "Not checked yet", "1 verification round", "3 verification rounds". A question is answered by the Chief of staff
// and never checked (C3 25), so with no round it is "Not checked" (M63 item 4).
export function roundsLine(n, { ask = false } = {}) {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return ask ? "Not checked" : "Not checked yet";
  return v === 1 ? "1 verification round" : `${v} verification rounds`;
}

// The round the address asks for (by its number), else the newest. null when there are none.
export function pickRound(rounds, wanted) {
  const all = list(rounds).filter((r) => r && typeof r === "object");
  if (all.length === 0) return null;
  const w = Number(wanted);
  if (wanted !== null && wanted !== undefined && wanted !== "" && Number.isFinite(w)) {
    const hit = all.find((r) => Number(r.n) === w);
    if (hit) return hit;
  }
  return all.reduce((best, r) => (Number(r.n) > Number(best.n) ? r : best), all[all.length - 1]);
}

// The check the address asks for (by its number), else the first that failed, else the first. null when none.
export function pickCheck(round, wanted) {
  const checks = list(round && round.checks).filter((c) => c && typeof c === "object");
  if (checks.length === 0) return null;
  const w = Number(wanted);
  if (wanted !== null && wanted !== undefined && wanted !== "" && Number.isFinite(w)) {
    const hit = checks.find((c) => Number(c.n) === w);
    if (hit) return hit;
  }
  return checks.find((c) => text(c.answer).toLowerCase() !== "yes") || checks[0];
}

const STATE_WORDS = {
  waiting_for_you: "Waiting for you",
  accepted: "Accepted",
  not_ready: "Not ready yet",
  sent_back: "Sent back",
  stopped: "Stopped",
};
const STATE_DOTS = { waiting_for_you: "warn", accepted: "ok", not_ready: "live", sent_back: "warn", stopped: "off" };

// The word for the state of the acceptance.
export function stateWord(acceptance) {
  const s = acceptance && acceptance.state;
  return STATE_WORDS[s] || "Not ready yet";
}

// Every Needs-you item of the task except the delivery itself (that one is the Accept button).
export function otherNeeds(needsYou, acceptance) {
  const own = new Set([acceptance && acceptance.accept && acceptance.accept.inboxId,
    acceptance && acceptance.sendBack && acceptance.sendBack.inboxId].filter(Boolean));
  return list(needsYou).filter((i) => i && i.id && !own.has(i.id) && !(text(i.id).startsWith("goal:") && i.kind === "result"));
}

// The address of this page with some of its state changed (null removes a key).
export function address(id, query, change) {
  const q = new URLSearchParams(query ? query.toString() : "");
  for (const [k, v] of Object.entries(change || {})) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const qs = q.toString();
  return `#/tasks/${encodeURIComponent(text(id))}${qs ? `?${qs}` : ""}`;
}

const passedCount = (round) => list(round && round.checks).filter((c) => text(c && c.answer).toLowerCase() === "yes").length;

const STAGE_WORDS = { done: "Done", current: "Now", waiting: "Not started", skipped: "Skipped" };

// The arguments of `act` for the delivery's own buttons: the item, the action, the note, and the version the
// button was showing (CONTRACTS 9.3a). which is "accept" or "sendBack".
export function actArgs(acceptance, which, note) {
  const a = (acceptance && acceptance[which]) || {};
  return [a.inboxId, a.action, note, a.version];
}

// The marker of a check round: its label and a tone (passed, repairing, failed).
export function roundMarker(round) {
  const n = Number(round && round.n);
  const pass = round && round.outcome === "pass";
  const label = cap(text(round && round.label).trim() || (Number.isFinite(n) ? `Round ${n}` : "A round"), 80);
  if (pass) return { label, tone: "ok" };
  return { label, tone: /failed/i.test(label) ? "bad" : "warn" };
}

// The documents the story shows, and the line that marks each as written. The check is in the panel.
export const STORY_DOCS = { brief: "Brief written", plan: "Plan ready", summary: "Summary written" };

const STORY_FILES = 6;
const STAFF = new Set(["chief-of-staff", "you"]);
const slugOf = (name) => text(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// The task's files that belong under the result: not the staged documents, which the story shows as documents.
export function resultFiles(files, stages) {
  const docs = new Set(list(stages).map((s) => s && s.doc && s.doc.file && text(s.doc.file.name)).filter(Boolean));
  return list(files).filter((f) => f && typeof f === "object" && !docs.has(text(f.name)));
}

// The question of a question task as shape `ask` (33.5), for AnswerView; null when this is not a question,
// or when the Chief of staff took it as work (then the story is told as for any task). `answer` may be the
// whole ask or only its answer; before the server sends it, an open question reads as being read.
export function askOf(d) {
  const t = d && d.task;
  if (!t || t.ask !== true) return null;
  const a = d.answer;
  if (a && typeof a === "object" && (typeof a.question === "string" || typeof a.state === "string")) {
    return a.state === "became_task" ? null : a;
  }
  const answered = !!(a && typeof a === "object");
  const done = t.state === "done" || t.column === "done";
  let state;
  if (answered) state = "answered";
  else if (t.column === "canceled" || (d.acceptance && d.acceptance.state === "stopped")) state = "stopped";
  else if (done || Number(t.stepsTotal) > 0) return null;
  else if (t.state === "needs_you") state = "needs_you";
  else state = "reading";
  return {
    id: t.id, identifier: t.identifier, taskId: t.id,
    question: cap(text(d.text).trim() || t.title, 2000),
    state, plainState: text(t.plainState), askedAt: t.createdAt,
    answer: answered ? a : null,
    queue: t.queue && typeof t.queue === "object" ? t.queue : null,
  };
}

// The story of a task, in time order: [{ kind: "message", message } | { kind: "doc", id, label, marker, doc,
// unclear } | { kind: "answer", ask }]. Built from the owner's words, `conversation`, `stages`,
// `acceptance.rounds` and `result`. Documents carry no time of their own: the brief and the plan are placed
// before the first word of an agent other than the Chief of staff (or the first round, or the result), the
// summary before the newest round (or the result); with nothing to place them by, after what was said.
export function storyOf(d) {
  if (!d || typeof d !== "object") return [];
  const ask = askOf(d);
  if (ask) return [{ kind: "answer", ask }];
  const t = d.task || {};
  const rounds = list(d.acceptance && d.acceptance.rounds).filter((r) => r && typeof r === "object");
  const result = d.result && typeof d.result === "object" && text(d.result.text).trim() ? d.result : null;
  const convo = list(d.conversation).filter((m) => m && typeof m === "object").slice(-200);
  const out = [];
  let seq = 0;
  const push = (time, rank, item) => out.push({ time, rank, i: seq++, item });

  const opening = text(d.text).trim() || text(t.title).trim();
  if (opening) {
    const start = ms(t.createdAt);
    push(Number.isFinite(start) ? start : -Infinity, 0, { kind: "message", message: { who: YOU, text: cap(opening, 8000), at: t.createdAt } });
  }

  // Rounds: each marks the Checker's verdict given at its time, or stands alone.
  const unused = rounds.map((r) => ({ r, at: ms(r.at), used: false }));
  const files = resultFiles(d.files, d.stages).slice(0, STORY_FILES);
  let last = -Infinity;
  let resultPlaced = false;
  for (const m of convo) {
    const at = ms(m.at);
    if (Number.isFinite(at)) last = at;
    const who = m.who && typeof m.who === "object" ? { slug: text(m.who.slug), name: text(m.who.name) } : { slug: "", name: "" };
    const message = { who, kind: text(m.kind) || "comment", text: cap(m.text, 8000), at: m.at };
    // A long comment of an agent folds behind "Read all" (M63 item 28); the check and the result stay open.
    if (message.kind === "comment" && who.slug !== YOU.slug) message.fold = true;
    if (message.kind === "verdict") {
      const hit = unused.find((u) => !u.used && u.at === at);
      if (hit) { hit.used = true; message.marker = roundMarker(hit.r); }
    }
    if (result && !resultPlaced && message.kind === "result" && ms(result.at) === at) {
      resultPlaced = true;
      message.text = cap(result.text, 8000);
      if (files.length) message.files = files;
    }
    push(last, 2, { kind: "message", message });
  }
  for (const u of unused) {
    if (u.used) continue;
    push(Number.isFinite(u.at) ? u.at : Infinity, 3, { kind: "message", message: { marker: roundMarker(u.r) } });
  }
  if (result && !resultPlaced) {
    const at = ms(result.at);
    const said = convo.find((m) => m.kind === "result" && m.who && text(m.who.name) === text(result.by));
    const who = said ? { slug: text(said.who.slug), name: text(said.who.name) } : { slug: slugOf(result.by), name: cap(result.by, 80) };
    push(Number.isFinite(at) ? at : Infinity, 9, { kind: "message", message: { who, kind: "result", text: cap(result.text, 8000), at: result.at, files: files.length ? files : undefined } });
  }

  // Documents.
  const finite = (xs) => xs.filter(Number.isFinite);
  const firstWorker = convo.find((m) => m.who && !STAFF.has(text(m.who.slug)) && m.kind !== "verdict" && Number.isFinite(ms(m.at)));
  const early = finite([firstWorker ? ms(firstWorker.at) : NaN, rounds.length ? ms(rounds[0].at) : NaN, result ? ms(result.at) : NaN]);
  const newest = rounds.length ? ms(rounds[rounds.length - 1].at) : NaN;
  const late = finite([newest, result ? ms(result.at) : NaN]);
  for (const s of list(d.stages)) {
    if (!s || !s.doc || !Object.hasOwn(STORY_DOCS, s.id)) continue;
    const anchor = s.id === "summary" ? (late.length ? late[0] : Infinity) : (early.length ? Math.min(...early) : Infinity);
    push(anchor, 1, { kind: "doc", id: s.id, label: text(s.label), marker: { label: STORY_DOCS[s.id], tone: "neutral" }, doc: s.doc, unclear: list(s.unclear) });
  }

  if (d.acceptance && d.acceptance.state === "stopped") push(Infinity, 8, { kind: "message", message: { marker: { label: "Stopped", tone: "bad" } } });

  const order = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  out.sort((a, b) => order(a.time, b.time) || a.rank - b.rank || a.i - b.i);
  return out.map((e) => e.item);
}

// The result's file whose text the page reads (T114): when the newest round passed and the task waits on the owner,
// of the result's files that are text (md or txt) and viewable through /api/view, the first whose name shares a word
// of four or more letters with the result's words ("a launch post" → launch-post.md), else the first; else null.
// One file.
const READABLE = /\.(md|txt)$/i;
const wordsOf = (v) => new Set(text(v).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
export function readableOf(d) {
  if (!d || typeof d !== "object") return null;
  const a = d.acceptance || {};
  if (a.state !== "waiting_for_you") return null;
  const rounds = list(a.rounds).filter((r) => r && typeof r === "object");
  const newest = rounds.length ? rounds.reduce((b, r) => (Number(r.n) > Number(b.n) ? r : b), rounds[rounds.length - 1]) : null;
  if (!newest || newest.outcome !== "pass") return null;
  const texts = resultFiles(d.files, d.stages).slice(0, STORY_FILES).filter((f) => READABLE.test(text(f.name))
    && typeof f.viewUrl === "string" && f.viewUrl.startsWith("/api/view/"));
  const said = wordsOf(d.result && d.result.text);
  const named = texts.find((f) => [...wordsOf((text(f.name).split("/").pop() || "").replace(READABLE, ""))].some((w) => said.has(w)));
  return named || texts[0] || null;
}

// How it went, as facts the page already has: [{ id, label, value, title? }]: when the task started, how long it took
// to its result, who did it and how many check rounds. Nothing is shown that the data does not give.
export function howFacts(d) {
  if (!d || typeof d !== "object") return [];
  const t = d.task || {};
  const out = [];
  const start = ms(t.createdAt);
  if (Number.isFinite(start)) out.push({ id: "started", label: HOW_WORDS.started, value: when(t.createdAt), title: fullWhen(t.createdAt) });
  const end = ms(d.result && d.result.at);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) out.push({ id: "took", label: HOW_WORDS.took, value: durationWords(end - start) });
  if (t.who && text(t.who.name)) out.push({ id: "who", label: HOW_WORDS.who, value: cap(t.who.name, 60) });
  const n = list(d.acceptance && d.acceptance.rounds).length;
  if (n > 0) out.push({ id: "rounds", label: HOW_WORDS.rounds, value: String(n) });
  return out;
}

// "What can come next" (33.4 `next`) as links to the job, told which task they follow.
export function nextLinks(next, task) {
  const from = text(task && (task.identifier || task.id));
  return list(next).filter((n) => n && typeof n === "object").slice(0, 12).map((n) => {
    const base = jobHref({ id: text(n.jobId) });
    if (!base) return null;
    const why = n.why && typeof n.why === "object" ? n.why.text : n.why;
    return {
      href: from ? `${base}?from=${encodeURIComponent(from)}` : base,
      title: cap(n.title, 120),
      label: cap(n.label, 120) || cap(n.title, 120),
      ready: n.ready === true,
      why: cap(why, 300),
    };
  }).filter(Boolean);
}

// Whether the panel stands beside the column: the window is at least 1080 px wide and the page has room for
// both (`room`, the width the main pane leaves the page). `width` is how wide the page then is.
export const SIDE_ROOM = 880;
export const SIDE_MAX = 1084;
export function sideLayout(viewport, room) {
  const v = Number(viewport);
  const r = Math.floor(Number(room));
  if (!Number.isFinite(v) || v < WIDE || !Number.isFinite(r) || r < SIDE_ROOM) return { side: false, width: null };
  return { side: true, width: Math.min(r, SIDE_MAX) };
}

// The card of versions waiting on the owner for this task, or null: the task's own Needs-you item when it is a
// card of versions (K9).
export function pickItemOf(d) {
  const t = (d && d.task) || {};
  const own = (d && d.acceptance && d.acceptance.accept && d.acceptance.accept.inboxId) || (t.id ? `goal:${t.id}` : "");
  return list(d && d.needsYou).find((i) => i && i.id === own && isPickItem(i)) || null;
}

// When the versions are read again: when the task moves, and on every refresh while a brand check still runs.
export function piecesStamp(d, pieces) {
  if (!d) return "";
  const t = d.task || {};
  const a = d.acceptance || {};
  const running = list(pieces && pieces.variants).some((v) => v && brandLine(v.brand).running);
  return [t.column, t.state, t.updatedAt, a.state, list(a.rounds).length, running ? d.generatedAt : ""].map(text).join("|");
}

// Which layout the task takes: "site" when the home server has a site of it to show (the stage of T41), "versions"
// when the versions waiting on the owner (or kept after the pick) have pictures, else "column" (also for an older home
// server, which has neither route).
export function layoutOf({ site = null, pick = null, pieces = null } = {}) {
  if (site && typeof site === "object") return "site";
  const src = isPickItem(pick) ? pick : pieces && typeof pieces === "object" && !pieces.single ? pieces : null;
  const pictured = src ? versionsOf(src).some((v) => { const s = stageOf(v); return s.type === "page" || s.type === "pictures"; }) : false;
  return pictured ? "versions" : "column";
}

const KIND_WORDS = {
  waiting_for_you: "A site to accept",
  accepted: "A site, accepted",
  sent_back: "A site, sent back",
  stopped: "A site, stopped",
};

// The kind line of a task with a site: "A site to accept · round 1". `round` is the versions' round, else the number
// of check rounds.
export function stageKind(acceptance, round) {
  const word = KIND_WORDS[acceptance && acceptance.state] || "A site in the works";
  const n = Math.floor(Number(round));
  return Number.isFinite(n) && n > 0 ? `${word} · round ${n}` : word;
}

// The Art director's review of each version, keyed by its letter, as the site's strip takes it:
// { a: { total, meets, reason } }. {} when nothing was scored.
export function scoresByLetter(src) {
  const out = {};
  for (const v of versionsOf(src)) {
    const r = v.review;
    if (v.missing || !r || typeof r !== "object" || !Number.isInteger(r.total)) continue;
    out[v.id] = { total: r.total, meets: r.meets === true ? true : r.meets === false ? false : null, reason: cap(r.reason, 200) };
  }
  return out;
}

// The rounds as the rail lists them, newest last: [{ n, label, tone, checks }] where `checks` is "6 of 6 checks
// passed" for a round with its six checks, else "".
export function roundRows(rounds) {
  return list(rounds).filter((r) => r && typeof r === "object").slice(-8).map((r) => {
    const all = list(r.checks).filter((c) => c && typeof c === "object");
    const m = roundMarker(r);
    return { n: r.n, label: m.label, tone: m.tone, checks: r.wellFormed && all.length ? `${passedCount(r)} of ${all.length} checks passed` : "" };
  });
}

// The one line under a site's title when no pick is waiting: who made it, the size, the job it came from.
export function factWords(task, job) {
  const t = task || {};
  const parts = [];
  if (t.who && t.who.name) parts.push(`By ${cap(t.who.name, 60)}`);
  if (t.size) parts.push(`size ${cap(t.size, 4)}`);
  if (job && job.title) parts.push(`from ${cap(job.title, 80)}`);
  return parts.join(" · ");
}

// --- Layout: beside, stacked, or narrow with a bar ---------------------------------------------------------------

const px = (v) => Number.parseFloat(v) || 0;

function useLayout(ref) {
  const [state, setState] = useState({ narrow: false, side: false, width: null, bleed: null });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return undefined;
    const main = el.closest("main");
    const outer = main && main.parentElement;
    const measure = () => {
      const vw = window.innerWidth;
      let room = 0;
      let bleed = null;
      if (outer) {
        const o = getComputedStyle(outer);
        const m = getComputedStyle(main);
        room = outer.clientWidth - px(o.paddingLeft) - px(o.paddingRight) - px(m.paddingLeft) - px(m.paddingRight);
        const ob = outer.getBoundingClientRect();
        const mb = main.getBoundingClientRect();
        bleed = bleedOf({ left: ob.left, right: ob.right, width: ob.width },
          { left: mb.left + px(m.paddingLeft), right: mb.right - px(m.paddingRight) },
          { top: px(m.paddingTop), bottom: px(m.paddingBottom) });
      }
      const next = { narrow: vw < NARROW, ...sideLayout(vw, room), bleed };
      const key = (b) => (b ? `${b.left}|${b.right}|${b.top}|${b.bottom}|${b.gutter}` : "");
      setState((s) => (s.narrow === next.narrow && s.side === next.side && s.width === next.width && key(s.bleed) === key(next.bleed) ? s : next));
    };
    measure();
    const ro = typeof ResizeObserver === "function" && outer ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(outer);
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return state;
}

// The height of the bar fixed at the bottom, so the page can leave room for it.
function useHeight(ref, on) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) { setH(0); return undefined; }
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [on]);
  return h;
}

// --- Accept and Send back, or a word for the state ----------------------------------------------------------------

// The delivery's own act: Accept, and Send back with its note. Shared by the column's bar and the stage's foot.
function useAccept({ acceptance, onDone, onChanged }) {
  const { act, busy, error, changed } = useInboxAct();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const sendBack = acceptance && acceptance.sendBack;

  // The task changed after the owner looked: read it again once. Nothing is sent again.
  useEffect(() => { if (changed && typeof onChanged === "function") onChanged(); }, [changed, error]);

  async function doAccept() {
    const res = await act(...actArgs(acceptance, "accept"));
    if (res) onDone(text(res.message) || "Accepted.");
  }
  async function doSendBack(e) {
    if (e) e.preventDefault();
    if (!sendBack || !note.trim()) return;
    const res = await act(...actArgs(acceptance, "sendBack", note.trim()));
    if (res) { setNoting(false); setNote(""); onDone(text(res.message) || "Sent back with your note."); }
  }
  const cancel = () => { setNoting(false); setNote(""); };
  return { busy, error, noting, setNoting, note, setNote, doAccept, doSendBack, cancel, sendBack };
}

function AcceptBar({ acceptance, onDone, onChanged }) {
  const a = useAccept({ acceptance, onDone, onChanged });
  const { busy, error, noting, setNoting, note, setNote, doAccept, doSendBack, cancel, sendBack } = a;
  const accept = acceptance && acceptance.accept;
  if (!accept) return null;

  return html`
    <div class="p-task__accept">
      ${noting ? html`
        <form class="p-task__sendback" onSubmit=${doSendBack}
          onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}>
          <label class="u-caption" for="p-task-sendback">What should change?</label>
          <${TextArea} id="p-task-sendback" autoGrow rows=${3} maxLength=${4000} value=${note} autoFocus disabled=${busy}
            onInput=${(e) => setNote(e.currentTarget.value)} />
          <div class="u-row">
            <${Button} type="submit" variant="primary" busy=${busy} disabled=${!note.trim()}>${text(sendBack && sendBack.label) || "Send back"}<//>
            <${Button} variant="quiet" onClick=${cancel} disabled=${busy}>Cancel<//>
          </div>
        </form>` : html`
        <div class="p-task__accept-row">
          <${Button} variant="primary" busy=${busy} onClick=${doAccept}>${text(accept.label) || "Accept"}<//>
          ${sendBack ? html`<${Button} variant="ghost" onClick=${() => setNoting(true)} disabled=${busy}>${text(sendBack.label) || "Send back"}<//>` : null}
        </div>`}
      ${error ? html`<${Refused} error=${error} />` : null}
    </div>`;
}

// A refused or failed action, in place: the server's words and next step. Not the "could not be loaded" box.
function Refused({ error }) {
  const t = isChangedSinceSeen(error) ? changedText(error) : { message: text(error && error.message) || "That did not work.", next: text(error && error.next) };
  return html`<div class="k-decision__changed" role="alert">
    <${Icon} name="alert" />
    <div class="k-decision__changed-text">
      <p class="k-decision__changed-title">${text(t.message)}</p>
      ${t.next ? html`<p class="k-decision__changed-next">${text(t.next)}</p>` : null}
    </div>
  </div>`;
}

// "Stop this task": asks once, then POST /api/goals/<id>/stop.
function StopTask({ task, onDone, open = false, onClose }) {
  const [asking, setAskingNow] = useState(open);
  const setAsking = (v) => { setAskingNow(v); if (!v && onClose) onClose(); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(task.id)}/stop`, {});
      setAsking(false);
      onDone("The task is stopped. Agents will not work on it any more.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!asking) return html`<${Button} variant="danger-quiet" size="sm" icon="cross" class="p-task__stop" onClick=${() => setAsking(true)}>Stop this task<//>`;
  return html`
    <div class="p-task__confirm" role="group" aria-label="Stop this task?"
      onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }}>
      <p>Stop this task? Agents stop working on it.</p>
      <div class="u-row">
        <${Button} variant="danger" busy=${busy} onClick=${stop}>Yes, stop it<//>
        <${Button} variant="quiet" onClick=${() => setAsking(false)} disabled=${busy}>Cancel<//>
      </div>
      ${error ? html`<${ErrorNotice} error=${error} />` : null}
    </div>`;
}

// "Send a note": a short note to the Chief of staff, POST /api/goals/<id>/note.
function SendNote({ task, onDone, open: startOpen = false, onClose }) {
  const [open, setOpenNow] = useState(startOpen);
  const setOpen = (v) => { setOpenNow(v); if (!v && onClose) onClose(); };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function send(e) {
    if (e) e.preventDefault();
    const body = note.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(task.id)}/note`, { text: body });
      setNote("");
      setOpen(false);
      onDone("Note sent to the Chief of staff.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const cancel = () => { setOpen(false); setError(null); };

  if (!open) return html`<${Button} variant="plain" size="sm" icon="reply" onClick=${() => setOpen(true)}>Send a note<//>`;
  return html`
    <form class="p-task__note" onSubmit=${send} onKeyDown=${(e) => {
      if (e.key === "Escape") { e.stopPropagation(); cancel(); }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
    }}>
      <label class="u-caption" for="p-task-note">A note to the Chief of staff</label>
      <${TextArea} id="p-task-note" autoGrow rows=${3} maxLength=${4000} value=${note} autoFocus disabled=${busy}
        onInput=${(e) => setNote(e.currentTarget.value)} />
      <div class="u-row">
        <${Button} type="submit" variant="primary" size="sm" busy=${busy} disabled=${!note.trim()}>Send<//>
        <${Button} variant="quiet" size="sm" onClick=${cancel} disabled=${busy}>Cancel<//>
      </div>
      ${error ? html`<${Refused} error=${error} />` : null}
    </form>`;
}

// --- The rounds: tabs, the checks, the chosen check with its evidence, the Checker's actions --------------------

function ChosenCheck({ check }) {
  const [pick, setPick] = useState(0);
  const files = list(check && check.evidence).filter((f) => f && typeof f === "object");
  useEffect(() => setPick(0), [check && check.n]);
  if (!check) return null;
  const file = files[Math.min(pick, files.length - 1)] || null;
  const ok = text(check.answer).toLowerCase() === "yes";
  return html`
    <div class="p-task__chosen">
      <p class="p-task__chosen-q"><strong>${text(check.n)}. ${cap(check.question, 400)}</strong></p>
      <p class=${`p-task__chosen-a p-task__chosen-a--${ok ? "pass" : "fail"}`}>${ok ? "Passed" : "Failed"}${check.reason ? `: ${cap(check.reason, 2000)}` : ""}</p>
      ${file ? html`<div class="p-task__evidence"><${Evidence} key=${text(file.url || file.name)} file=${file} /></div>`
        : html`<p class="u-caption">No evidence was given for this check.</p>`}
      ${files.length > 1 ? html`
        <div class="p-task__pick" role="group" aria-label="Other evidence">
          ${files.map((f, i) => html`
            <button type="button" key=${text(f.url || f.name) + i} class="p-task__pick-item"
              aria-pressed=${i === pick ? "true" : "false"} onClick=${() => setPick(i)}>${cap(f.name, 80)}</button>`)}
        </div>` : null}
    </div>`;
}

function Rounds({ id, acceptance, query, ask = false }) {
  const rounds = list(acceptance && acceptance.rounds).filter((r) => r && typeof r === "object");
  // A question is never checked: the panel says so as the header does (M63 item 4; live, the panel still said "yet").
  if (rounds.length === 0) return html`<p class="u-caption">${roundsLine(0, { ask })}.</p>`;
  const round = pickRound(rounds, query.get("round"));
  const check = round && round.wellFormed ? pickCheck(round, query.get("check")) : null;
  const tabs = rounds.map((r) => ({ id: text(r.n), label: `Round ${text(r.n)}`, tone: r.outcome === "pass" ? "ok" : "bad" }));
  const actions = list(round.actions).slice(0, 50);

  return html`
    <div class="p-task__rounds">
      ${tabs.length > 1 ? html`<${Tabs} label="Check rounds" tabs=${tabs} current=${text(round.n)}
        onChange=${(n) => go(address(id, query, { round: n, check: null }))} />` : null}
      <p class="p-task__round-line">${cap(round.label, 80)}${round.by ? html` <span class="u-caption">by ${cap(round.by, 60)}</span>` : null}</p>
      ${round.wellFormed ? html`
        <div class="u-spread">
          <h2 class="p-task__h">The six checks</h2>
          <span class="u-caption">${passedCount(round)} passed</span>
        </div>
        <${CheckList} checks=${list(round.checks)} selected=${check ? check.n : null}
          onSelect=${(n) => go(address(id, query, { round: round.n, check: n }))} />
        <${ChosenCheck} check=${check} />
        ${actions.length ? html`
          <h2 class="p-task__h">What the Checker asked to change</h2>
          <ul class="p-task__actions">${actions.map((a, i) => html`<li key=${i}>${cap(a, 600)}</li>`)}</ul>` : null}` : html`
        <div class="p-task__verdict">
          <p><strong>${round.outcome === "pass" ? "Passed" : round.outcome === "fail" ? "Failed" : "No clear verdict"}</strong></p>
          ${round.reason ? html`<p>${cap(round.reason, 2000)}</p>` : null}
        </div>`}
    </div>`;
}

// --- How it went: the five stages and the timeline of steps ------------------------------------------------------

function HowItWent({ stages, timeline, now, shown = false, facts = [] }) {
  const list5 = html`<ol class="p-task__stages">
    ${list(stages).filter((s) => s && s.id).map((s) => html`
      <li key=${text(s.id)} class=${`p-task__stage p-task__stage--${text(s.state)}`}>
        <span class="p-task__stage-name">${cap(s.label, 60)}</span>
        <span class="u-caption">${s.state === "skipped" ? "Skipped for a small task." : STAGE_WORDS[s.state] || cap(s.state, 30)}</span>
      </li>`)}
  </ol>`;
  const steps = list(timeline).length ? html`<${Timeline} items=${list(timeline).slice(0, 100)} now=${now} />`
    : html`<p class="u-caption">No steps yet.</p>`;
  // In the rail the five stages are in view under the heading; the steps open under them.
  if (shown) {
    return html`
      <h2 class="p-task__over">${PANEL_WORDS.how}</h2>
      ${facts.length ? html`<dl class="p-task__facts">
        ${facts.map((f) => html`<div key=${f.id} class="p-task__fact">
          <dt>${f.label}</dt>
          <dd title=${f.title || undefined}>${f.value}</dd>
        </div>`)}
      </dl>` : null}
      ${list5}
      <details class="p-task__how">
        <summary class="p-task__summary">${PANEL_WORDS.steps}</summary>
        ${steps}
      </details>`;
  }
  return html`
    <details class="p-task__how">
      <summary class="p-task__summary">How it went</summary>
      ${list5}
      ${steps}
    </details>`;
}

// Once a task is accepted, what can come next is the point of the panel: it goes at the top, above the checks (M63
// item 48). Otherwise it keeps its place below them.
export const nextOnTop = (acceptance, next) => !!acceptance && acceptance.state === "accepted" && list(next).length > 0;

function NextUp({ items }) {
  if (!items.length) return null;
  return html`
    <div class="p-task__next">
      <h2 class="p-task__h">What can come next</h2>
      <ul class="p-task__next-list">
        ${items.map((n, i) => html`
          <li key=${i} class=${`p-task__next-item${n.ready ? "" : " p-task__next-item--dim"}`}>
            <a class="p-task__next-link" href=${n.href}>
              <${Icon} name="arrow-right" size=${14} />
              <span class="p-task__next-text">
                <span class="p-task__next-label">${n.label}</span>
                ${n.label !== n.title ? html`<span class="u-caption">${n.title}</span>` : null}
              </span>
            </a>
            ${!n.ready && n.why ? html`<p class="p-task__next-why">${n.why}</p>` : null}
          </li>`)}
      </ul>
    </div>`;
}

// --- The story -----------------------------------------------------------------------------------------------------

function DocItem({ item, open, onToggle }) {
  const box = `p-task-doc-${item.id}`;
  return html`
    <div class="p-task__docitem">
      <${Conversation} messages=${[{ marker: item.marker }]} />
      <${Sheet} as="article" label=${cap(item.label, 40) || "A document"}><div class="p-task__docbox">
        <button type="button" class="p-task__doc-toggle" aria-expanded=${open ? "true" : "false"} aria-controls=${box}
          onClick=${onToggle}>
          <${Icon} name=${open ? "chevron-down" : "chevron-right"} size=${14} />
          <span>${open ? "Hide" : "Read"} the ${cap(item.label, 40).toLowerCase() || "document"}</span>
        </button>
        ${open ? html`<div class="p-task__doc" id=${box}><${DocView} doc=${item.doc} unclear=${item.unclear} /></div>` : null}
      </div><//>
    </div>`;
}

function Story({ id, items, query }) {
  if (!items.length) return html`<p class="u-muted">Nothing has been said yet.</p>`;
  const blocks = [];
  let run = [];
  const flush = () => {
    if (run.length) blocks.push(html`<${Conversation} key=${`c${blocks.length}`} messages=${run} />`);
    run = [];
  };
  for (const it of items) {
    if (it.kind === "message") { run.push(it.message); continue; }
    flush();
    if (it.kind === "answer") blocks.push(html`<div key="answer" class="p-task__paper"><${Sheet} wide=${true}><${AnswerView} ask=${it.ask} /><//></div>`);
    else if (it.kind === "doc") {
      const open = query.get("doc") === it.id;
      blocks.push(html`<${DocItem} key=${`d${it.id}`} item=${it} open=${open}
        onToggle=${() => go(address(id, query, { doc: open ? null : it.id }))} />`);
    }
  }
  flush();
  return html`<div class="p-task__story">${blocks}</div>`;
}

// The result's text file, read on the page (T114): its kind icon, its name and size and Open in the card's head; its
// leading facts (title, channel, planned) as label and value; then its text, held to the card's height with a fade
// when there is more. One request for the one file; nothing is drawn while it is read, when it fails or when it has
// no text. Open shows the whole text already read in the work panel (or in place when there is none).
function useFileText(url) {
  const [s, setS] = useState({ url: null, data: null });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    api.get(url)
      .then((data) => { if (live) setS({ url, data: data && typeof data === "object" ? data : null }); })
      .catch(() => { if (live) setS({ url, data: null }); });
    return () => { live = false; };
  }, [url]);
  return s.url === url ? s.data : null;
}

function ReadText({ fields, body, truncated }) {
  return html`
    ${fields.length ? html`<dl class="p-task__read-facts">
      ${fields.map(([k, v], i) => html`<div key=${i} class="p-task__read-fact"><dt>${k}</dt><dd>${v}</dd></div>`)}
    </dl>` : null}
    ${body.trim() ? html`<div class="p-task__read-text"><${Markdown} text=${body} /></div>` : null}
    ${truncated ? html`<p class="u-caption">${READ_WORDS.part}</p>` : null}`;
}

function Reader({ file, openPanel }) {
  const data = useFileText(file ? file.viewUrl : null);
  const body = useRef(null);
  const [more, setMore] = useState(false);
  const [wide, setWide] = useState(false);
  const read = data ? frontMatter(cap(data.text, 262144)) : { fields: [], body: "" };
  const has = read.fields.length > 0 || read.body.trim() !== "";
  useEffect(() => {
    const el = body.current;
    if (!el) return undefined;
    const measure = () => setMore(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [has, wide, data && data.text]);
  if (!file || !data || !has) return null;
  const name = text(file.name).split("/").pop() || text(file.name);
  const kind = fileKind(name);
  const open = () => {
    if (typeof openPanel === "function") {
      openPanel(html`<div class="p-task"><div class="p-task__read-whole"><${ReadText} ...${read} truncated=${data.truncated === true} /></div></div>`, { title: name });
    } else setWide(!wide);
  };
  return html`<div class="p-task__paper p-task__paper--read"><${Sheet} wide=${true}>
    <${Card} padding="none" class="p-task__read" role="region" aria-label=${`${READ_WORDS.label}: ${name}`}>
      <div class="p-task__read-head">
        <span class="p-task__read-icon"><${Icon} name=${FILE_ICONS[kind]} size=${16} /></span>
        <h2 class="p-task__read-name" title=${name}>${name}</h2>
        ${Number.isFinite(Number(file.size)) ? html`<span class="p-task__read-size">${bytes(file.size)}</span>` : null}
        <${Button} variant="ghost" size="sm" icon="external" class="p-task__read-open" aria-label=${`${READ_WORDS.open} ${name}`}
          aria-expanded=${typeof openPanel === "function" ? undefined : wide ? "true" : "false"} onClick=${open}>${READ_WORDS.open}<//>
      </div>
      <div class=${`p-task__read-body${more && !wide ? " p-task__read-body--more" : ""}${wide ? " p-task__read-body--whole" : ""}`} ref=${body}>
        <${ReadText} ...${read} truncated=${data.truncated === true} />
      </div>
    <//>
  <//></div>`;
}

function FilesPanel({ files }) {
  return html`<div class="p-task"><div class="p-task__files">${files.map((f, i) => html`<${FileCard} key=${text(f.url || f.name) + i} file=${f} />`)}</div></div>`;
}

// --- The page --------------------------------------------------------------------------------------------------

// The task's versions, read when `stamp` changes. null while unread, when the route is missing (an older home
// server answers 404) or when it fails: then nothing is shown and the page is as it was.
function usePieces(id, on, stamp) {
  const [s, setS] = useState({ id: null, data: null });
  useEffect(() => {
    if (!on || !id) return undefined;
    let live = true;
    api.get(`/api/tasks/${encodeURIComponent(id)}/pieces`)
      .then((data) => { if (live) setS({ id, data: data && typeof data === "object" ? data : null }); })
      .catch(() => { if (live) setS({ id, data: null }); });
    return () => { live = false; };
  }, [id, on, stamp]);
  return s.id === id ? s.data : null;
}

export default function Page({ route }) {
  const app = useApp() || {};
  const id = text(route && route.parts && route.parts[1]);
  const query = (route && route.query) || new URLSearchParams();
  const res = useResource(id ? `/api/tasks/${encodeURIComponent(id)}` : null, { every: 10000 });
  const [said, setSaid] = useState(null);
  const opened = useRef(null);
  const root = useRef(null);
  const bar = useRef(null);
  const layout = useLayout(root);
  const d = res.data;
  const files = list(d && d.files).filter((f) => f && typeof f === "object").slice(0, 200);
  const acceptance = (d && d.acceptance) || {};
  const pickItem = pickItemOf(d);
  const [pickedHere, setPickedHere] = useState(null);
  const lastPieces = useRef(null);
  const pieces = usePieces(id, !!d && !pickItem, piecesStamp(d, lastPieces.current));
  lastPieces.current = pieces;
  // The task's sites, read when the task moves (kit/site.js; nothing for a task with none or an older home server).
  const view = useSiteView({ id, stamp: piecesStamp(d, null) });
  const mode = d ? layoutOf({ site: view.site, pick: pickItem, pieces }) : "column";
  const barred = layout.narrow && !!acceptance.accept && !pickItem;
  const barHeight = useHeight(bar, barred && mode === "column");

  // Where the owner is, in the top bar: Tasks / STH-25. The stage's own links (the preview) stay on the stage.
  const t0 = (d && d.task) || {};
  const crumbs = [{ label: "Tasks", href: "#/tasks" }, { label: cap(t0.identifier || id, 60) || "Task" }];
  const crumbKey = JSON.stringify(crumbs);
  useEffect(() => { if (typeof app.setTop === "function") app.setTop({ crumbs }); }, [crumbKey]);
  useEffect(() => {
    if (mode === "column" || typeof document === "undefined" || !t0.title) return;
    const company = (app.shell && app.shell.company && app.shell.company.name) || "";
    document.title = [cap(t0.title, 300), company].filter(Boolean).join(" · ");
  }, [mode, t0.title]);

  const showFiles = () => {
    if (typeof app.openPanel === "function") app.openPanel(html`<${FilesPanel} files=${files} />`, { title: `Files (${files.length})` });
  };

  // The work panel opens from the start with ?files=1, once per task. The right side is the acceptance panel's.
  useEffect(() => {
    if (!d || opened.current === id) return;
    opened.current = id;
    if (query.get("files") === "1" && files.length > 0) showFiles();
  }, [d, id]);
  useEffect(() => () => { if (typeof app.closePanel === "function" && opened.current) app.closePanel(); }, []);

  // After Accept, Send back or a note the line that says what happened takes focus, so the keyboard does not
  // fall to the page's body when the button it was on goes away (M52 K3).
  const saidRef = useRef(null);
  const after = (message) => {
    setSaid(message);
    setTimeout(() => saidRef.current?.focus(), 0);
    if (typeof app.announce === "function") app.announce(message);
    if (typeof app.refreshShell === "function") app.refreshShell();
    res.refresh();
  };

  const rootClass = ["p-task", layout.side ? "p-task--side" : "", barred ? "p-task--barred" : ""].filter(Boolean).join(" ");
  const b = layout.side ? layout.bleed : null;
  const rootStyle = [layout.side && layout.width ? `--p-task-w: ${layout.width}px` : "",
    b ? `--p-task-bl: ${b.left}px; --p-task-br: ${b.right}px; --p-task-bt: ${b.top}px; --p-task-bb: ${b.bottom}px; --p-task-gut: ${b.gutter}px` : "",
    barred && barHeight ? `--p-task-bar: ${barHeight}px` : ""]
    .filter(Boolean).join("; ") || undefined;

  if (!d) {
    const missing = res.error && (res.error.code === "task_not_found" || res.error.status === 404);
    return html`
      <div class="p-task" ref=${root}>
        <${RoomHeader} glimpse=${res.error ? glimpseFor("task") : null} pull title=${missing ? "Task not found" : "Task"} back=${BACK} crumbs=${crumbs} />
        ${missing ? html`<${Empty} title="That task is not here."><a class="p-task__empty-link" href="#/tasks">All tasks</a><//>`
          : res.loading || !res.error ? html`<${Loading} lines=${6} label="Loading the task" />`
          : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
      </div>`;
  }

  const t = d.task || {};
  const rounds = list(acceptance.rounds);
  const needs = otherNeeds(d.needsYou, acceptance);
  const who = t.who || null;
  const job = d.job && typeof d.job === "object" ? d.job : t.job && typeof t.job === "object" ? t.job : null;
  const jobLink = job ? jobHref(job) : null;
  const follows = d.follows && typeof d.follows === "object" ? d.follows : null;
  const dept = text((job && job.department) || t.department);
  const canStop = acceptance.state !== "stopped" && acceptance.state !== "accepted" && t.column !== "canceled";
  const next = nextLinks(d.next, t);
  const story = storyOf(d);
  const state = acceptance.state || "not_ready";
  const readable = askOf(d) ? null : readableOf(d);

  if (mode !== "column") {
    const parts = {
      id, d, t, query, view, acceptance, pickItem, pieces, pickedHere, needs, next, story, files, canStop,
      said, saidRef, after, showFiles, onChanged: res.refresh, root,
      onPicked: (r) => { setPickedHere(r && r.variant ? r.variant : null); after(text(r && r.message) || "Done."); },
    };
    return mode === "site" ? html`<${SitePage} ...${parts} />` : html`<${VersionsPage} ...${parts} />`;
  }

  const panel = html`
    <aside class="p-task__panel" aria-label="Acceptance">
      <div class="p-task__rail">
        <section class="p-task__sec">
          <div class="p-task__state-row">
            <h2 class="p-task__over">${PANEL_WORDS.acceptance}</h2>
            <${Chip} dot=${STATE_DOTS[state] || "off"}>${stateWord(acceptance)}<//>
          </div>
          ${nextOnTop(acceptance, next) ? html`<${NextUp} items=${next} />` : null}
          ${pickItem ? html`<${PickNudge} target="p-task-versions" />`
            : !layout.narrow ? html`<${AcceptBar} acceptance=${acceptance} onDone=${after} onChanged=${res.refresh} />` : null}
          ${said ? html`<p class="p-task__said" role="status" tabindex="-1" ref=${saidRef}>${said}</p>` : null}
        </section>
        ${needs.length ? html`
          <section class="p-task__sec">
            <h2 class="p-task__over">${PANEL_WORDS.also}</h2>
            <div class="p-task__needs">
              ${needs.map((item) => html`<${Sheet} key=${item.id} wide=${true}><${DecisionCard} item=${item} onDone=${() => after("Done.")} /><//>`)}
            </div>
          </section>` : null}
        <section class="p-task__sec">
          <h2 class="p-task__over">${PANEL_WORDS.checks}</h2>
          <${Rounds} id=${id} acceptance=${acceptance} query=${query} ask=${t.ask === true} />
        </section>
        ${nextOnTop(acceptance, next) || !next.length ? null : html`<section class="p-task__sec"><${NextUp} items=${next} /></section>`}
        <section class="p-task__sec">
          <${HowItWent} stages=${d.stages} timeline=${d.timeline} now=${d.generatedAt} shown=${true} facts=${howFacts(d)} />
        </section>
        <div class="p-task__tools">
          ${files.length ? html`<${Button} variant="plain" size="sm" icon="panel" onClick=${showFiles}>Files (${files.length})<//>` : null}
          ${t.id ? html`<${SendNote} task=${t} onDone=${after} />` : null}
          ${canStop && t.id ? html`<div class="p-task__tools-end"><${StopTask} task=${t} onDone=${after} /></div>` : null}
        </div>
      </div>
    </aside>`;

  // The versions: on paper while the owner's pick waits (a decision), on the ground once picked.
  const versions = html`<${Versions} id="p-task-versions" item=${pickItem} pieces=${pieces} picked=${pickedHere}
    onDone=${(r) => { setPickedHere(r && r.variant ? r.variant : null); after(text(r && r.message) || "Done."); }} />`;

  return html`
    <div class=${rootClass} ref=${root} style=${rootStyle}>
      <div class="p-task__head">
        <${RoomHeader} glimpse=${glimpseFor("task", dept)} pull title=${cap(t.title, 300) || "Task"} back=${BACK} crumbs=${crumbs}>
          <div class="p-task__meta">
            ${who ? html`<span class="p-task__who"><${Avatar} slug=${text(who.slug)} name=${text(who.name)} size=${20} /><span>${cap(who.name, 60)}</span></span>` : null}
            ${t.size ? html`<${Chip}>Size ${cap(t.size, 4)}<//>` : null}
            ${job && jobLink ? html`<a class="p-task__chip-link" href=${jobLink}><${Chip} dot=${dept || true}>${cap(job.title, 80)}<//></a>` : null}
            ${follows && (follows.identifier || follows.taskId) ? html`
              <a class="p-task__chip-link" href=${`#/tasks/${encodeURIComponent(text(follows.identifier || follows.taskId))}`}>
                <${Chip} icon="link">Follows ${cap(follows.title || follows.identifier, 80)}<//>
              </a>` : null}
            ${t.schedule ? html`<${Chip} icon="clock">${cap(t.schedule.label, 60)}<//>` : null}
            <span class="u-caption">${roundsLine(rounds.length, { ask: t.ask === true })}</span>
          </div>
          ${waitingLine(t.queue) && !askOf(d) ? html`<p class="p-task__turn"><${Icon} name="clock" size=${14} /><span>${waitingLine(t.queue)}</span></p>` : null}
        <//>
      </div>
      ${panel}
      <section class="p-task__main" aria-label="What was said">
        ${pickItem ? html`<${Sheet} wide=${true}>${versions}<//>` : versions}
        <${SiteView} id=${id} stamp=${piecesStamp(d, null)} htmlId="p-task-sites" />
        ${story.length && !askOf(d) ? html`<h2 class="p-task__h p-task__story-h">What was said</h2>` : null}
        <${Story} id=${id} items=${story} query=${query} />
        ${readable ? html`<${Reader} key=${readable.viewUrl} file=${readable} openPanel=${app.openPanel} />` : null}
      </section>
      ${barred ? html`
        <div class="p-task__bar" ref=${bar} role="region" aria-label="Accept or send back">
          <span class="p-task__bar-state"><${StatusDot} tone=${STATE_DOTS[state] || "off"} label=${stateWord(acceptance)} pulse=${false} /></span>
          <${AcceptBar} acceptance=${acceptance} onDone=${after} onChanged=${res.refresh} />
        </div>` : null}
    </div>`;
}

// --- A task on a stage --------------------------------------------------------------------------------------------

// The sections under the first screen: the story in one reading column, the checks (with ?round and ?check), the
// files and how it went. Each is a k-sect.
function Below({ id, d, t, query, story, files, showFiles }) {
  const acceptance = d.acceptance || {};
  const shown = files.slice(0, 6);
  return html`
    <section class="k-sect p-task__sect" aria-labelledby="p-task-story-h">
      <h2 id="p-task-story-h">What was said</h2>
      <div class="p-task__col"><${Story} id=${id} items=${story} query=${query} /></div>
    </section>
    <section class="k-sect p-task__sect" id="p-task-checks" tabindex="-1" aria-labelledby="p-task-checks-h">
      <h2 id="p-task-checks-h">The checks <span class="p-task__count">${roundsLine(list(acceptance.rounds).length, { ask: t.ask === true })}</span></h2>
      <div class="p-task__col"><${Rounds} id=${id} acceptance=${acceptance} query=${query} ask=${t.ask === true} /></div>
    </section>
    ${files.length ? html`
      <section class="k-sect p-task__sect" aria-labelledby="p-task-files-h">
        <h2 id="p-task-files-h">Files <span class="p-task__count">${files.length}</span></h2>
        <div class="p-task__col">
          <div class="p-task__files">${shown.map((f, i) => html`<${FileCard} key=${text(f.url || f.name) + i} file=${f} />`)}</div>
          ${files.length > shown.length ? html`<div class="p-task__more-files"><${Button} variant="plain" size="sm" icon="panel" onClick=${showFiles}>All ${files.length} files<//></div>` : null}
        </div>
      </section>` : null}
    <section class="k-sect p-task__sect">
      <div class="p-task__col"><${HowItWent} stages=${d.stages} timeline=${d.timeline} now=${d.generatedAt} /></div>
    </section>`;
}

// The acceptance facts in the rail: the state, each round with its checks (choosing one opens it under the first
// screen), the other things waiting on the owner, and what can come next. `fold` (a site's rail): the state and its
// rounds are a fold like the scores above them, the state on its row, so the rail's first screen ends above the foot;
// `tools` (a note to the Chief of staff, Stop this task) open in it under the rounds.
function Facts({ id, query, acceptance, needs, next, after, said, saidRef, fold = false, tools = null }) {
  const state = acceptance.state || "not_ready";
  const rows = roundRows(acceptance.rounds);
  const open = (n) => {
    go(address(id, query, { round: n, check: null }));
    setTimeout(() => {
      const el = typeof document !== "undefined" ? document.getElementById("p-task-checks") : null;
      if (el) { el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true }); }
    }, 0);
  };
  const dot = html`<${StatusDot} tone=${STATE_DOTS[state] || "off"} label=${stateWord(acceptance)} pulse=${false} />`;
  const roundList = html`
      ${rows.length ? html`<ul class="p-task__rounds-list">
        ${rows.map((r) => html`<li key=${text(r.n)}>
          <button type="button" class="p-task__round-row" onClick=${() => open(r.n)}>
            <span class=${`p-task__round-mark p-task__round-mark--${r.tone}`} aria-hidden="true"><${Icon} name=${r.tone === "ok" ? "check" : r.tone === "bad" ? "cross" : "loop"} size=${14} /></span>
            <span class="p-task__round-name">${r.label}</span>
            ${r.checks ? html`<span class="p-task__round-checks">${r.checks}</span>` : null}
          </button>
        </li>`)}
      </ul>` : html`<p class="k-say">${roundsLine(0)}.</p>`}`;
  return html`
    ${said ? html`<${Blk}><p class="p-task__said" role="status" tabindex="-1" ref=${saidRef}>${said}</p><//>` : null}
    ${fold
      ? html`<div class="k-site__folds"><${SiteFold} title="Acceptance" aside=${dot}>${roundList}${tools}<//></div>`
      : html`<${Blk} title="Acceptance" aside=${dot}>${roundList}<//>`}
    ${needs.length ? html`<${Blk} title="Also waiting on you">
      <div class="p-task__needs">${needs.map((item) => html`<${Sheet} key=${item.id} wide=${true}><${DecisionCard} item=${item} onDone=${() => after("Done.")} /><//>`)}</div>
    <//>` : null}
    ${next.length ? html`<${Blk}><${NextUp} items=${next} /><//>` : null}`;
}

// The foot when no pick waits: Accept, then under a divider the note with Send back, and the menu (a note to the
// Chief of staff, Stop this task). On a phone Accept shows with "More", which opens the rest.
function useAcceptFoot({ acceptance, task, canStop, onDone, onChanged }) {
  const a = useAccept({ acceptance, onDone, onChanged });
  const [tool, setTool] = useState(null);
  const accept = acceptance && acceptance.accept;
  const closeTool = () => {
    setTool(null);
    setTimeout(() => {
      const el = typeof document !== "undefined" ? document.querySelector(".p-task__menu .k-menu__trigger") : null;
      if (el) el.focus();
    }, 0);
  };
  const items = [
    task.id ? { id: "note", label: "Send a note", icon: "reply", onSelect: () => setTool("note") } : null,
    canStop && task.id ? { id: "stop", label: "Stop this task", icon: "cross", danger: true, onSelect: () => setTool("stop") } : null,
  ].filter(Boolean);
  const done = (m) => { setTool(null); onDone(m); };
  const primary = accept ? html`
    <${Button} variant="accept" busy=${a.busy} onClick=${a.doAccept}>${text(accept.label) || "Accept"}<//>
    ${a.error ? html`<${Refused} error=${a.error} />` : null}` : null;
  const rest = html`
    ${a.sendBack ? html`<form class="p-task__sendback" onSubmit=${a.doSendBack}>
      <${TextArea} aria-label="What should change? Needed to send it back" autoGrow rows=${1} maxLength=${4000} value=${a.note}
        disabled=${a.busy} placeholder="What should change?" onInput=${(e) => a.setNote(e.currentTarget.value)} />
      <div class="p-task__foot-row">
        <${Button} type="submit" busy=${a.busy && !!a.note.trim()} disabled=${a.busy || !a.note.trim()}>${text(a.sendBack.label) || "Send back"}<//>
        ${items.length ? html`<div class="p-task__menu"><${Menu} label="More actions" icon="more" items=${items} /></div>` : null}
      </div>
    </form>` : items.length ? html`<div class="p-task__foot-row"><div class="p-task__menu"><${Menu} label="More actions" icon="more" items=${items} /></div></div>` : null}
    ${tool === "note" ? html`<${SendNote} task=${task} onDone=${done} open=${true} onClose=${closeTool} />` : null}
    ${tool === "stop" ? html`<${StopTask} task=${task} onDone=${done} open=${true} onClose=${closeTool} />` : null}`;
  return { primary, rest };
}

// A task that built a site: the site on the stage, its versions in the strip, the rail to decide in.
function SitePage({ id, d, t, query, view, acceptance, pickItem, pieces, needs, next, story, files, canStop, said, saidRef, after, showFiles, onChanged, onPicked, root }) {
  const site = view.site;
  const src = pickItem || pieces;
  const byLetter = src ? scoresByLetter(src) : {};
  const letter = site && typeof site.variant === "string" ? site.variant : null;
  const chosen = src && letter ? versionsOf(src).find((v) => v.id === letter && !v.missing && v.review) : null;
  const kindOfPiece = pickItem ? pickItem.pieceKind : pieces && pieces.kind;
  const round = pickItem && Number.isInteger(pickItem.round) ? pickItem.round : pieces && Number.isInteger(pieces.round) ? pieces.round : list(acceptance.rounds).length;
  const job = d.job && typeof d.job === "object" ? d.job : t.job && typeof t.job === "object" ? t.job : null;
  const lede = pickItem && pickItem.summary ? cap(pickItem.summary, 200) : factWords(t, job);
  const accepting = useAcceptFoot({ acceptance, task: t, canStop, onDone: after, onChanged });
  const foot = pickItem
    ? html`<${Sheet} label="Your pick"><${PickFoot} item=${pickItem} chosen=${letter} focusDone=${false} onDone=${onPicked} onChanged=${onChanged} /><//>`
    : acceptance.accept ? accepting : null;
  // The Art director's scores as a fold under the findings, closed, so the rail's first screen ends above the foot.
  const scores = chosen ? html`<${SiteFold} title="The Art director's scores" aside=${`Version ${chosen.letter}`}>
      <${Scores} review=${chosen.review} kind=${kindOfPiece} compact=${true} />
    <//>` : null;
  return html`<div class="p-task p-task--stage" ref=${root}>
    <${StageLayout} kind=${stageKind(acceptance, round)} title=${cap(t.title, 300) || "Task"} lede=${lede || null}
      label=${stageLabel(site)}
      stage=${html`<div class="p-task__site" id="p-task-sites" tabindex="-1"><${SiteStage} view=${view} scores=${byLetter} pick=${pickItem ? { item: pickItem, onDone: onPicked, onChanged } : null} /></div>`}
      strip=${view.many ? html`<${SiteStrip} view=${view} scores=${byLetter} />` : null}
      rail=${html`<${SiteRail} view=${view}>${scores}<//><${Facts} id=${id} query=${query} acceptance=${acceptance} needs=${needs} next=${next} after=${after} said=${said} saidRef=${saidRef} fold=${true}
        tools=${t.id && (pickItem || !acceptance.accept) ? html`<div class="p-task__tools p-task__tools--rail">
          <${SendNote} task=${t} onDone=${after} />
          ${canStop ? html`<${StopTask} task=${t} onDone=${after} />` : null}
        </div>` : null} />`}
      foot=${foot}
      more=${html`<${Below} id=${id} d=${d} t=${t} query=${query} story=${story} files=${files} showFiles=${showFiles} />`} />
  </div>`;
}

// A task whose versions have pictures and no site: the pick card's own stage, the acceptance and the story under it.
function VersionsPage({ id, d, t, query, acceptance, pickItem, pieces, pickedHere, needs, next, story, files, said, saidRef, after, showFiles, onPicked, root }) {
  return html`<div class="p-task p-task--stage" ref=${root}>
    <div id="p-task-versions" tabindex="-1">
      ${pickItem ? html`<${Sheet} wide=${true}><${PickCard} item=${pickItem} focusDone=${false} onDone=${onPicked} /><//>`
        : html`<${PickCard} pieces=${pieces} readOnly=${true} picked=${pickedHere} />`}
    </div>
    <div class="p-task__below">
      <div class="p-task__below-facts"><${Facts} id=${id} query=${query} acceptance=${acceptance} needs=${needs} next=${next} after=${after} said=${said} saidRef=${saidRef} /></div>
      <${Below} id=${id} d=${d} t=${t} query=${query} story=${story} files=${files} showFiles=${showFiles} />
    </div>
  </div>`;
}
