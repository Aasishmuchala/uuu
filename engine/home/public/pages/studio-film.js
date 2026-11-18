// A film in Studio (PLAN-V5 T45b, K14 step 5; PLAN-COOK T52, S04), at #/dashboards/studio?film=<task id>: the owner
// follows a film as it is made, on a stage. The chosen take plays on the stage (the kit's Player, its stills under it);
// the strip under it holds one card a shot (its still, its cost, its take, its state) under what the film has spent of
// what was approved; the rail holds the film's state, title and direction, then three blocks: the take with the Art
// director's verdict and the storyboard beside the picture the take's service was sent, the prompt as sent with what
// changed from what the owner approved, and the shot's move with the requests the service did not start. Under the
// first screen, every shot and every approval as rows. Money, takes and states come from the door's ledger through the
// home server (C12); figures are the server's numbers, its sentences shown as sent (R4). Each take names its own job's
// service (Runway or Higgsfield) in the server's words; the page's own Runway words stand in only for an older server.
// The Artist's own words (the move, the prompt, a verdict's reason) are shown as text and nowhere else. Only addresses
// under /api/ reach a picture or a video, each through `safeApi`; no link in agent text is followed.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, when } from "../lib/format.js";
import {
  Blk, Button, DataTable, DiffText, ErrorNotice, Loading, Meter, Notice, Pair, Player, Segmented, Shot, St, StageLayout,
  Strip, Tag, TakeCard, Verdict,
} from "../kit/index.js";
import { safeApi, studioHref, useBringIntoView } from "./studio.js";

const EVERY = 10000;
const HERE = "#/dashboards/studio";
const MAX_SHOTS = 12;
const MAX_TAKES = 6;
const MAX_NOT_STARTED = 6;
const PROMPT_SHOWN = 240;

const text = (v, max = 200) => (v === null || v === undefined ? "" : String(v).slice(0, max));
const items = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max) : []);
const credit = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

// ---- words ---------------------------------------------------------------------------------------------------

// One credit is a cent of a dollar, as the home server counts it.
export function dollarsOf(credits) {
  return credit(credits) ? `$${(Number(credits) / 100).toFixed(2)}` : "";
}

// "$1.75 of $6.00": what is spent against what the owner approved. A spend the ledger could not give is said so.
export function creditWords(spent, budget) {
  const b = credit(budget) ? Number(budget) : 0;
  return credit(spent) ? `${dollarsOf(spent)} of ${dollarsOf(b)}` : `Spent so far not known, of ${dollarsOf(b)}`;
}

// "$1.75 of $6.00".
export function totalWords(spent, budget) {
  return creditWords(spent, budget);
}

// A take's own cost: "$0.25".
export function takeCredits(n) {
  return dollarsOf(n);
}

// The share of the approved budget spent, 0 to 100, for the bar.
export function spentShare(spent, budget) {
  const b = Number(budget);
  if (!credit(spent) || !(b > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(spent) / b) * 100)));
}

// The services a take may name, as the home server names them; anything else is Runway (the door's own default).
export const SERVICES = Object.freeze(["Runway", "Higgsfield"]);
export const serviceName = (v) => (SERVICES.includes(v) ? v : "Runway");
// "Runway", "Higgsfield" or "Runway and Higgsfield" for a list of services, in that order.
export const servicesWords = (list) => SERVICES.filter((s) => (Array.isArray(list) ? list : []).map(serviceName).includes(s)).join(" and ") || "Runway";

const TAKE_STATES = { making: "Being made", made: "Made", failed: "Failed" };
const TAKE_TONES = { making: "neutral", made: "ok", refused: "bad", failed: "bad" };
// A take's state in words; a refusal names the service that refused it (`service`, the take's own).
export const takeStateWords = (state, service) => (state === "refused" ? `Refused by ${serviceName(service)}` : TAKE_STATES[state] || "Not known");
export const takeStateTone = (state) => TAKE_TONES[state] || "neutral";

// The Art director's verdict on a take: "Keep", "Retake: <reason>", or "Not looked at yet".
export function verdictWords(verdict) {
  if (!verdict || typeof verdict !== "object") return "Not looked at yet";
  if (verdict.verdict === "keep") return "Keep";
  if (verdict.verdict === "retake") {
    const why = text(verdict.reason, 200).trim();
    return why ? `Retake: ${why}` : "Retake";
  }
  return "Not looked at yet";
}
export const verdictTone = (verdict) => (verdict && verdict.verdict === "keep" ? "ok" : verdict && verdict.verdict === "retake" ? "warn" : "neutral");

