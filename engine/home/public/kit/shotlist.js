// ShotlistCard (PLAN-V5 K14, T45): the moment the owner approves a film's shots and what they cost. A film comes
// as one to three treatments; each stands in a column when the card is wide enough and one at a time, with a
// numbered stepper, when it is not. A treatment shows its direction, its storyboard as a strip (each board opens
// larger), the home server's own brand check, the Art director's scores, its shots (board, move, prompt, model,
// credits), and at its foot the cost in words with one "Approve this one and its cost". That opens a confirm that
// says the most Runway may charge; nothing is sent to Runway before the owner presses its button. Under the
// treatments: the note, "Another round" and "Send all back" (a note needed). Nothing an agent wrote is ever set
// as HTML (a title, a move, a prompt, a reason and a brand line are text nodes); a board comes only from the
// `/api/view/<token>` address the server gave. The cost is the home server's own sum, shown as it sent it.
// Acts through POST /api/inbox/act with the item's version and, for an approval, `variant` (a, b or c).
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { when } from "../lib/format.js";
import { Button } from "./button.js";
import { actBody, isChangedSinceSeen, reloadInboxItem } from "./decision.js";
import { Icon } from "./icon.js";
import { Dialog } from "./overlays.js";
import { BrandRow, DecisionOrPick, Scores, Steps, letterOf, safeViewUrl, stepAt, versionsOf } from "./pick.js";
import { Tag } from "./tag.js";
import { Mono } from "./text.js";
import { cx, nextId } from "./util.js";

// ---- Words (rule 9: plain, short; the server's own sentences win where it sends them) ----

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
};

const ID = /^[abc]$/;
const GOAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const SHOTS_SHOWN = 4;
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

// The words of the confirm for one treatment, from the home server's own numbers: { title, body, button }, or null
// when the treatment has no cost (it cannot be approved, so there is nothing to confirm).
export function confirmWords(v) {
  const most = v && v.cost && v.cost.most;
  const shots = list(v && v.shotlist && v.shotlist.shots);
  if (!Number.isInteger(most) || most < 0 || !shots.length) return null;
  const name = cap(v.direction && v.direction.title, 80) || (v.id ? `Version ${letterOf(v.id)}` : "this treatment");
  return {
    title: `Approve ${name}?`,
    body: `Runway may charge up to ${creditsDollars(most)} for its ${clips(shots.length)} and one retake each. Nothing else is spent without you.`,
    button: `Approve and spend up to ${creditsDollars(most)}`,
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
  if (/\bSettings\b/.test(sentence)) return { href: "#/settings", label: SHOTLIST_WORDS.settings };
  if (/\bHealth\b/.test(sentence)) return { href: "#/health", label: SHOTLIST_WORDS.health };
  return null;
}

// The link under a refused approval: the codes that are about Settings (the limit, generation being off), and the
// ledger, which Health explains.
export function refusalLink(error) {
  const code = error && error.code;
  if (code === "over_limit" || code === "job_not_ready") return { href: "#/settings", label: SHOTLIST_WORDS.settings };
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
// credits, wordsAlone, best, board }], `board` the server's viewer address for that shot's storyboard or "".
export function shotRows(v) {
  const boards = new Map();
  for (const b of list(v && v.boards)) {
    const url = b && safeViewUrl(b.url);
    if (url && typeof b.shot === "string" && !boards.has(b.shot)) boards.set(b.shot, url);
  }
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
      board: boards.get(text(s.id)) || "",
    };
  });
}

