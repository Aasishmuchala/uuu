// A film in Studio (PLAN-V5 T45b, K14 step 5), at #/dashboards/studio?film=<task id>: the owner follows a film as it is
// made. The title, the direction, what was approved, the total against the approved budget, then one card per shot:
// the storyboard still, the picture Runway was sent, and each take with its clip, its six stills, what it cost, its
// state and the Art director's verdict. Money, takes and states come from the door's ledger through the home server
// (C12); a request Runway did not start is listed quietly under its shot, with what was sent (T49f N2). The Artist's
// own words (the move, the prompt, a verdict's reason) are shown as text and nowhere else. Only
// addresses under /api/ reach a picture or a video, each through `safeApi`; no link in agent text is followed.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { fullWhen, when } from "../lib/format.js";
import { Button, Dialog, ErrorNotice, Loading, Notice, Tag } from "../kit/index.js";
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

// "175 of 600 credits": what is spent against what the owner approved. A spend the ledger could not give is said so.
export function creditWords(spent, budget) {
  const b = credit(budget) ? Number(budget) : 0;
  return credit(spent) ? `${Number(spent)} of ${b} credits` : `Spent so far not known, of ${b} credits`;
}

// "175 of 600 credits ($1.75 of $6.00)".
export function totalWords(spent, budget) {
  if (!credit(spent)) return `${creditWords(spent, budget)} (${dollarsOf(credit(budget) ? budget : 0)})`;
  return `${creditWords(spent, budget)} (${dollarsOf(spent)} of ${dollarsOf(credit(budget) ? budget : 0)})`;
}

// A take's own cost: "25 credits".
export function takeCredits(n) {
  return credit(n) ? `${Number(n)} ${Number(n) === 1 ? "credit" : "credits"}` : "";
}

// The share of the approved budget spent, 0 to 100, for the bar.
export function spentShare(spent, budget) {
  const b = Number(budget);
  if (!credit(spent) || !(b > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(spent) / b) * 100)));
}

const TAKE_STATES = { making: "Being made", made: "Made", refused: "Refused by Runway", failed: "Failed" };
const TAKE_TONES = { making: "neutral", made: "ok", refused: "bad", failed: "bad" };
export const takeStateWords = (state) => TAKE_STATES[state] || "Not known";
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

// What the picture sent to Runway says: the kept picture, or that the door no longer holds it (it keeps them a day).
export const GONE_WORDS = "No longer kept: the door keeps sent pictures for a day";
export function sentKind(sent) {
  if (sent === "gone") return "gone";
  return safeApi(sent) ? "picture" : "none";
}

// Whether any take is still being made, so the total says Runway may still charge.
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
});
export function labelsOf(film) {
  const l = film && film.labels && typeof film.labels === "object" ? film.labels : {};
  const out = {};
  for (const k of Object.keys(LABEL_WORDS)) out[k] = typeof l[k] === "string" && l[k].trim() ? text(l[k], 300) : LABEL_WORDS[k];
  return out;
}

// What a take's sent prompt is: its text, "gone" (the door's job record expired) or "none" (no copy was kept).
export function sentPromptKind(value) {
  if (value === "gone") return "gone";
  return typeof value === "string" && value.trim() ? "text" : "none";
}