// The film's state in the list, in words.
const FILM_STATES = { making: "Being made", done: "Done", stopped: "Stopped", "needs you": "Needs you", ended: "Approval ended" };
const FILM_TONES = { making: "neutral", done: "ok", stopped: "neutral", "needs you": "warn", ended: "warn" };
export const filmStateWords = (state) => FILM_STATES[state] || "Not known";
export const filmStateTone = (state) => FILM_TONES[state] || "neutral";

// The row of the Films list: "3 clips made, 2 kept".
export function clipsWords(clips, kept) {
  const c = Number.isInteger(clips) && clips >= 0 ? clips : 0;
  const k = Number.isInteger(kept) && kept >= 0 ? kept : 0;
  return `${c} ${c === 1 ? "clip" : "clips"} made, ${k} kept`;
}

// What the picture sent to the take's service says: the kept picture, or that the door no longer holds it (it keeps
// them a day).
export const GONE_WORDS = "No longer kept: the door keeps sent pictures for a day";
export function sentKind(sent) {
  if (sent === "gone") return "gone";
  return safeApi(sent) ? "picture" : "none";
}

// Whether any take is still being made, so the total says its service may still charge (the server's `stillCharging`).
export const anyMaking = (film) => items(film?.shots, MAX_SHOTS).some((s) => items(s.takes, MAX_TAKES).some((t) => t.state === "making"));
export const STILL_CHARGING = "Runway may still charge for clips that are being made.";
export const FROZEN_WORDS = "Runway refused two pictures or prompts in this film. It needs you.";
export const CHANGED_WORDS = "The shotlist was changed after you approved it. Each take shows what was sent to Runway.";

// The plain words the home server sends with a film (`labels`); these stand in when it sends none.
export const LABEL_WORDS = Object.freeze({
  approved: "What you approved",
  sentPrompt: "The prompt sent to Runway",
  sentPromptGone: "No longer kept: the door keeps what it sent for two days.",
  sentPromptNone: "The door kept no copy of this prompt.",
  changed: CHANGED_WORDS,
  notStarted: "Sent, not started by Runway",
  stillCharging: STILL_CHARGING,
});
export function labelsOf(film) {
  const l = film && film.labels && typeof film.labels === "object" ? film.labels : {};
  const out = {};
  for (const k of Object.keys(LABEL_WORDS)) out[k] = typeof l[k] === "string" && l[k].trim() ? text(l[k], 300) : LABEL_WORDS[k];
  return out;
}

// A take's own words that name its service: the server's whole sentences (`labels`), else made from its `service`, else
// (an older server, which named no service) the film's labels and the page's Runway words. { sentPrompt, sentPicture }.
export function takeWords(take, labels = LABEL_WORDS) {
  const t = take && typeof take === "object" ? take : {};
  const own = t.labels && typeof t.labels === "object" ? t.labels : {};
  const said = (k) => (typeof own[k] === "string" && own[k].trim() ? text(own[k], 300) : "");
  const named = SERVICES.includes(t.service) ? t.service : null;
  return {
    sentPrompt: said("sentPrompt") || (named ? `The prompt sent to ${named}` : text(labels.sentPrompt, 300) || LABEL_WORDS.sentPrompt),
    sentPicture: said("sentPicture") || `The picture sent to ${named || "Runway"}`,
  };
}

// What a take's sent prompt is: its text, "gone" (the door's job record expired) or "none" (no copy was kept).
export function sentPromptKind(value) {
  if (value === "gone") return "gone";
  return typeof value === "string" && value.trim() ? "text" : "none";
}

// A shot's requests its service did not start (nothing made, nothing charged), checked: [{ key, service, result, when,
// sent, prompt }], where `service` is the request's own ("Runway" when an older server names none), `result` the
// server's sentence for it or "", `sent` the kept picture's /api/ address or "" and `prompt` the prompt sent, "gone" or
// "none" (sentPromptKind).
export function notStartedOf(shot) {
  return items(shot?.notStarted, MAX_NOT_STARTED).map((n, i) => ({
    key: `${text(n.batch, 40)}-${text(n.job, 64)}-${i}`,
    service: serviceName(n.service),
    result: typeof n.result === "string" && n.result.trim() ? text(n.result, 300) : "",
    when: typeof n.at === "string" ? n.at.slice(0, 40) : "",
    sent: safeApi(n.sent) || "",
    prompt: sentPromptKind(n.sentPrompt) === "text" ? text(n.sentPrompt, 1000) : sentPromptKind(n.sentPrompt),
  }));
}

