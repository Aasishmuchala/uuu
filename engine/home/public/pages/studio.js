// The Studio dashboard (CONTRACTS-V3 30, 37.3, 37.4; CONTRACTS-V2 9.6, 17.8, 20.3; PLAN-COOK T67, S18), at
// #/dashboards/studio: the full pane on one left edge, the title with the agents at the top right, a row that jumps
// to each part, then sections of cards in the manner of a review tool's collection (the picture flush to the card's
// top, the facts under it, one state a card): films (a card opens the film, pages/studio-film.js), videos (the kit's
// player opened in place), carousels (opened large in the work panel), sprites and animations (the sprite player),
// pictures, CAD parts and other files, the room for footage, files that could not be used, and the switches that are
// off with the way to each in Settings. With ?film= the film is the whole pane and the rest of Studio follows under
// it. A link that opens a sprite or a video brings it to the top of the pane and moves focus to its heading (M51
// F14). Everything shown is text or a picture from a file an agent made: it is capped, shown as text, and no link in
// it is followed. Only addresses under /api/ reach an img or a video.
// PLAN-3D-ALL U13: the title, its line, the agents and the row that jumps to each part stand in the room header
// (kit/room.js) with the light table's glimpse behind them; on a phone the band is a title strip with no picture.
// The owner's pictures, takes and sprites sit on the deepest ground with nothing over them; nothing is on paper
// (the page holds no decision, document or confirm). A film opened is its own stage (studio-film.js): no band.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, count, when } from "../lib/format.js";
import { currentMotion } from "../lib/theme.js";
import { AgentHead, Jobs, OpenDepartment } from "./dashboard.js";
import { FilmView, clipsWords, filmStateTone, filmStateWords, rowWords, spentShare, stillsOf } from "./studio-film.js";
import {
  BeingBuilt, Card, DataTable, Empty, ErrorNotice, FileCard, Icon, Loading, Meter, Notice, NotConnected, PicTag, Player,
  RoomHeader, Row, Rows, Section, St, glimpseFor, timeWords,
} from "../kit/index.js";

const HERE = "#/dashboards/studio";
const EVERY = 10000;
const SLOW = 30000;
const THUMB = 64;
const TILE = 120;
const MAX_ITEMS = 200;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const text = (v, max = 200) => (v === null || v === undefined ? "" : String(v).slice(0, max));
const list = (v, max = MAX_ITEMS) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max) : []);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// The address of this page with one thing open: studioHref({ video: "STH-25/title" }) or studioHref({ film: "<task id>" }). Nothing open: the page.
export function studioHref(open = {}) {
  for (const key of ["sprite", "video", "slides", "film"]) {
    const v = open && open[key];
    if (typeof v === "string" && v) return `${HERE}?${key}=${encodeURIComponent(v.slice(0, 200))}`;
  }
  return HERE;
}