// The boards of a treatment for its strip, in the order of its shots: [{ shot, url }].
export function boardRows(v) {
  const out = [];
  const seen = new Set();
  for (const b of list(v && v.boards)) {
    const url = b && safeViewUrl(b.url);
    if (url && typeof b.shot === "string" && !seen.has(b.shot)) { seen.add(b.shot); out.push({ shot: b.shot, url }); }
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

// ---- Parts ----

function Boards({ boards, label }) {
  const [open, setOpen] = useState(-1);
  if (!boards.length) return null;
  const n = boards.length;
  const at = open < 0 ? 0 : Math.min(open, n - 1);
  return html`<div class="k-sl__boards">
    <ul class="k-sl__strip" aria-label=${`${label}: ${SHOTLIST_WORDS.boards.toLowerCase()}`}>
      ${boards.map((b, i) => html`<li key=${b.shot} class="k-sl__strip-item">
        <button type="button" class="k-sl__board" onClick=${() => setOpen(i)} aria-label=${`${label}: open the board of ${b.shot} larger`}>
          <img src=${b.url} alt="" loading="lazy" decoding="async" />
          <span class="k-sl__board-id" aria-hidden="true">${b.shot}</span>
        </button>
      </li>`)}
    </ul>
    <${Dialog} open=${open >= 0} title=${`${label}: board ${boards[at].shot}, ${at + 1} of ${n}`} size="lg" onClose=${() => setOpen(-1)}
      footer=${n > 1 ? html`<div class="k-pick__dialog-nav">
        <${Button} variant="plain" icon="arrow-left" disabled=${at === 0} onClick=${() => setOpen(at - 1)}>Previous<//>
        <${Button} variant="plain" icon="arrow-right" disabled=${at === n - 1} onClick=${() => setOpen(at + 1)}>Next<//>
      </div>` : null}>
      <figure class="k-pick__large"><img src=${boards[at].url} alt=${`${label}, board ${boards[at].shot}`} decoding="async" /></figure>
    <//>
  </div>`;
}

function Shot({ s, baseId }) {
  const [open, setOpen] = useState(false);
  const folds = foldsPrompt(s.prompt);
  const pid = `${baseId}-${s.id}-prompt`;
  return html`<li class="k-sl__shot">
    <span class="k-sl__thumb" aria-hidden="true">${s.board ? html`<img src=${s.board} alt="" loading="lazy" decoding="async" />` : null}</span>
    <div class="k-sl__shot-body">
      <p class="k-sl__shot-top">
        <span class="k-sl__shot-id">${s.label}</span>
        ${s.credits !== null && html`<span class="k-sl__shot-credits">${creditsDollars(s.credits)}</span>`}
      </p>
      ${s.render && html`<p class="k-sl__shot-render">${s.render}</p>`}
      ${s.move && html`<p class="k-sl__shot-move">${s.move}</p>`}
      ${s.prompt && html`<p id=${pid} class=${cx("k-sl__shot-prompt", folds && !open && "k-sl__shot-prompt--folded")}>${s.prompt}</p>`}
      ${folds && html`<button type="button" class="k-pick__more" aria-expanded=${open ? "true" : "false"} aria-controls=${pid}
        onClick=${() => setOpen(!open)}>${open ? SHOTLIST_WORDS.readLess : SHOTLIST_WORDS.readAll}</button>`}
      <p class="k-sl__shot-meta">
        ${s.model && html`<${Mono}>${s.model}<//>`}
        ${s.wordsAlone && html`<${Tag}>${SHOTLIST_WORDS.wordsAlone}<//>`}
        ${s.best && html`<${Tag} tone="ok">${SHOTLIST_WORDS.bestModel}<//>`}
      </p>
    </div>
  </li>`;
}

function Shots({ v, baseId }) {
  const [all, setAll] = useState(false);
  const rows = shotRows(v);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOTS_SHOWN);
  const id = `${baseId}-shots`;
  return html`<div class="k-sl__table">
    <h4 class="k-sl__sub">${SHOTLIST_WORDS.shots}</h4>
    <ol id=${id} class="k-sl__shots" aria-label=${`${SHOTLIST_WORDS.shots}, ${rows.length}`}>
      ${shown.map((s) => html`<${Shot} key=${s.id} s=${s} baseId=${baseId} />`)}
    </ol>
    ${rows.length > SHOTS_SHOWN && html`<button type="button" class="k-pick__more" aria-expanded=${all ? "true" : "false"} aria-controls=${id}
      onClick=${() => setAll(!all)}>${all ? "Show fewer shots" : `Show all ${rows.length} shots`}</button>`}
  </div>`;
}

function Cost({ v, quiet }) {
  const c = v.cost;
  if (!c || typeof c !== "object") return quiet ? null : html`<p class="k-sl__cost-none">${SHOTLIST_WORDS.noCost}</p>`;
  const time = cap(c.time, 300);
  return html`<div class="k-sl__cost">
    <p class="k-sl__cost-words">${cap(c.words, 500)}</p>
    ${time && html`<p class="k-sl__cost-time"><${Icon} name="clock" size=${14} /><span>${time}</span></p>`}
  </div>`;
}

function Treatment({ v, level, baseId, shared, busy, stopped, onApprove }) {
  const id = `${baseId}-${v.id}`;
  const H = `h${Math.min(Math.max(level, 2), 6)}`;
  const head = html`<div class="k-pick__head">
    ${v.letter && html`<span class="k-pick__letter" aria-hidden="true">${v.letter}</span>`}
    <div class="k-pick__names">
      <${H} class="k-pick__name">${v.letter ? html`<span class="k-sr">Treatment ${v.letter}: </span>` : null}${v.title}<//>
      ${factsOf(v) && html`<p class="k-sl__facts">${factsOf(v)}</p>`}
    </div>
  </div>`;
  if (v.missing) {
    return html`<li class="k-pick__version k-sl__version k-pick__version--missing" id=${id}>
      ${head}
      <p class="k-pick__none k-pick__none--missing"><${Icon} name="alert" size=${14} /><span>${SHOTLIST_WORDS.missing}</span></p>
      <p class="k-pick__caption">${SHOTLIST_WORDS.missingNext}</p>
    </li>`;
  }
  const blocked = blockedOf(v);
  const mine = busy && busy.action === "approve" && busy.variant === v.id;
  const label = v.letter ? `Treatment ${v.letter}: ${v.title}` : v.title;
  return html`<li class="k-pick__version k-sl__version" id=${id}>
    ${head}
    ${v.shotlist && v.shotlist.title && html`<p class="k-sl__film">${cap(v.shotlist.title, 120)}</p>`}
    <${Boards} boards=${boardRows(v)} label=${label} />
    ${!boardRows(v).length && html`<p class="k-pick__none">${SHOTLIST_WORDS.noPlan}</p>`}
    <${BrandRow} brand=${v.brand} />
    <${Scores} review=${v.review} kind="film" />
    <${Shots} v=${v} baseId=${id} />
    <div class="k-sl__foot">
      <${Cost} v=${v} quiet=${Boolean(blocked)} />
      ${blocked
        ? html`<div class="k-sl__blocked" role="note">
            <${Icon} name="alert" size=${14} />
            <div>
              <p>${shared ? SHOTLIST_WORDS.shared : blocked.text}</p>
              ${!shared && blocked.link && html`<a class="k-pick__link" href=${blocked.link.href}>${blocked.link.label}</a>`}
            </div>
          </div>`
        : html`<${Button} variant="primary" class="k-pick__button" busy=${mine} disabled=${stopped || !v.approvable || !v.cost}
            aria-label=${approveLabel(v)} onClick=${(e) => onApprove(v, e)}>${SHOTLIST_WORDS.approve}<//>`}
    </div>
  </li>`;
}

function Confirm({ v, busy, onYes, onNo }) {
  const w = confirmWords(v);
  if (!w) return null;
  return html`<${Dialog} open=${true} title=${w.title} size="sm" onClose=${() => { if (!busy) onNo(); }}
    footer=${html`<${Button} variant="plain" data-autofocus="" disabled=${busy} onClick=${onNo}>${SHOTLIST_WORDS.notYet}<//>
      <${Button} variant="primary" busy=${busy} onClick=${onYes}>${w.button}<//>`}>
    <p class="k-sl__confirm">${w.body}</p>
  <//>`;
}

// What the card becomes after an action: the server's message, and for an approval where to follow the film.
export function ShotlistDone({ done, focus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (focus && ref.current && typeof ref.current.focus === "function") ref.current.focus(); }, []);
  if (!done) return null;
  const v = done.version || null;
  const shot = v ? boardRows(v)[0] : null;
  const approved = done.action === "approve";
  return html`<div class="k-pick k-pick--done" role="status" tabindex="-1" ref=${ref}>
    ${shot && html`<img class="k-pick__done-shot" src=${shot.url} alt="" loading="lazy" decoding="async" />`}
    <div class="k-pick__done-text">
      ${done.title && html`<p class="k-pick__done-title">${done.title}</p>`}
      ${v && approved && html`<p class="k-pick__done-choice"><${Icon} name="check" size=${14} /><span>${v.letter ? `You approved ${v.letter}: ${v.title}` : `You approved ${v.title}`}</span></p>`}
      <p class="k-pick__done-message">${approved && done.studio
        ? html`${SHOTLIST_WORDS.approved}<a class="k-pick__link" href=${done.studio}>${SHOTLIST_WORDS.studio}</a>.`
        : text(done.message)}</p>
    </div>
  </div>`;
}

// ShotlistCard({ item, onDone, level, focusDone }) for a Needs-you item of kind "shotlist".
export function ShotlistCard({ item = null, onDone, level = 4, focusDone = true }) {
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
  const [current, setCurrent] = useState(0);
  const noteRef = useRef(null);
  const track = useRef(null);
  const opener = useRef(null);
  const changed = isChangedSinceSeen(error);

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

  const shown = fresh && item && fresh.id === item.id ? fresh : item;
  if (!shown) return null;
  if (done) return html`<${ShotlistDone} done=${done} focus=${focusDone} />`;

  const versions = versionsOf(shown);
  const open = versions.filter((v) => !v.missing);
  const n = versions.length;
  const stopped = Boolean(busy) || reloading || gone;
  const round = Number.isInteger(shown.round) ? shown.round : null;
  const shared = sharedBlock(shown);
  const confirmV = confirmFor ? versions.find((v) => v.id === confirmFor && !v.missing) || null : null;
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
      const message = action === "approve" ? `${SHOTLIST_WORDS.approved}${SHOTLIST_WORDS.studio}.` : text(res && res.message) || "Done.";
      const version = variant ? versions.find((v) => v.id === variant) || null : null;
      const out = {
        kind: "shotlist", action, variant: variant || null, message, version, title: cap(shown.title, 200), id: shown.id,
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

  const onApprove = (v, ev) => {
    if (stopped) return;
    opener.current = ev && ev.currentTarget ? ev.currentTarget : null;
    setConfirmFor(v.id);
  };
  const cancelConfirm = () => {
    setConfirmFor(null);
    refocus();
  };

  // The narrow strip: the stepper follows the swipe, and a step scrolls its treatment into view.
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

  const context = [text(shown.raisedBy), when(shown.when)].filter(Boolean);
  const limits = limitLines(shown);
  const noteId = `${baseId}-note`;
  const link = refusalLink(error);

  return html`<article class=${cx("k-pick", "k-sl")} aria-label=${text(shown.title)} aria-busy=${busy ? "true" : undefined}>
    <header class="k-pick__top">
      <p class="k-pick__over"><${Icon} name="video" size=${14} /><span>${open.length > 1 ? `${open.length} treatments to choose from` : "One treatment"}${round ? ` · round ${round}` : ""}</span></p>
      <h3 class="k-pick__title">${text(shown.title)}</h3>
      ${context.length > 0 && html`<p class="k-pick__context">
        ${context.map((c, i) => html`${i > 0 && html`<span aria-hidden="true"> · </span>`}<span>${c}</span>`)}
      </p>`}
      ${shown.summary && html`<p class="k-pick__summary">${text(shown.summary)}</p>`}
      ${limits.length > 0 && html`<dl class="k-sl__limits">
        ${limits.map((d, i) => html`<div key=${i} class="k-sl__limit"><dt>${d.label}</dt><dd>${d.value}</dd></div>`)}
      </dl>`}
    </header>
    ${problem && html`<p class="k-pick__none k-pick__none--missing"><${Icon} name="alert" size=${14} /><span>${problem}</span></p>`}
    ${shared && html`<div class="k-pick__alert" role="note">
      <${Icon} name="alert" />
      <div>
        <p class="k-pick__alert-title">${shared.text}</p>
        ${shared.link && html`<p class="k-pick__alert-next"><a class="k-pick__link" href=${shared.link.href}>${shared.link.label}</a></p>`}
      </div>
    </div>`}
    ${changed && html`<div class="k-pick__alert" role="alert">
      <${Icon} name="alert" />
      <div>
        <p class="k-pick__alert-title">${text(error && error.message) || SHOTLIST_WORDS.changed}</p>
        <p class="k-pick__alert-next">${reloading ? "Reading them again…" : gone ? SHOTLIST_WORDS.gone : text(error && error.next) || SHOTLIST_WORDS.changedNext}</p>
      </div>
    </div>`}
    ${n > 0 && html`<div class="k-sl__stage">
      ${n > 1 && html`<div id=${`${baseId}-steps`} class="k-sl__steps-wrap"><${Steps} versions=${versions} current=${current} onStep=${onStep} baseId=${baseId} /></div>`}
      <ol class=${cx("k-sl__versions", n === 1 && "k-sl__versions--one")} style=${{ "--k-sl-n": String(Math.max(n, 1)) }}
        ref=${track} onScroll=${n > 1 ? onScroll : undefined} aria-label=${SHOTLIST_WORDS.treatments}>
        ${versions.map((v) => html`<${Treatment} key=${v.id} v=${v} level=${level} baseId=${baseId} shared=${Boolean(shared) && !v.missing}
          busy=${busy} stopped=${stopped} onApprove=${onApprove} />`)}
      </ol>
    </div>`}
    <div class="k-pick__foot"><div class="k-pick__foot-in">
      <div class=${cx("k-pick__note", needNote && "k-pick__note--needed")}>
        <label class="k-pick__note-label" for=${noteId}>${SHOTLIST_WORDS.noteLabel}</label>
        <textarea id=${noteId} ref=${noteRef} class="k-textarea k-pick__note-field" rows="2" maxLength=${4000}
          aria-describedby=${`${noteId}-hint`} aria-invalid=${needNote ? "true" : undefined} value=${note} disabled=${Boolean(busy)}
          placeholder="Optional" onInput=${(e) => { setNote(e.currentTarget.value); if (needNote && e.currentTarget.value.trim()) setNeedNote(false); }}></textarea>
        <p class="k-pick__hint" id=${`${noteId}-hint`}>${needNote ? html`<${Icon} name="alert" size=${14} /><span>${SHOTLIST_WORDS.needNote}</span>` : SHOTLIST_WORDS.noteHint}</p>
      </div>
      <div class="k-pick__rest">
        ${cardOffers(shown, "another") && html`<${Button} variant="plain" icon="loop" busy=${busy && busy.action === "another"} disabled=${stopped}
          onClick=${(e) => { opener.current = e.currentTarget; send("another"); }}>${SHOTLIST_WORDS.another}<//>`}
        ${cardOffers(shown, "send_back") && html`<${Button} variant="quiet" icon="reply" busy=${busy && busy.action === "send_back"} disabled=${stopped}
          onClick=${(e) => { opener.current = e.currentTarget; send("send_back"); }}>${SHOTLIST_WORDS.back}<//>`}
      </div>
    </div></div>
    ${error && !changed && html`<p class="k-pick__error" role="alert"><${Icon} name="alert" /><span>${text(error.message) || "That did not work."}${error.next ? ` ${text(error.next)}` : ""}
      ${link && html` <a class="k-pick__link" href=${link.href}>${link.label}</a>`}</span></p>`}
    ${confirmV && html`<${Confirm} v=${confirmV} busy=${Boolean(busy)} onYes=${() => send("approve", confirmV.id)} onNo=${cancelConfirm} />`}
  </article>`;
}

// The one approval card for any Needs-you item: the shotlist card for a film's shotlist, else what kit/pick.js
// gives (a card of versions, or DecisionCard). kit/index.js exports this as DecisionCard, so every list of items
// (the drawer too) shows the shotlist as one.
export function DecisionOrShotlist(props) {
  return isShotlistItem(props && props.item) ? html`<${ShotlistCard} ...${props} />` : html`<${DecisionOrPick} ...${props} />`;
}