// The banners at the top of a film, in order: a frozen newest batch, a shotlist changed after approval, then the
// home server's own problem sentence (the ledger or the treatment could not be read).
export function filmBanners(film) {
  const out = [];
  const batches = Array.isArray(film?.batches) ? film.batches : [];
  const last = batches[batches.length - 1];
  if (last && last.frozen === true) out.push({ key: "frozen", tone: "warn", text: FROZEN_WORDS });
  if (film && film.changedAfterApproval === true) out.push({ key: "changed", tone: "warn", text: labelsOf(film).changed });
  if (film && typeof film.problem === "string" && film.problem && !(out.length && film.problem === FROZEN_WORDS)) {
    out.push({ key: "problem", tone: "warn", text: text(film.problem, 400) });
  }
  return out;
}

// The prompt as shown closed: cut at a word near the limit.
export function clampWords(value, max = PROMPT_SHOWN) {
  const s = text(value, 1000).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

// "Take 2" for t2.
export const takeName = (take) => (/^t[1-9]\d?$/.test(String(take)) ? `Take ${String(take).slice(1)}` : "Take");

// The edit's card, in Videos: ?video=<identifier>/<name>.
export function editHref(edit) {
  if (!edit || typeof edit !== "object") return null;
  const id = text(edit.identifier, 40);
  const name = text(edit.name, 120);
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id) || !/^[A-Za-z0-9._-]{1,120}$/.test(name)) return null;
  return studioHref({ video: `${id}/${name}` });
}


// ---- the stage: which take is shown, and its words -----------------------------------------------------------

// The page's own words on the stage, the strip and the rail (the server's sentences come in `labels`).
export const FILM_WORDS = Object.freeze({
  shots: "Shots",
  spent: "Spent on this film",
  spentOf: "Money spent of the approved budget",
  storyboard: "Storyboard",
  asSent: "your render, as sent",
  byArt: "the Art director's verdict",
  notLooked: "Not looked at yet",
  diffApproved: "you approved, not sent",
  diffSent: "sent, not approved",
  move: "The move",
  takes: "Takes of this shot",
  noTakes: "Not made yet",
  noTakesSay: "No clip has been made for this shot yet.",
  noShots: "The shots of this film could not be read.",
  allShots: "Every shot",
  approvals: "Approvals",
  edit: "Open the edit in Videos",
  task: "Open its task",
  films: "Films",
  film: "A film",
});

// "Shot 1, take 2".
export const takeLabel = (n, take) => `Shot ${n}, ${takeName(take && take.take).toLowerCase()}`;

// "5 s" for a shot's length, or "".
export function secondsWords(shot) {
  const s = Number(shot && shot.seconds);
  return Number.isFinite(s) && s > 0 ? `${s} s` : "";
}

// A take's clip, only when the home server's own address; else "" (the stage then shows its stills).
export function clipOf(take) {
  return take && typeof take === "object" ? safeApi(take.clip) || "" : "";
}

// A take's stills that are the home server's own addresses, at most six.
export function stillsOf(take) {
  const stills = take && Array.isArray(take.stills) ? take.stills : [];
  return stills.map(safeApi).filter(Boolean).slice(0, 6);
}

// The one chip a take's card shows: { tone, text, icon }.
export function takeChip(take) {
  const t = take && typeof take === "object" ? take : {};
  if (t.state === "made") {
    const v = t.verdict && t.verdict.verdict;
    if (v === "keep") return { tone: "good", text: "Made, kept", icon: "check" };
    if (v === "retake") return { tone: "warn", text: "Made, to retake", icon: "retake" };
    return { tone: "neutral", text: "Made" };
  }
  if (t.state === "making") return { tone: "neutral", text: "Being made", icon: "clock" };
  if (t.state === "refused" || t.state === "failed") return { tone: "bad", text: t.state === "refused" ? "Refused" : "Failed", icon: "cross" };
  return { tone: "neutral", text: takeStateWords(t.state) };
}

// What the rail shows of a take's prompt: "diff" (approved and sent differ), "same" (one text), or the sent prompt's
// "gone" or "none" (sentPromptKind), with both texts as text.
export function promptView(take) {
  const t = take && typeof take === "object" ? take : {};
  const approved = typeof t.approvedPrompt === "string" ? text(t.approvedPrompt, 1000).trim() : "";
  const kind = sentPromptKind(t.sentPrompt);
  if (kind !== "text") return { kind, approved, sent: "" };
  const sent = text(t.sentPrompt, 1000).trim();
  return { kind: approved && approved !== sent ? "diff" : "same", approved, sent };
}