// Only the home server's own addresses reach an img, a video or a download link; anything else is dropped.
export function safeApi(url) {
  const u = typeof url === "string" ? url : "";
  if (u.length > 2048 || !u.startsWith("/api/") || u.includes("//") || /[\\\s"'<>()]/.test(u)) return null;
  return u;
}

// The style that shows only the first frame of a sprite sheet inside a square box of `box` pixels. The sheet is a
// strip of `frames` frames side by side. The frame is scaled by a whole number when it can be, else shrunk to fit.
export function thumbStyle(sprite, box = THUMB) {
  const w = num(sprite?.frameSize?.w, 1);
  const h = num(sprite?.frameSize?.h, 1);
  const frames = Math.max(1, Math.floor(num(sprite?.frames, 1)));
  const side = num(box, THUMB);
  const raw = side / Math.max(w, h);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  const url = sprite?.sheet?.viewUrl ? `url("${String(sprite.sheet.viewUrl).replace(/["\\()\s]/g, "")}")` : "none";
  return [
    `width:${Math.round(w * scale)}px`, `height:${Math.round(h * scale)}px`,
    `background-image:${url}`, "background-repeat:no-repeat", "background-position:0 0",
    `background-size:${Math.round(w * frames * scale)}px ${Math.round(h * scale)}px`, "image-rendering:pixelated",
  ].join(";");
}

// The line under a sprite: a tick when the frames match their tags, else a warning in plain words.
export function checkLine(checks) {
  return checks?.ok
    ? { ok: true, text: "Frames match the tags" }
    : { ok: false, text: "The frames and the tags do not match" };
}

// A video's size and length in words: "1920 by 1080, 8 seconds, 30 frames a second, 1.2 MB". A number the
// manifest gives is shown only when it is whole and inside the video helper's limits (37.2).
export function videoWords(video) {
  const v = video || {};
  const parts = [];
  if (whole(v.width, 2, 1920) && whole(v.height, 2, 1920)) parts.push(`${v.width} by ${v.height}`);
  const s = Number(v.seconds);
  // The manifest's length has one decimal (M63): "11.5 s", a whole number as "12 s".
  if (Number.isFinite(s) && s > 0 && s <= 120) parts.push(s < 1 ? "under a second" : `${String(Math.round(s * 10) / 10)} s`);
  if (whole(v.fps, 1, 30)) parts.push(`${v.fps} frames a second`);
  const size = Number(v.video?.size);
  if (Number.isFinite(size) && size > 0) parts.push(bytes(size));
  return parts.join(", ");
}

// The server's checks of a video, read from its bytes, as plain lines.
export function videoChecks(checks) {
  const c = checks || {};
  return [
    c.isMp4 ? { ok: true, text: "It is a video file" } : { ok: false, text: "It is not a video file" },
    c.underLimit ? { ok: true, text: "Small enough to play here" } : { ok: false, text: "Too large to play here" },
    c.posterMatches ? { ok: true, text: "The cover picture matches its size" } : { ok: false, text: "The cover picture does not match its size" },
  ];
}

// The server's checks of a slide set, read from the pictures themselves, as plain lines.
export function slideChecks(checks) {
  const c = checks || {};
  return [
    c.sizesMatch ? { ok: true, text: "Every slide is the same size" } : { ok: false, text: "The slides are not all the same size" },
    c.countMatches ? { ok: true, text: "Every slide is there" } : { ok: false, text: "Some slides are missing" },
  ];
}

// A video plays here only when the server found a real video file under the limit, at one of its own addresses.
export const playable = (video) => Boolean(video?.checks?.isMp4 && video?.checks?.underLimit && safeApi(video?.video?.viewUrl));

const HEALTH = "Health shows what to do next.";

// The not-connected lines of the motion work: the server's own, else the pinned sentences (31.4).
export function motionNotices(slides, videos) {
  const out = [];
  const nc = (x) => (x && x.notConnected && typeof x.notConnected === "object" ? { reason: text(x.notConnected.reason, 300), next: text(x.notConnected.next, 300) } : null);
  const s = nc(slides);
  if (s) out.push(s);
  else if (slides && slides.installed === false) out.push({ reason: "The Artist's slide tool is not installed yet.", next: HEALTH });
  const v = nc(videos);
  if (v) out.push(v);
  else if (videos && videos.installed === false) out.push({ reason: "The Artist's video tool is not installed yet.", next: HEALTH });
  if (videos && videos.speech === false) out.push({ reason: "The speech model is not in place yet.", next: "Until it is, pauses cannot be cut and captions cannot be made. " + HEALTH });
  return out;
}

// The stat tiles: what the Studio holds, then the department's own figures.
export function studioFigures({ art, dept, slides, videos } = {}) {
  const out = [];
  if (videos && Array.isArray(videos.videos)) out.push({ id: "videos", label: "Videos", value: String(videos.videos.length), hint: "Title cards, reveals and cut clips" });
  if (slides && Array.isArray(slides.sets)) out.push({ id: "carousels", label: "Carousels", value: String(slides.sets.length), hint: "Slide sets for Marketing" });
  if (art && Array.isArray(art.sprites)) out.push({ id: "sprites", label: "Sprites", value: String(art.sprites.length), hint: "Animations you can play" });
  for (const f of list(dept?.figures, 6)) out.push({ id: text(f.id, 40), label: text(f.label, 60), value: text(f.value, 40), hint: text(f.hint, 120) });
  return out;
}

// Every file that could not be used, from the three lists, as { key, name, problem }.
export function problemsOf(...answers) {
  const out = [];
  for (const a of answers) {
    for (const p of list(a?.problems, 50)) {
      const name = [text(p.goal, 40), text(p.name, 120)].filter(Boolean).join(" / ");
      out.push({ key: `${out.length}`, name, problem: text(p.problem || p.reason, 300) });
    }
  }
  return out.slice(0, 100);
}

// The room's files as rows, newest names kept as text; only the pinned endings are shown.
const ROOM_ENDINGS = /\.(mp4|mov|m4v|mp3|m4a|wav|png|jpe?g)$/i;
export function roomRows(room) {
  return list(room?.files)
    .filter((f) => typeof f.name === "string" && ROOM_ENDINGS.test(f.name))
    .map((f) => ({ name: text(f.name, 200), size: bytes(f.size), changed: when(f.changed) || text(f.changed, 40) }));
}

// Whether a scroll may glide: not with motion switched off in Settings, nor with the system's reduced motion.
export function scrollBehaviour() {
  if (currentMotion() === "off") return "auto";
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? "auto" : "smooth";
}

// Brings an opened viewer to the top of the pane and puts focus on its heading, once per thing opened, after the
// page's lists have come in (`settled`), so nothing that loads above it pushes it down again.
export function useBringIntoView(key, settled) {
  const head = useRef(null);
  const done = useRef("");
  useEffect(() => {
    const el = head.current;
    if (!key || !el || !settled || done.current === key) return;
    done.current = key;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: scrollBehaviour() });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  }, [key, settled]);
  return head;
}

// The video's box: as wide as the pane, but never more than twice the video's own size nor 60% of the window
// (M51 F14), keeping its shape.
export function videoBox(video) {
  const v = video || {};
  if (!whole(v.width, 2, 1920) || !whole(v.height, 2, 1920)) return "";
  return `aspect-ratio:${v.width} / ${v.height};max-width:min(100%, ${v.width * 2}px);max-height:min(60vh, ${v.height * 2}px)`;
}