// A shot's requests Runway did not start (nothing made, nothing charged), checked: [{ key, when, sent, prompt }], where
// `sent` is the kept picture's /api/ address or "" and `prompt` the prompt sent, "gone" or "none" (sentPromptKind).
export function notStartedOf(shot) {
  return items(shot?.notStarted, MAX_NOT_STARTED).map((n, i) => ({
    key: `${text(n.batch, 40)}-${text(n.job, 64)}-${i}`,
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
        <span class="p-studio__fact">${creditWords(film.spent, film.budget)}</span>
        <span class="p-studio__fact">${clipsWords(film.clips, film.kept)}</span>
      </span>
      ${film.problem ? html`<span class="p-studio__film-problem">${text(film.problem, 300)}</span>` : null}
    </a>
  </li>`;
}

// ---- stills --------------------------------------------------------------------------------------------------

// Six small stills in a strip; each opens larger in a dialog, with Previous and Next, and the arrow keys.
function StillsStrip({ stills, label }) {
  const [open, setOpen] = useState(-1);
  const list = stills.map(safeApi).filter(Boolean).slice(0, 6);
  if (!list.length) return null;
  const go = (n) => setOpen((i) => (i < 0 ? i : (i + n + list.length) % list.length));
  const onKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  };
  return html`<div class="p-film__stills">
    <ul class="p-film__strip" aria-label=${`Six stills of ${label}`}>
      ${list.map((src, i) => html`<li key=${src} class="p-film__strip-item">
        <button type="button" class="p-film__still" aria-label=${`Open still ${i + 1} of ${list.length} of ${label} larger`} onClick=${() => setOpen(i)}>
          <img class="p-film__still-img" src=${src} alt="" loading="lazy" />
        </button>
      </li>`)}
    </ul>
    <${Dialog} open=${open >= 0} size="lg" title=${open >= 0 ? `${label}, still ${open + 1} of ${list.length}` : ""} onClose=${() => setOpen(-1)}
      footer=${html`<${Button} size="sm" onClick=${() => go(-1)}>Previous<//><${Button} size="sm" onClick=${() => go(1)}>Next<//>`}>
      <div class="p-film__large" onKeyDown=${onKey}>
        ${open >= 0 ? html`<img class="p-film__large-img" src=${list[open]} alt=${`${label}, still ${open + 1} of ${list.length}`} />` : null}
      </div>
    <//>
  </div>`;
}

// ---- takes ---------------------------------------------------------------------------------------------------

function Take({ take, shot, labels }) {
  const label = `${shot.id}, ${takeName(take.take).toLowerCase()}`;
  const clip = safeApi(take.clip);
  const stills = Array.isArray(take.stills) ? take.stills : [];
  const poster = safeApi(stills[0]);
  const sent = sentKind(take.sent);
  const state = take.state;
  const detail = (state === "refused" || state === "failed" || state === "making") && take.result && take.result !== takeStateWords(state) ? text(take.result, 200) : "";
  return html`<li class=${`p-film__take p-film__take--${TAKE_STATES[state] ? state : "unknown"}`}>
    <div class="p-film__take-head">
      <h5 class="p-film__take-name">${takeName(take.take)}</h5>
      <${Tag} tone=${takeStateTone(state)}>${takeStateWords(state)}<//>
      <span class="p-film__take-credits">${takeCredits(take.credits)}</span>
    </div>
    ${detail ? html`<p class="p-film__take-detail">${detail}</p>` : null}
    <div class="p-film__take-body">
    <div class="p-film__media">
    ${clip ? html`<video class="p-film__video" controls preload="none" playsinline src=${clip} poster=${poster || undefined} aria-label=${`Clip ${label}`}>
      This browser cannot play the clip.
    </video>` : null}
    ${stills.length ? html`<${StillsStrip} stills=${stills} label=${label} />` : null}
    </div>
    <div class="p-film__notes">
    ${sent === "picture" ? html`<figure class="p-film__sent">
      <img class="p-film__sent-img" src=${safeApi(take.sent)} alt=${`The picture sent to Runway for ${label}`} loading="lazy" />
      <figcaption class="p-film__sent-cap">Sent to Runway</figcaption>
    </figure>` : null}
    ${sent === "gone" ? html`<p class="p-film__sent-gone">${GONE_WORDS}</p>` : null}
    <${TakePrompts} take=${take} labels=${labels} id=${`${shot.id}-${take.batch}-${take.job}-${take.take}`} />
    ${state === "made" ? html`<p class=${`p-film__verdict p-film__verdict--${verdictTone(take.verdict)}`}>
      <span class="p-film__verdict-label">Art director</span>
      <span class="p-film__verdict-text">${verdictWords(take.verdict)}</span>
    </p>` : null}
    </div>
    </div>
  </li>`;
}

// ---- shots ---------------------------------------------------------------------------------------------------

function Prompt({ value, id, moreWords = "Show all" }) {
  const [open, setOpen] = useState(false);
  const full = text(value, 1000).trim();
  if (!full) return null;
  const short = clampWords(full);
  const more = short !== full;
  return html`<div class="p-film__prompt">
    <p class="p-film__prompt-text" id=${id}>${open || !more ? full : short}</p>
    ${more ? html`<button type="button" class="p-film__more" aria-expanded=${open ? "true" : "false"} aria-controls=${id} onClick=${() => setOpen(!open)}>${open ? "Show less" : moreWords}</button>` : null}
  </div>`;
}

// What the owner approved for a take and what was sent to Runway, each under the server's own words.
function TakePrompts({ take, labels, id }) {
  const key = String(id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  const approved = typeof take.approvedPrompt === "string" && take.approvedPrompt.trim() ? take.approvedPrompt : "";
  const kind = sentPromptKind(take.sentPrompt);
  if (!approved && take.sentPrompt === undefined) return null;
  return html`<div class="p-film__says">
    ${approved ? html`<section class="p-film__say" aria-labelledby=${`p-film-ap-${key}`}>
      <h6 class="p-film__say-label" id=${`p-film-ap-${key}`}>${labels.approved}</h6>
      <${Prompt} value=${approved} id=${`p-film-apt-${key}`} moreWords="Read all" />
    </section>` : null}
    <section class="p-film__say" aria-labelledby=${`p-film-sp-${key}`}>
      <h6 class="p-film__say-label" id=${`p-film-sp-${key}`}>${labels.sentPrompt}</h6>
      ${kind === "text" ? html`<${Prompt} value=${take.sentPrompt} id=${`p-film-spt-${key}`} moreWords="Read all" />`
        : html`<p class="p-film__say-none">${kind === "gone" ? labels.sentPromptGone : labels.sentPromptNone}</p>`}
    </section>
  </div>`;
}

// The requests Runway did not start, under a shot's takes: quiet text, each with what was sent.
function NotStarted({ shot, labels }) {
  const list = notStartedOf(shot);
  if (!list.length) return null;
  const id = text(shot.id, 8);
  return html`<ul class="p-film__not-started" aria-label=${`Requests for shot ${id} that Runway did not start`}>
    ${list.map((n, i) => html`<li key=${n.key} class="p-film__not-started-item">
      <p class="p-film__not-started-head">
        <span>${labels.notStarted}</span>
        ${n.when ? html`<span title=${fullWhen(n.when)}>${when(n.when)}</span>` : null}
        ${n.sent ? html`<a href=${n.sent}>The picture sent</a>` : null}
      </p>
      ${n.prompt === "gone" || n.prompt === "none"
        ? html`<p class="p-film__say-none">${n.prompt === "gone" ? labels.sentPromptGone : labels.sentPromptNone}</p>`
        : html`<${Prompt} value=${n.prompt} id=${`p-film-ns-${id}-${i}`} moreWords="Read all" />`}
    </li>`)}
  </ul>`;
}

function Shot({ shot, number, labels }) {
  const board = safeApi(shot.board);
  const takes = items(shot.takes, MAX_TAKES);
  const seconds = Number.isFinite(Number(shot.seconds)) && Number(shot.seconds) > 0 ? `${Number(shot.seconds)} s` : "";
  const id = text(shot.id, 8);
  return html`<li class="p-film__shot">
    <div class="p-film__shot-head">
      <h4 class="p-film__shot-title">
        <span class="p-film__shot-no">${number}</span>
        <span class="p-film__shot-render">${text(shot.render, 160) || "A shot"}</span>
      </h4>
      <span class="p-film__shot-facts">
        ${seconds ? html`<span>${seconds}</span>` : null}
        ${takes.length ? html`<span>${takeCredits(shot.credits) || "0 credits"}</span>` : null}
      </span>
    </div>
    <div class="p-film__shot-body">
      <div class="p-film__shot-plan">
        ${shot.move ? html`<p class="p-film__move">${text(shot.move, 400)}</p>` : null}
        <${Prompt} value=${shot.prompt} id=${`p-film-prompt-${id}`} />
        ${board
          ? html`<figure class="p-film__board"><img class="p-film__board-img" src=${board} alt=${`Storyboard still for shot ${number}`} loading="lazy" /><figcaption class="p-film__board-cap">Storyboard</figcaption></figure>`
          : null}
      </div>
      <div class="p-film__shot-takes">
        ${takes.length
          ? html`<ul class="p-film__takes">${takes.map((t) => html`<${Take} key=${`${t.batch}-${t.job}-${t.take}`} take=${t} shot=${shot} labels=${labels} />`)}</ul>`
          : html`<p class="p-film__no-takes">No clip has been made for this shot yet.</p>`}
        <${NotStarted} shot=${shot} labels=${labels} />
      </div>
    </div>
  </li>`;
}

// ---- the film ------------------------------------------------------------------------------------------------

export function FilmView({ id, settled = true }) {
  const res = useResource(id ? `/api/studio/films/${encodeURIComponent(id)}` : null, { every: EVERY });
  const f = res.data;
  const head = useBringIntoView(`film:${id}`, settled && (!!f || !!res.error));
  if (res.error && !f) {
    const gone = res.error && (res.error.status === 404 || res.error.code === "film_not_found");
    return html`<div class="p-film">
      ${gone
        ? html`<${Notice} tone="warn" title="That film is not here.">It may have been moved. <a href=${HERE}>Show all films</a><//>`
        : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
    </div>`;
  }
  if (!f) return html`<div class="p-film"><${Loading} lines=${4} label="Loading the film" /></div>`;
  const task = f.task || {};
  const shots = items(f.shots, MAX_SHOTS);
  const total = f.total || {};
  const share = spentShare(total.spent, total.budget);
  const banners = filmBanners(f);
  const labels = labelsOf(f);
  const approved = items(f.batches, 20).map((b) => b.approvedAt).filter(Boolean).pop();
  const direction = f.treatment && f.treatment.direction && f.treatment.direction.title ? text(f.treatment.direction.title, 120) : "";
  const edit = editHref(f.edit);
  const title = text(task.title, 160) || "A film";
  return html`<article class="p-film" aria-labelledby="p-film-title">
    <div class="p-film__head">
      <div class="p-film__titles">
        <h3 class="p-film__title" id="p-film-title" tabindex="-1" ref=${head}>${title}</h3>
        <p class="p-film__sub">
          ${direction ? html`<span>Direction: <strong>${direction}</strong></span>` : null}
          ${approved ? html`<span title=${fullWhen(approved)}>Approved ${when(approved)}</span>` : null}
          ${task.identifier ? html`<span>${text(task.identifier, 40)}</span>` : null}
        </p>
      </div>
      <a class="p-film__close" href=${HERE}>Close</a>
    </div>

    ${banners.map((b) => html`<${Notice} key=${b.key} tone=${b.tone}>${b.text}<//>`)}

    <div class="p-film__total">
      <div class="p-film__total-line">
        <span class="p-film__total-label">Spent</span>
        <span class="p-film__total-words">${totalWords(total.spent, total.budget)}</span>
      </div>
      <div class="p-film__bar" role="progressbar" aria-label="Credits spent of the approved budget" aria-valuemin="0" aria-valuemax=${credit(total.budget) ? Number(total.budget) : 0} aria-valuenow=${credit(total.spent) ? Number(total.spent) : 0} aria-valuetext=${creditWords(total.spent, total.budget)}>
        <span class="p-film__bar-fill" style=${`width:${share}%`}></span>
      </div>
      ${anyMaking(f) ? html`<p class="p-film__charging">${STILL_CHARGING}</p>` : null}
    </div>

    ${edit ? html`<p class="p-film__edit">The edit is made. <a href=${edit}>Open it in Videos</a></p>` : null}

    ${shots.length
      ? html`<ol class="p-film__shots" aria-label="Shots">${shots.map((s, i) => html`<${Shot} key=${s.id || i} shot=${s} number=${i + 1} labels=${labels} />`)}</ol>`
      : html`<p class="p-film__no-takes">The shots of this film could not be read.</p>`}

    <p class="p-film__links">${task.identifier ? html`<a href=${`#/tasks/${encodeURIComponent(text(task.identifier, 40))}`}>Open its task</a>` : null}</p>
  </article>`;
}