// Whether a shot's newest take needs the owner to look: its service refused it or it failed, the Art director asked
// for it again, or the shotlist changed after approval and what was sent is not what was approved.
export function needsLook(take, changed) {
  if (!take || typeof take !== "object") return false;
  if (take.state === "refused" || take.state === "failed") return true;
  if (take.state === "made" && take.verdict && take.verdict.verdict === "retake") return true;
  return changed === true && promptView(take).kind === "diff";
}

// The take shown first: { shot, take } as indexes. The first shot whose newest take needs the owner; else the newest
// made take (the last in reading order); else the first shot's newest take, or none (take -1).
export function defaultPick(film) {
  const shots = items(film && film.shots, MAX_SHOTS);
  const changed = !!film && film.changedAfterApproval === true;
  const takesOf = (s) => items(s.takes, MAX_TAKES);
  for (let s = 0; s < shots.length; s += 1) {
    const takes = takesOf(shots[s]);
    if (takes.length && needsLook(takes[takes.length - 1], changed)) return { shot: s, take: takes.length - 1 };
  }
  for (let s = shots.length - 1; s >= 0; s -= 1) {
    const takes = takesOf(shots[s]);
    for (let t = takes.length - 1; t >= 0; t -= 1) if (takes[t].state === "made") return { shot: s, take: t };
  }
  return { shot: 0, take: shots.length ? takesOf(shots[0]).length - 1 : -1 };
}

// ---- the top bar: crumbs, "Film 1 of 3", the task --------------------------------------------------------------

const filmKey = (f) => (f && f.task ? text(f.task.identifier, 40) || text(f.task.id, 80) : "");

// "Film 1 of 3" with the films before and after this one in the Films list, or null when it is not listed.
export function filmPager(films, id) {
  const list = items(films, 30);
  const at = list.findIndex((f) => f.task && typeof id === "string" && id && (f.task.id === id || f.task.identifier === id));
  if (at < 0) return null;
  const href = (f) => (f && filmKey(f) ? studioHref({ film: filmKey(f) }) : null);
  return { label: `Film ${at + 1} of ${list.length}`, prev: href(list[at - 1]), next: href(list[at + 1]) };
}

export function filmCrumbs(identifier) {
  return [
    { label: "Dashboards", href: "#/dashboards" },
    { label: "Studio", href: HERE },
    { label: FILM_WORDS.films },
    { label: text(identifier, 40) || FILM_WORDS.film },
  ];
}

// The task's page, by its identifier ("STH-41"), or null.
export function taskHref(identifier) {
  const id = text(identifier, 40);
  return /^[A-Za-z0-9-]{1,40}$/.test(id) ? `#/tasks/${encodeURIComponent(id)}` : null;
}

// ---- under the first screen: every shot and every approval as rows ---------------------------------------------

export function shotRows(film) {
  return items(film && film.shots, MAX_SHOTS).map((shot, i) => {
    const takes = items(shot.takes, MAX_TAKES);
    const last = takes[takes.length - 1];
    return {
      id: `${text(shot.id, 8)}-${i}`, n: i + 1, board: safeApi(shot.board) || "", move: text(shot.move, 400),
      takes: takes.length ? `${takes.length} ${takes.length === 1 ? "take" : "takes"}` : "None yet",
      state: last ? takeChip(last).text : FILM_WORDS.noTakes,
      cost: takes.length ? takeCredits(shot.credits) || "$0.00" : "",
    };
  });
}

export function batchRows(film, now = Date.now()) {
  return items(film && film.batches, 20).map((b, i) => {
    const ends = Date.parse(b.expiresAt);
    return {
      id: `${text(b.id, 40)}-${i}`, approved: when(b.approvedAt), ends: when(b.expiresAt),
      budget: dollarsOf(b.budget), spent: dollarsOf(b.spent),
      refused: Number.isInteger(b.refused) && b.refused >= 0 ? String(b.refused) : "",
      state: b.frozen === true ? "Stopped, needs you" : Number.isFinite(ends) && ends < now ? "Ended" : "Open",
    };
  });
}

// ---- the Films list ------------------------------------------------------------------------------------------