const tagNames = (sprite) => (sprite?.tags || []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean).slice(0, 12);

// ---- Films ----------------------------------------------------------------------------------------------------

// "2 of 3 clips, 2 kept": the shots that have a clip made, of the film's shots, and the shots kept. When the number
// of shots is not known, the Films list's own words ("3 clips made, 2 kept").
export function filmClips(clips, shots, kept) {
  if (!(Number.isInteger(shots) && shots > 0)) return clipsWords(clips, kept);
  const c = Number.isInteger(clips) && clips >= 0 ? Math.min(clips, shots) : 0;
  const k = Number.isInteger(kept) && kept >= 0 ? kept : 0;
  return `${c} of ${shots} ${shots === 1 ? "clip" : "clips"}, ${k} kept`;
}

// The film's first still: the first shot's newest take that has stills, else its storyboard; "" when there is none.
// Only the home server's own addresses (stillsOf and safeApi check them).
export function filmStill(detail) {
  const first = list(detail?.shots, 12)[0];
  if (!first) return "";
  const takes = list(first.takes, 6);
  for (let i = takes.length - 1; i >= 0; i -= 1) {
    const s = stillsOf(takes[i]);
    if (s.length) return s[0];
  }
  return safeApi(first.board) || "";
}

// What a film's card shows, from the Films list's row and, once it has come in, the film itself (its shots and its
// first still). Figures are the server's numbers, written by the film page's helpers.
export function filmCard(film, detail) {
  const f = film && typeof film === "object" ? film : {};
  const t = f.task && typeof f.task === "object" ? f.task : {};
  const shots = detail ? list(detail.shots, 12) : null;
  const made = shots ? shots.filter((s) => list(s.takes, 6).some((k) => k.state === "made")).length : f.clips;
  const tone = filmStateTone(f.state);
  return {
    id: text(t.id, 80),
    href: text(t.id, 80) ? studioHref({ film: text(t.id, 80) }) : HERE,
    title: text(t.title, 160) || "A film",
    ident: text(t.identifier, 40),
    still: detail ? filmStill(detail) : "",
    clips: filmClips(made, shots ? shots.length : null, f.kept),
    money: rowWords(f),
    share: spentShare(f.spent, f.budget),
    state: { tone: tone === "ok" ? "good" : tone, icon: f.state === "making" ? "clock" : undefined, text: filmStateWords(f.state) },
    problem: text(f.problem, 300),
  };
}

function FilmCard({ film, chosen }) {
  const id = text(film?.task?.id, 80);
  const res = useResource(id ? `/api/studio/films/${encodeURIComponent(id)}` : null, { every: SLOW });
  const c = filmCard(film, res.data);
  return html`<li class="p-studio__item">
    <${Card} href=${c.href} padding="none" class="p-studio__card" aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__thumb p-studio__thumb--wide">
        ${c.still ? html`<img class="p-studio__cover" src=${c.still} alt="" decoding="async" />`
          : html`<span class="p-studio__no-picture"><${Icon} name="film" size=${20} /></span>`}
        ${c.ident ? html`<${PicTag} at="tl">${c.ident}<//>` : null}
      </span>
      <span class="p-studio__body">
        <span class="p-studio__name">${c.title}</span>
        <span class="p-studio__meta">${c.clips}</span>
        <span class="p-studio__line"><${St} tone=${c.state.tone} icon=${c.state.icon}>${c.state.text}<//></span>
        ${c.problem ? html`<span class="p-studio__problem">${c.problem}</span>` : null}
        <span class="p-studio__spend">
          <span class="p-studio__money">${c.money}</span>
          <${Meter} plain shares=${{ spent: c.share }} label=${c.money} />
        </span>
      </span>
    <//>
  </li>`;
}

// ---- Sprites ------------------------------------------------------------------------------------------------

function CheckLines({ lines }) {
  return html`<ul class="p-studio__checks">
    ${lines.map((l) => html`<li key=${l.text} class="p-studio__check">
      <${St} tone=${l.ok ? "good" : "warn"}>${l.text}<//>
    </li>`)}
  </ul>`;
}

function SpriteCard({ sprite, chosen, onChoose }) {
  const line = checkLine(sprite.checks);
  const names = tagNames(sprite);
  const frames = num(sprite.frames, 0);
  return html`<li class="p-studio__item">
    <${Card} onClick=${() => onChoose(sprite.id)} padding="none" class="p-studio__card" aria-pressed=${chosen ? "true" : "false"}>
      <span class="p-studio__thumb p-sprite-player p-sprite-player--tile" aria-hidden="true">
        <span class="p-studio__sprite-frame" style=${thumbStyle(sprite, TILE)}></span>
        ${frames ? html`<${PicTag} at="br">${count(frames, "frame")}<//>` : null}
      </span>
      <span class="p-studio__body">
        <span class="p-studio__name">${text(sprite.title || sprite.name, 120)}</span>
        <span class="p-studio__meta">${names.length ? names.map((n) => text(n, 60)).join(", ") : count(frames, "frame")}</span>
        <span class="p-studio__state"><${St} tone=${line.ok ? "good" : "warn"}>${line.text}<//></span>
      </span>
    <//>
  </li>`;
}

// The sprite opened in place: its title, Close, and the sprite player (loaded only when a sprite is opened).
function SpriteViewer({ id, query, settled }) {
  const res = useResource(id ? `/api/studio/art/sprite?id=${encodeURIComponent(id)}` : null);
  const [mod, setMod] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    import("../studio/sprite-player.js").then((m) => { if (alive) setMod(m); }, () => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);
  const d = res.data;
  const head = useBringIntoView(id, settled && !!d);
  return html`
    <div class="p-studio__open p-studio__player">
      <div class="p-studio__viewer-head">
        <h3 class="p-studio__viewer-title" tabindex="-1" ref=${head}>${text(d?.sprite?.title, 120) || "Animation"}</h3>
        <a class="p-studio__close" href=${HERE}><${Icon} name="cross" size=${14} />Close</a>
      </div>
      ${res.loading && !d ? html`<${Loading} lines=${4} label="Loading the animation" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${missing || (!mod && !res.loading) ? html`<${BeingBuilt} title="Animation player" />` : null}
      ${d && mod?.SpritePlayer ? html`
        <${mod.SpritePlayer}
          sheetUrl=${d.sprite?.sheet?.viewUrl} frames=${d.frames} tags=${d.tags} palette=${d.sprite?.palette}
          title=${d.sprite?.title} gif=${d.sprite?.gif}
          initialTag=${query?.get("tag") || ""} initialFrame=${query?.get("frame") || ""} />` : null}
    </div>`;
}

// ---- Videos -------------------------------------------------------------------------------------------------

function VideoCard({ video, chosen }) {
  const poster = safeApi(video.poster?.viewUrl);
  const title = text(video.title || video.name, 120) || "A video";
  const ok = Boolean(video.checks?.ok);
  const s = Number(video.seconds);
  return html`<li class="p-studio__item">
    <${Card} href=${studioHref({ video: video.id })} padding="none" class="p-studio__card" aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__thumb p-studio__thumb--wide">
        ${poster ? html`<img class="p-studio__cover" src=${poster} alt="" decoding="async" />`
          : html`<span class="p-studio__no-picture">No cover picture</span>`}
        <span class="p-studio__play" aria-hidden="true"><${Icon} name="play" size=${14} /></span>
        ${Number.isFinite(s) && s > 0 && s <= 120 ? html`<${PicTag} at="br">${timeWords(Math.max(1, Math.round(s)))}<//>` : null}
      </span>
      <span class="p-studio__body">
        <span class="p-studio__name">${title}</span>
        <span class="p-studio__meta">${videoWords(video) || "Size not known"}</span>
        <span class="p-studio__state"><${St} tone=${ok ? "good" : "warn"}>${ok ? "Checked from the file" : "Something is wrong with this file"}<//></span>
      </span>
    <//>
  </li>`;
}

// The video opened in place: the kit's player on the deepest ground (its stills under it as the scrubber), and
// beside it the size and length, the server's checks and the links.
function VideoViewer({ video, settled }) {
  const title = text(video.title || video.name, 120) || "A video";
  const src = playable(video) ? safeApi(video.video.viewUrl) : null;
  const poster = safeApi(video.poster?.viewUrl);
  const download = safeApi(video.video?.url);
  const stills = list(video.stills, 6).map((f) => safeApi(f.viewUrl)).filter(Boolean);
  const head = useBringIntoView(video.id, settled);
  return html`<div class="p-studio__open p-studio__viewer">
    <div class="p-studio__viewer-head">
      <h3 class="p-studio__viewer-title" tabindex="-1" ref=${head}>${title}</h3>
      <a class="p-studio__close" href=${HERE}><${Icon} name="cross" size=${14} />Close</a>
    </div>
    <div class="p-studio__viewer-body">
      <div class="p-studio__viewer-stage">
        <${Player} src=${src || undefined} poster=${poster || undefined} stills=${stills.length ? stills : poster ? [poster] : []}
          seconds=${Number(video.seconds) || 0} label=${title} />
      </div>
      <div class="p-studio__viewer-side">
        ${src ? null : html`<${Notice} tone="warn" title="This video cannot play here.">The file is not a video, or it is too large. Its checks are below.<//>`}
        <p class="p-studio__facts">${videoWords(video)}</p>
        <${CheckLines} lines=${videoChecks(video.checks)} />
        <p class="p-studio__links">
          ${download ? html`<a href=${download} download><${Icon} name="download" size=${14} />Download the video</a>` : null}
          ${video.goal ? html`<a href=${`#/tasks/${encodeURIComponent(text(video.goal, 40))}`}><${Icon} name="arrow-up-right" size=${14} />Open its task</a>` : null}
        </p>
      </div>
    </div>
  </div>`;
}

// ---- Carousels ----------------------------------------------------------------------------------------------

function SetCard({ set, chosen }) {
  const contact = safeApi(set.contact?.viewUrl);
  const ok = Boolean(set.checks?.ok);
  const n = num(set.count, list(set.slides).length);
  const size = set.size && whole(set.size.w, 1, 4096) && whole(set.size.h, 1, 4096) ? `${set.size.w} by ${set.size.h}` : "";
  return html`<li class="p-studio__item">
    <${Card} href=${studioHref({ slides: set.id })} padding="none" class="p-studio__card" aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__thumb">
        ${contact ? html`<img class="p-studio__contact" src=${contact} alt="" decoding="async" />`
          : html`<span class="p-studio__no-picture">No contact picture</span>`}
        ${n ? html`<${PicTag} at="br">${count(n, "slide")}<//>` : null}
      </span>
      <span class="p-studio__body">
        <span class="p-studio__name">${text(set.title || set.name, 120) || "A carousel"}</span>
        <span class="p-studio__meta">${[count(n, "slide"), size].filter(Boolean).join(", ")}</span>
        <span class="p-studio__state"><${St} tone=${ok ? "good" : "warn"}>${ok ? "Checked from the pictures" : "Something is wrong with these slides"}<//></span>
      </span>
    <//>
  </li>`;
}

// The slides large, in the work panel.
function SlidesPanel({ set }) {
  const slides = list(set.slides, 10);
  const texts = Array.isArray(set.texts) ? set.texts : [];
  const title = text(set.title || set.name, 120) || "A carousel";
  return html`<div class="p-studio" data-dept="studio">
    <div class="p-studio__panel">
      <${CheckLines} lines=${slideChecks(set.checks)} />
      <ol class="p-studio__slides">
        ${slides.map((f, i) => {
          const src = safeApi(f.viewUrl);
          const words = text(texts[i], 600);
          return html`<li key=${i} class="p-studio__slide">
            ${src ? html`<img class="p-studio__slide-img" src=${src} alt=${`${title}, slide ${i + 1}${words ? `: ${text(words, 200)}` : ""}`} loading="lazy" />` : null}
            <p class="p-studio__slide-no">Slide ${i + 1} of ${slides.length}</p>
            ${words ? html`<p class="p-studio__slide-words">${words}</p>` : null}
          </li>`;
        })}
      </ol>
      ${set.goal ? html`<p class="p-studio__links"><a href=${`#/tasks/${encodeURIComponent(text(set.goal, 40))}`}>Open its task</a></p>` : null}
    </div>
  </div>`;
}

// ---- Pictures -----------------------------------------------------------------------------------------------

function PictureCard({ image }) {
  const src = safeApi(image.file?.viewUrl);
  const title = text(image.title || image.name, 120);
  return html`<li class="p-studio__item">
    <${Card} padding="none" class="p-studio__card">
      <span class="p-studio__thumb p-studio__thumb--picture">
        ${src ? html`<img class="p-studio__picture" src=${src} alt=${title} decoding="async" />`
          : html`<span class="p-studio__no-picture"><${Icon} name="image" size=${20} /></span>`}
      </span>
      <span class="p-studio__body">
        <span class="p-studio__name">${title}</span>
        <${FileCard} file=${image.file} />
      </span>
    <//>
  </li>`;
}

// ---- Tables, the room ---------------------------------------------------------------------------------------

const pick = (sections, id) => (sections || []).find((s) => s.id === id);

function FilesTable({ section }) {
  if (!section) return null;
  const columns = (section.columns || []).filter((c) => c.key !== "file");
  return html`
    <${Section} title=${section.title} count=${section.rows?.length}>
      <${DataTable} columns=${[...columns, { key: "file", label: "File" }]} rows=${section.rows || []} emptyText=${section.emptyText}
        renderCell=${(row, col) => {
          if (col.key === "file") return safeApi(row.fileUrl) ? html`<a href=${safeApi(row.fileUrl)} download>Download</a>` : "";
          // The task a file belongs to, by its title (the ref only when the board did not name it), as a link (M51 F8).
          if (col.key === "goal") {
            const ref = text(row.goal, 40);
            const name = text(row.task, 160) || ref;
            return /^[A-Za-z0-9-]{1,40}$/.test(ref) ? html`<a href=${`#/tasks/${encodeURIComponent(ref)}`}>${name}</a>` : name;
          }
          return undefined;
        }} />
    <//>`;
}

function Room({ res }) {
  const r = res.data;
  const rows = roomRows(r);
  const limit = Number(r?.limits?.clipBytes);
  return html`<${Section} title="The room" count=${r ? rows.length : undefined}>
    <p class="p-studio__lead">The room is a folder on this Mac for footage and sound that are too large to send through the browser. Put files there yourself; the Artist can use them in a video.${Number.isFinite(limit) && limit > 0 ? ` A clip may be up to ${bytes(limit)}.` : ""}</p>
    ${res.loading && !r ? html`<${Loading} lines=${2} label="Loading the room" />` : null}
    ${res.error && !r ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
    ${r ? (rows.length
      ? html`<${DataTable} columns=${[{ key: "name", label: "File" }, { key: "size", label: "Size" }, { key: "changed", label: "Changed" }]} rows=${rows} />`
      : html`<${Empty} icon="folder" title="The room is empty." text="Footage and sound you put in the folder show here." />`) : null}
    ${r && typeof r.path === "string" && r.path ? html`
      <details class="p-studio__where">
        <summary class="p-studio__where-line">Where is this folder?</summary>
        <p class="p-studio__where-text">Open this folder in Finder: <code class="p-studio__path">${text(r.path, 400)}</code></p>
      </details>` : null}
  <//>`;
}

// ---- The switches that are off --------------------------------------------------------------------------------

// The doors Studio's work rests on, each with its own section of Settings.
export const OFF_WORDS = Object.freeze({
  off: "Off",
  link: "Open in Settings",
  generation: { title: "Generation", icon: "film", say: "Runway cannot make the clips of a film until it is on." },
  viewer: { title: "Page viewer", icon: "eye", say: "Pages an agent builds are not looked at in a browser." },
  web: { title: "Web", icon: "globe", say: "The Researcher cannot open websites." },
});

// The switches that are off, one line each: Generation, the Page viewer and Web when their answer says off (each
// with its address in Settings), then the department's own (with its sentence, and no address).
export function offSwitches({ generation, viewer, web, dept } = {}) {
  const out = [];
  for (const [id, answer] of [["generation", generation], ["viewer", viewer], ["web", web]]) {
    if (answer && typeof answer === "object" && answer.on === false) {
      const w = OFF_WORDS[id];
      out.push({ id, icon: w.icon, title: w.title, say: w.say, href: `#/settings?s=${id}` });
    }
  }
  for (const s of list(dept?.switches, 20)) {
    if (s.on === true) continue;
    out.push({ id: `dept-${text(s.id, 40)}`, icon: "layers", title: text(s.label, 120), say: text(s.explain, 300), href: null });
  }
  return out;
}

// ---- The row that jumps to each part ---------------------------------------------------------------------------

const JUMP_ICONS = { films: "film", videos: "video", carousels: "layers", sprites: "brush", pictures: "image", cad: "grid", files: "file" };

// The parts the row jumps to, in the page's order: [{ id, label, value, hint }] for each part whose list has come in.
export function jumpsOf({ films, figures, images } = {}) {
  const out = [];
  if (Array.isArray(films)) out.push({ id: "films", label: "Films", value: String(films.length), hint: "" });
  const f = Array.isArray(figures) ? figures : [];
  const by = (id) => f.find((x) => x.id === id);
  for (const id of ["videos", "carousels", "sprites"]) if (by(id)) out.push(by(id));
  if (Array.isArray(images)) out.push({ id: "pictures", label: "Pictures", value: String(images.length), hint: "" });
  for (const id of ["cad", "files"]) if (by(id)) out.push(by(id));
  return out;
}

const partId = (id) => `p-studio-${id}`;

function Jumps({ items }) {
  if (!items.length) return null;
  const go = (id) => {
    const el = typeof document !== "undefined" ? document.getElementById(partId(id)) : null;
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: scrollBehaviour() });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  };
  return html`<nav class="p-studio__jumps" aria-label="Parts of Studio">
    ${items.map((j) => html`<button key=${j.id} type="button" class="p-studio__jump" title=${j.hint || undefined} onClick=${() => go(j.id)}>
      <${Icon} name=${JUMP_ICONS[j.id] || "layers"} size=${16} />
      <span>${j.label}</span>
      <span class="p-studio__jump-n">${j.value}</span>
    </button>`)}
  </nav>`;
}

// A part of the page the row can jump to. `span`: how many of the shelf's columns it takes (spanOf).
function Part({ id, span, children }) {
  return html`<div class=${`p-studio__part${span ? ` p-studio__part--span-${span}` : ""}`} id=${partId(id)} tabindex="-1">${children}</div>`;
}

// How many of the shelf's four columns a media part takes: one a card up to four, one for an empty part (its one
// line), all four while its list has not come in or while one of its things is opened in place. Narrower panes
// take fewer columns (studio.css).
export function spanOf(count, { open = false, loaded = true } = {}) {
  if (open || !loaded) return 4;
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return Math.min(4, Math.max(1, n));
}

// True while the window is 860 px wide or more: only then does the band ask for its picture (as Files: on a phone
// the band is a short title strip, so the first card stays near the top). Read at once, so a phone never asks.
const WIDE = "(min-width: 860px)";
function useWide() {
  const read = () => typeof matchMedia !== "function" || matchMedia(WIDE).matches === true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia(WIDE);
    const again = () => setWide(mq.matches === true);
    if (mq.addEventListener) mq.addEventListener("change", again);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", again); };
  }, []);
  return wide;
}