// One row of the Films list: a link to the film opened in place.
export function FilmRow({ film, chosen }) {
  const t = film.task || {};
  const id = text(t.id, 80);
  const approved = when(film.approvedAt);
  return html`<li class=${`p-studio__film${chosen ? " p-studio__film--chosen" : ""}`}>
    <a class="p-studio__film-link" href=${studioHref({ film: id })} aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__film-name">
        <span class="p-studio__film-title">${text(t.title, 160) || "A film"}</span>
        <span class="p-studio__film-id">${text(t.identifier, 40)}</span>
      </span>
      <span class="p-studio__film-state"><${Tag} tone=${filmStateTone(film.state)}>${filmStateWords(film.state)}<//></span>
      <span class="p-studio__film-facts">
        <span class="p-studio__fact">${approved ? `Approved ${approved}` : "Not approved yet"}</span>
        <span class="p-studio__fact">${rowWords(film)}</span>
        <span class="p-studio__fact">${clipsWords(film.clips, film.kept)}</span>
      </span>
      ${film.problem ? html`<span class="p-studio__film-problem">${text(film.problem, 300)}</span>` : null}
    </a>
  </li>`;
}

// ---- the rail ------------------------------------------------------------------------------------------------

function Prompt({ value, id, moreWords = "Show all" }) {
  const [open, setOpen] = useState(false);
  const full = text(value, 1000).trim();
  if (!full) return null;
  const short = clampWords(full);
  const more = short !== full;
  return html`<div class="p-studio-film__clamp">
    <p class="p-studio-film__prompt" id=${id}>${open || !more ? full : short}</p>
    ${more ? html`<button type="button" class="p-studio-film__more" aria-expanded=${open ? "true" : "false"} aria-controls=${id} onClick=${() => setOpen(!open)}>${open ? "Show less" : moreWords}</button>` : null}
  </div>`;
}

// The requests its service did not start, under a shot: quiet text, each with what was sent.
function NotStarted({ shot, labels }) {
  const list = notStartedOf(shot);
  if (!list.length) return null;
  const id = text(shot.id, 8);
  return html`<ul class="p-studio-film__not-started" aria-label=${`Requests for shot ${id} that ${servicesWords(list.map((n) => n.service))} did not start`}>
    ${list.map((n, i) => html`<li key=${n.key} class="p-studio-film__not-started-item">
      <p class="p-studio-film__not-started-head">
        <span>${n.result || labels.notStarted}</span>
        ${n.when ? html`<span title=${fullWhen(n.when)}>${when(n.when)}</span>` : null}
        ${n.sent ? html`<a href=${n.sent}>The picture sent</a>` : null}
      </p>
      ${n.prompt === "gone" || n.prompt === "none"
        ? html`<p class="p-studio-film__none">${n.prompt === "gone" ? labels.sentPromptGone : labels.sentPromptNone}</p>`
        : html`<${Prompt} value=${n.prompt} id=${`p-studio-film-ns-${id}-${i}`} moreWords="Read all" />`}
    </li>`)}
  </ul>`;
}

// The Art director's verdict on a made take, or the take's state while it is not made.
function TakeVerdict({ take }) {
  const state = take.state;
  if (state === "made") {
    const v = take.verdict && take.verdict.verdict;
    if (v !== "keep" && v !== "retake") return html`<p class="p-studio-film__state-line"><${St} icon="eye">${FILM_WORDS.notLooked}<//></p>`;
    const why = text(take.verdict.reason, 200).trim();
    return html`<div class="p-studio-film__verdict">
      <${Verdict} tone=${v === "keep" ? "good" : "warn"} title=${v === "keep" ? verdictWords(take.verdict) : "Retake"} by=${FILM_WORDS.byArt} />
      ${why ? html`<p class="p-studio-film__reason">${why}</p>` : null}
    </div>`;
  }
  if (state === "refused" || state === "failed") {
    return html`<div class="p-studio-film__verdict"><${Verdict} tone="bad" title=${takeStateWords(state, take.service)} /></div>`;
  }
  return html`<p class="p-studio-film__state-line"><${St} icon=${state === "making" ? "clock" : undefined}>${takeStateWords(state)}<//></p>`;
}

// The first block: the take, its verdict, and the storyboard beside the picture its service was sent.
function TakeBlock({ shot, take, n, takes, at, onTake, labels }) {
  const board = safeApi(shot.board);
  const sent = sentKind(take.sent);
  const state = take.state;
  const words = takeWords(take, labels);
  const detail = (state === "refused" || state === "failed" || state === "making") && take.result && take.result !== takeStateWords(state, take.service) ? text(take.result, 200) : "";
  const facts = [secondsWords(shot), takeCredits(take.credits)].filter(Boolean).join(" · ");
  const pair = [
    { src: board || "", alt: `Storyboard still for shot ${n}`, title: FILM_WORDS.storyboard, sub: labels.approved },
    sent === "none" ? null : {
      src: sent === "picture" ? safeApi(take.sent) : "", alt: `${words.sentPicture} for ${takeLabel(n, take).toLowerCase()}`,
      title: text(shot.render, 80) || words.sentPicture, sub: sent === "gone" ? GONE_WORDS : FILM_WORDS.asSent,
    },
  ];
  return html`<${Blk} title=${takeLabel(n, take)} aside=${facts}>
    ${takes.length > 1 ? html`<div class="p-studio-film__takes">
      <${Segmented} size="sm" label=${FILM_WORDS.takes} current=${at} onChange=${onTake}
        items=${takes.map((t, i) => ({ id: i, label: takeName(t.take) }))} />
    </div>` : null}
    <${TakeVerdict} take=${take} />
    ${detail ? html`<p class="p-studio-film__result">${detail}</p>` : null}
    <div class="p-studio-film__pair"><${Pair} items=${pair} /></div>
  <//>`;
}

// The second block: the prompt as sent to the take's service, with what changed from what the owner approved.
function PromptBlock({ take, labels }) {
  const p = promptView(take);
  return html`<${Blk} title=${takeWords(take, labels).sentPrompt}>
    ${p.kind === "diff"
      ? html`<div class="p-studio-film__diff"><${DiffText} a=${p.approved} b=${p.sent} labels=${{ a: FILM_WORDS.diffApproved, b: FILM_WORDS.diffSent }} /></div>`
      : p.kind === "same"
        ? html`<p class="p-studio-film__prompt">${p.sent}</p>`
        : html`<p class="p-studio-film__none">${p.kind === "gone" ? labels.sentPromptGone : labels.sentPromptNone}</p>
          ${p.approved ? html`<p class="p-studio-film__label">${labels.approved}</p><p class="p-studio-film__prompt">${p.approved}</p>` : null}`}
  <//>`;
}

// The third block: the shot's move, and the requests its service did not start.
function ShotBlock({ shot, n, labels }) {
  const move = text(shot.move, 400);
  if (!move && !notStartedOf(shot).length) return null;
  return html`<${Blk} title=${FILM_WORDS.move} aside=${`Shot ${n}`}>
    ${move ? html`<p class="p-studio-film__move">${move}</p>` : null}
    <${NotStarted} shot=${shot} labels=${labels} />
  <//>`;
}

// ---- the strip -----------------------------------------------------------------------------------------------

// What the film spent, in the home server's own sentence when it sends one (PLAN-3D-ALL S1: shown whole, as sent);
// else the server's two figures in the page's words, as before.
export function spendWords(total) {
  const t = total && typeof total === "object" ? total : {};
  return typeof t.words === "string" && t.words.trim() ? text(t.words, 300) : creditWords(t.spent, t.budget);
}

// What a row of the Films list spent, in the home server's own sentence (the row's `words`, U18 L4), as spendWords
// says a film's total; the page's words only when an older server sends none.
export function rowWords(row) {
  const r = row && typeof row === "object" ? row : {};
  return spendWords({ words: r.words, spent: r.spent, budget: r.budget });
}

function Spend({ film }) {
  const total = film.total || {};
  const words = spendWords(total);
  return html`<section class="p-studio-film__spend" aria-label=${FILM_WORDS.spent}>
    <p class="p-studio-film__spend-line">
      <span class="p-studio-film__spend-label">${FILM_WORDS.spent}</span>
      <span class="p-studio-film__spend-figure">${words}</span>
    </p>
    <div class="p-studio-film__spend-meter">
      <${Meter} plain shares=${{ spent: spentShare(total.spent, total.budget) }} label=${`${FILM_WORDS.spentOf}: ${words}`} />
    </div>
    ${anyMaking(film) ? html`<p class="p-studio-film__spend-note">${labelsOf(film).stillCharging}</p>` : null}
  </section>`;
}