// ---- The page -----------------------------------------------------------------------------------------------

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route?.query || new URLSearchParams();
  const wide = useWide();
  const art = useResource("/api/studio/art", { every: EVERY });
  const dept = useResource("/api/departments/studio", { every: EVERY });
  const slidesRes = useResource("/api/studio/slides", { every: EVERY });
  const videosRes = useResource("/api/studio/videos", { every: EVERY });
  const room = useResource("/api/studio/room", { every: EVERY });
  const filmsRes = useResource("/api/studio/films", { every: EVERY });
  const genRes = useResource("/api/generation", { every: SLOW });
  const viewerRes = useResource("/api/viewer", { every: SLOW });
  const webRes = useResource("/api/web", { every: SLOW });
  const a = art.data;
  const d = dept.data;
  const sl = slidesRes.data;
  const vd = videosRes.data;
  const sprites = list(a?.sprites);
  const images = list(a?.images);
  const sets = list(sl?.sets);
  const videos = list(vd?.videos);
  const films = list(filmsRes.data?.films, 30);
  const problems = problemsOf(a, sl, vd);
  const notices = motionNotices(sl, vd);
  const sprite = query.get("sprite") || "";
  const videoId = query.get("video") || "";
  const slidesId = query.get("slides") || "";
  const filmId = query.get("film") || "";
  const chosenVideo = videoId ? videos.find((v) => v.id === videoId) : null;
  const chosenSet = slidesId ? sets.find((s) => s.id === slidesId) : null;
  const choose = (id) => { if (typeof location !== "undefined") location.hash = studioHref({ sprite: id }); };
  const cad = pick(d?.sections, "cad");
  const files = pick(d?.sections, "files");
  const figures = studioFigures({ art: a, dept: d, slides: sl, videos: vd });
  const jumps = jumpsOf({ films: filmsRes.data ? films : null, figures, images: a ? images : null });
  const off = offSwitches({ generation: genRes.data, viewer: viewerRes.data, web: webRes.data, dept: d });

  // ?slides= opens that set large in the work panel; leaving it closes the panel this page opened.
  const opened = useRef("");
  useEffect(() => {
    if (chosenSet && opened.current !== chosenSet.id) {
      opened.current = chosenSet.id;
      if (typeof app.openPanel === "function") {
        app.openPanel(html`<${SlidesPanel} set=${chosenSet} />`, { title: text(chosenSet.title || chosenSet.name, 120) || "A carousel" });
      }
    } else if (!slidesId && opened.current) {
      opened.current = "";
      if (typeof app.closePanel === "function") app.closePanel();
    }
  }, [slidesId, chosenSet && chosenSet.id]);
  useEffect(() => () => { if (opened.current && typeof app.closePanel === "function") app.closePanel(); }, []);

  const first = (r) => r.loading && !r.data;
  const settled = [art, dept, slidesRes, videosRes, filmsRes].every((r) => r.data || r.error);

  const parts = html`
    ${first(art) && first(dept) ? html`<${Loading} lines=${4} label="Loading the Studio" />` : null}
    ${art.error && !a ? html`<${ErrorNotice} error=${art.error} onRetry=${art.reload} />` : null}
    ${dept.error && !d ? html`<${ErrorNotice} error=${dept.error} onRetry=${dept.reload} />` : null}
    ${a?.notConnected ? html`<${NotConnected} reason=${text(a.notConnected.reason, 300)} next=${text(a.notConnected.next, 300)} />` : null}
    ${d?.notConnected ? html`<${NotConnected} reason=${text(d.notConnected.reason, 300)} next=${text(d.notConnected.next, 300)} />` : null}
    ${notices.map((n, i) => html`<${NotConnected} key=${i} reason=${n.reason} next=${n.next} />`)}

    <${Part} id="films">
      <${Section} title="Films" count=${filmsRes.data ? films.length : undefined}
        hint="Films made from your renders with Runway: each shot, its takes, the Art director's verdicts and what it cost.">
        ${first(filmsRes) ? html`<${Loading} lines=${2} label="Loading the films" />` : null}
        ${filmsRes.error && !filmsRes.data ? html`<${ErrorNotice} error=${filmsRes.error} onRetry=${filmsRes.reload} />` : null}
        ${filmsRes.data ? (films.length
          ? html`<ul class="p-studio__cards">${films.map((f) => html`<${FilmCard} key=${f.task?.id} film=${f} chosen=${!!filmId && (f.task?.id === filmId || f.task?.identifier === filmId)} />`)}</ul>`
          : html`<${Empty} icon="film" title="No films yet."><span>Start "A film from your renders" in <a href="#/jobs/studio/a-film-from-your-renders">Jobs</a>.</span><//>`) : null}
      <//>
    <//>

    <div class="p-studio__shelf-wrap"><div class="p-studio__shelf">
    <${Part} id="videos" span=${spanOf(videos.length, { open: !!(videoId && vd), loaded: !!vd })}>
      <${Section} title="Videos" count=${vd ? videos.length : undefined}>
        ${videoId && vd ? (chosenVideo
          ? html`<${VideoViewer} key=${chosenVideo.id} video=${chosenVideo} settled=${settled} />`
          : html`<${Notice} tone="warn" title="That video is not here.">It may have been moved. <a href=${HERE}>Show all videos</a><//>`) : null}
        ${first(videosRes) ? html`<${Loading} lines=${2} label="Loading the videos" />` : null}
        ${videosRes.error && !vd ? html`<${ErrorNotice} error=${videosRes.error} onRetry=${videosRes.reload} />` : null}
        ${vd ? (videos.length
          ? html`<ul class="p-studio__cards">${videos.map((v) => html`<${VideoCard} key=${v.id} video=${v} chosen=${v.id === videoId} />`)}</ul>`
          : html`<${Empty} icon="video" title="No videos yet." text="Title cards, slow reveals and cut clips the Artist makes show here." />`) : null}
      <//>
    <//>

    <${Part} id="carousels" span=${spanOf(sets.length, { open: !!(slidesId && sl && !chosenSet), loaded: !!sl })}>
      <${Section} title="Carousels" count=${sl ? sets.length : undefined}>
        ${slidesId && sl && !chosenSet ? html`<${Notice} tone="warn" title="That carousel is not here.">It may have been moved. <a href=${HERE}>Show all carousels</a><//>` : null}
        ${first(slidesRes) ? html`<${Loading} lines=${2} label="Loading the carousels" />` : null}
        ${slidesRes.error && !sl ? html`<${ErrorNotice} error=${slidesRes.error} onRetry=${slidesRes.reload} />` : null}
        ${sl ? (sets.length
          ? html`<ul class="p-studio__cards">${sets.map((s) => html`<${SetCard} key=${s.id} set=${s} chosen=${s.id === slidesId} />`)}</ul>`
          : html`<${Empty} icon="layers" title="No carousels yet." text="Slide sets the Artist lays out for Marketing show here." />`) : null}
      <//>
    <//>

    ${a ? html`
      <${Part} id="sprites" span=${spanOf(sprites.length, { open: !!sprite })}>
        <${Section} title="Sprites and animations" count=${sprites.length}>
          ${sprite ? html`<${SpriteViewer} key=${sprite} id=${sprite} query=${query} settled=${settled} />` : null}
          ${sprites.length ? html`
            <ul class="p-studio__cards p-studio__cards--sprites">
              ${sprites.map((s) => html`<${SpriteCard} key=${s.id} sprite=${s} chosen=${s.id === sprite} onChoose=${choose} />`)}
            </ul>` : html`<${Empty} icon="brush" title="No sprites yet." text="Ask the Artist for one from a Studio job." />`}
        <//>
      <//>
      <${Part} id="pictures" span=${spanOf(images.length)}>
        <${Section} title="Pictures" count=${images.length}>
          ${images.length ? html`
            <ul class="p-studio__cards">
              ${images.map((im) => html`<${PictureCard} key=${im.id} image=${im} />`)}
            </ul>` : html`<${Empty} icon="image" title="No pictures yet." text="Badges, icons and other drawings the Artist makes show here." />`}
        <//>
      <//>` : null}
    </div></div>

    ${d ? html`<${Part} id="cad"><${FilesTable} section=${cad} /><//><${Part} id="files"><${FilesTable} section=${files} /><//>` : null}

    <${Room} res=${room} />

    ${problems.length ? html`
      <${Section} title="Files that could not be used" count=${problems.length}>
        <${Rows}>
          ${problems.map((p) => html`<${Row} key=${p.key} icon="alert" title=${p.name} say=${p.problem} />`)}
        <//>
      <//>` : null}

    ${off.length ? html`
      <${Section} title="Switched off">
        <${Rows}>
          ${off.map((s) => html`<${Row} key=${s.id} icon=${s.icon} title=${s.title} state=${OFF_WORDS.off} say=${s.say}
            control=${s.href ? html`<a class="p-studio__settings" href=${s.href} aria-label=${`${s.title}: ${OFF_WORDS.link}`}>${OFF_WORDS.link}<${Icon} name="chevron-right" size=${14} /></a>` : null} />`)}
        <//>
      <//>` : null}

    <${Jobs} dept="studio" />
    <${OpenDepartment} dept="studio" />`;

  // A film opened: the film is the whole pane, and the rest of Studio follows under its own rows.
  if (filmId) {
    return html`<div class="p-studio p-studio--film p-dashboard" data-dept="studio">
      <${FilmView} key=${filmId} id=${filmId} settled=${settled} more=${html`<div class="p-studio__rest">${parts}</div>`} />
    </div>`;
  }

  return html`
    <div class="p-studio p-dashboard" data-dept="studio">
      <${RoomHeader} glimpse=${wide ? glimpseFor("studio") : null} pull back=${{ label: "All dashboards", href: "#/dashboards" }} title="Studio"
        crumbs=${[{ label: "Dashboards", href: "#/dashboards" }, { label: "Studio" }]}
        lead="Videos, slides, drawings, animations and parts made by the Artist and the Drafter."
        actions=${a?.agent || d?.agent ? html`<span class="p-studio__agents">
          ${a?.agent ? html`<${AgentHead} slug="artist" agent=${{ name: "Artist", ...a.agent }} />` : null}
          ${d?.agent ? html`<${AgentHead} slug="drafter" agent=${{ name: "Drafter", ...d.agent }} />` : null}
        </span>` : null}>
        ${jumps.length ? html`<${Jumps} items=${jumps} />` : null}
      <//>
      ${parts}
    </div>`;
}