function ShotCards({ shots, at, onPick }) {
  return html`<${Strip} label=${FILM_WORDS.shots}>
    ${shots.map((shot, i) => {
      const takes = items(shot.takes, MAX_TAKES);
      const take = i === at.shot && takes[at.take] ? takes[at.take] : takes[takes.length - 1];
      const src = (take && stillsOf(take)[0]) || safeApi(shot.board) || "";
      return html`<${TakeCard} key=${`${text(shot.id, 8)}-${i}`} pressed=${i === at.shot}
        thumb=${{ src, alt: "", making: !!take && take.state === "making" }}
        title=${`Shot ${i + 1}`} amount=${takes.length ? takeCredits(shot.credits) || "$0.00" : ""}
        sub=${[take ? takeName(take.take) : FILM_WORDS.noTakes, secondsWords(shot)].filter(Boolean).join(" · ")}
        state=${take ? takeChip(take) : null} onPick=${() => onPick({ shot: i, take: takes.length - 1 })} />`;
    })}
  <//>`;
}

// ---- under the first screen ----------------------------------------------------------------------------------

const SHOT_COLUMNS = [
  { key: "n", label: "Shot", align: "start" }, { key: "move", label: "Move" }, { key: "takes", label: "Takes" },
  { key: "state", label: "State" }, { key: "cost", label: "Cost", align: "end" },
];
const BATCH_COLUMNS = [
  { key: "approved", label: "Approved" }, { key: "ends", label: "Ends" }, { key: "budget", label: "Budget", align: "end" },
  { key: "spent", label: "Spent", align: "end" }, { key: "refused", label: "Refused", align: "end" }, { key: "state", label: "State", align: "start" },
];

function shotCell(row, col) {
  if (col.key !== "n") return undefined;
  return html`<span class="p-studio-film__row-shot">
    <span class="p-studio-film__row-thumb">${row.board ? html`<img src=${row.board} alt="" loading="lazy" decoding="async" />` : null}</span>
    <span>Shot ${row.n}</span>
  </span>`;
}

// ---- the film ------------------------------------------------------------------------------------------------

// `more`: what the page shows under the film's own rows (the rest of Studio, when the page gives it).
export function FilmView({ id, settled = true, more = null }) {
  const app = useApp() || {};
  const res = useResource(id ? `/api/studio/films/${encodeURIComponent(id)}` : null, { every: EVERY });
  const list = useResource(id ? "/api/studio/films" : null, { every: EVERY });
  const [pick, setPick] = useState(null);
  const f = res.data;
  const head = useBringIntoView(`film:${id}`, settled && (!!f || !!res.error));
  const task = (f && f.task) || {};
  const ident = text(task.identifier, 40);
  const pager = filmPager(list.data && list.data.films, id);
  const setTop = app.setTop;
  const taskLink = taskHref(ident);
  useEffect(() => {
    if (typeof setTop !== "function") return;
    setTop({ crumbs: filmCrumbs(ident), pager, links: taskLink ? [{ label: FILM_WORDS.task, href: taskLink }] : [] });
  }, [setTop, ident, taskLink, pager && pager.label, pager && pager.prev, pager && pager.next]);
  useEffect(() => () => { if (typeof setTop === "function") setTop(null); }, [setTop]);

  if (res.error && !f) {
    const gone = res.error && (res.error.status === 404 || res.error.code === "film_not_found");
    return html`<div class="p-studio-film p-studio-film--alone" ref=${head} tabindex="-1">
      ${gone
        ? html`<${Notice} tone="warn" title="That film is not here.">It may have been moved. <a href=${HERE}>Show all films</a><//>`
        : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
    </div>`;
  }
  if (!f) return html`<div class="p-studio-film p-studio-film--alone"><${Loading} lines=${4} label="Loading the film" /></div>`;

  const shots = items(f.shots, MAX_SHOTS);
  const at = pick && shots[pick.shot] ? pick : defaultPick(f);
  const shot = shots[at.shot] || null;
  const takes = shot ? items(shot.takes, MAX_TAKES) : [];
  const take = takes[at.take] || null;
  const n = at.shot + 1;
  const labels = labelsOf(f);
  const banners = filmBanners(f);
  const approved = items(f.batches, 20).map((b) => b.approvedAt).filter(Boolean).pop();
  const direction = f.treatment && f.treatment.direction && f.treatment.direction.title ? text(f.treatment.direction.title, 120) : "";
  const edit = editHref(f.edit);
  const title = text(task.title, 160) || FILM_WORDS.film;
  const listed = items(list.data && list.data.films, 30).find((x) => x.task && (x.task.id === task.id || x.task.identifier === ident));

  // The stage: the chosen take, or the shot's storyboard while nothing is made.
  const board = shot ? safeApi(shot.board) : null;
  const stills = take ? stillsOf(take) : [];
  const shown = stills.length ? stills : board ? [board] : [];
  const name = take ? takeLabel(n, take) : `Shot ${n}`;
  const tags = take ? [name, take.state === "made" ? "" : takeStateWords(take.state)] : [name, FILM_WORDS.noTakes];
  // A take with a clip or stills plays in the Player; with neither (not made yet, being made, refused) the stage shows
  // the shot's storyboard as a still picture, with no time line to scrub.
  const playable = !!clipOf(take) || stills.length > 0;
  const stage = shot
    ? html`<div class="p-studio-film__stage">
        ${playable
          ? html`<${Player} key=${`${at.shot}-${at.take}`} src=${clipOf(take) || undefined} poster=${shown[0]} stills=${shown}
              seconds=${Number(shot.seconds) || 0} label=${name} tags=${tags} />`
          : html`<${Shot} src=${board || ""} alt=${`Storyboard still for shot ${n}`} tags=${[tags.filter(Boolean).join(" · ")]}>
              <span class="p-studio-film__say">${take ? `${FILM_WORDS.storyboard}. ${takeStateWords(take.state)}.` : FILM_WORDS.noTakesSay}</span>
            <//>`}
      </div>`
    : html`<div class="p-studio-film__stage p-studio-film__stage--empty"><${Notice} tone="info">${FILM_WORDS.noShots}<//></div>`;

  const strip = shots.length
    ? html`<div class="p-studio-film__strip">
        <${Spend} film=${f} />
        <${ShotCards} shots=${shots} at=${at} onPick=${setPick} />
      </div>`
    : null;

  const kind = listed
    ? html`<span class="p-studio-film__kind"><${St} tone=${filmStateTone(listed.state) === "ok" ? "good" : filmStateTone(listed.state)}
        icon=${listed.state === "making" ? "clock" : undefined}>${filmStateWords(listed.state)}<//></span>
        <span>${clipsWords(listed.clips, listed.kept)}</span>`
    : null;
  const lede = direction || approved
    ? html`${direction ? html`<span>${direction}</span>` : null}${direction && approved ? " · " : null}${approved
        ? html`<span title=${fullWhen(approved)}>approved ${when(approved)}</span>` : null}`
    : null;

  const rail = html`
    ${banners.length ? html`<div class="p-studio-film__notes">${banners.map((b) => html`<${Notice} key=${b.key} tone=${b.tone}>${b.text}<//>`)}</div>` : null}
    ${shot && take
      ? html`<${TakeBlock} shot=${shot} take=${take} n=${n} takes=${takes} at=${at.take} labels=${labels}
          onTake=${(i) => setPick({ shot: at.shot, take: i })} />
        <${PromptBlock} take=${take} labels=${labels} />`
      : shot
        ? html`<${Blk} title=${`Shot ${n}`} aside=${secondsWords(shot)}>
            <p class="p-studio-film__say">${FILM_WORDS.noTakesSay}</p>
            ${board ? html`<div class="p-studio-film__pair"><${Pair} items=${[{ src: board, alt: `Storyboard still for shot ${n}`, title: FILM_WORDS.storyboard, sub: labels.approved }]} /></div>` : null}
          <//>`
        : null}
    ${shot ? html`<${ShotBlock} shot=${shot} n=${n} labels=${labels} />` : null}`;

  const below = html`<div class="p-studio-film__below">
    ${shots.length ? html`<section class="p-studio-film__group" aria-labelledby="p-studio-film-shots">
      <h2 class="p-studio-film__group-title" id="p-studio-film-shots">${FILM_WORDS.allShots}</h2>
      <${DataTable} columns=${SHOT_COLUMNS} rows=${shotRows(f)} renderCell=${shotCell} />
    </section>` : null}
    ${items(f.batches, 20).length ? html`<section class="p-studio-film__group" aria-labelledby="p-studio-film-batches">
      <h2 class="p-studio-film__group-title" id="p-studio-film-batches">${FILM_WORDS.approvals}</h2>
      <${DataTable} columns=${BATCH_COLUMNS} rows=${batchRows(f)} />
    </section>` : null}
    ${more}
  </div>`;

  return html`<div class="p-studio-film" ref=${head} tabindex="-1">
    <${StageLayout} kind=${kind} title=${title} lede=${lede} label=${name} stage=${stage} strip=${strip} rail=${rail}
      foot=${edit ? html`<${Button} href=${edit} icon="video">${FILM_WORDS.edit}<//>` : null} more=${below} />
  </div>`;
}
