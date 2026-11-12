// The Studio dashboard (CONTRACTS-V3 30, 37.3, 37.4; CONTRACTS-V2 9.6, 17.8, 20.3), at #/dashboards/studio:
// videos with a real player and six stills, carousels opened large in the work panel, sprites and animations
// with the sprite player, pictures, CAD parts and other files, the room for footage, files that could not be
// used, and the switches that are off. Built as the other dashboards are (M51 F20): the agents and their states at
// the top right, Jobs to start, Open the department. A link that opens a sprite or a video brings it to the top
// of the pane and moves focus to its heading (M51 F14). Everything shown is text or a picture from a file an agent made: it is
// capped, shown as text, and no link in it is followed. Only addresses under /api/ reach an img or a video.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, count, duration, when } from "../lib/format.js";
import { currentMotion } from "../lib/theme.js";
import { AgentHead, Jobs, OpenDepartment } from "./dashboard.js";
import {
  BeingBuilt, DataTable, Empty, ErrorNotice, Figures, FileCard, Loading, Notice, NotConnected, PageHeader,
  Section, Switch, Tag,
} from "../kit/index.js";

const HERE = "#/dashboards/studio";
const EVERY = 10000;
const THUMB = 64;
const MAX_ITEMS = 200;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const text = (v, max = 200) => (v === null || v === undefined ? "" : String(v).slice(0, max));
const list = (v, max = MAX_ITEMS) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max) : []);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// The address of this page with one thing open: studioHref({ video: "STH-25/title" }). Nothing open: the page.
export function studioHref(open = {}) {
  for (const key of ["sprite", "video", "slides"]) {
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
  if (Number.isFinite(s) && s > 0 && s <= 120) parts.push(s < 1 ? "under a second" : duration(Math.round(s) * 1000));
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
function useBringIntoView(key, settled) {
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

function CheckLines({ lines }) {
  return html`<ul class="p-studio__checks">
    ${lines.map((l) => html`<li key=${l.text} class=${`p-studio__check${l.ok ? "" : " p-studio__check--warn"}`}>
      <span class="p-studio__check-mark" aria-hidden="true">${l.ok ? "\u2713" : "!"}</span>${l.text}
    </li>`)}
  </ul>`;
}

// ---- Sprites ------------------------------------------------------------------------------------------------

function SpriteCard({ sprite, chosen, onChoose }) {
  const line = checkLine(sprite.checks);
  const names = tagNames(sprite);
  return html`
    <li class=${`p-studio__sprite${chosen ? " p-studio__sprite--chosen" : ""}`}>
      <button type="button" class="p-studio__sprite-button" aria-pressed=${chosen ? "true" : "false"} onClick=${() => onChoose(sprite.id)}>
        <span class="p-studio__thumb-box" aria-hidden="true"><span class="p-studio__thumb" style=${thumbStyle(sprite)}></span></span>
        <span class="p-studio__sprite-text">
          <span class="p-studio__sprite-title">${text(sprite.title || sprite.name, 120)}</span>
          <span class="p-studio__meta">${count(num(sprite.frames, 0), "frame")}</span>
          ${names.length ? html`<span class="p-studio__tags">${names.map((n) => html`<${Tag} key=${n}>${text(n, 60)}<//>`)}</span>` : null}
          <span class=${`p-studio__check${line.ok ? "" : " p-studio__check--warn"}`}>${line.ok ? "\u2713 " : ""}${line.text}</span>
        </span>
      </button>
    </li>`;
}

function Player({ id, query, settled }) {
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
    <div class="p-studio__player">
      <div class="p-studio__viewer-head">
        <h3 class="p-studio__viewer-title" tabindex="-1" ref=${head}>${text(d?.sprite?.title, 120) || "Animation"}</h3>
        <a class="p-studio__close" href=${HERE}>Close</a>
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
  return html`<li class=${`p-studio__card${chosen ? " p-studio__card--chosen" : ""}`}>
    <a class="p-studio__card-link" href=${studioHref({ video: video.id })} aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__frame p-studio__frame--wide">
        ${poster ? html`<img class="p-studio__cover" src=${poster} alt="" loading="lazy" />` : html`<span class="p-studio__no-picture">No cover picture</span>`}
        <span class="p-studio__play" aria-hidden="true">\u25B6</span>
      </span>
      <span class="p-studio__card-title">${title}</span>
      <span class="p-studio__meta">${videoWords(video) || "Size not known"}</span>
      <span class=${`p-studio__check${ok ? "" : " p-studio__check--warn"}`}>${ok ? "\u2713 Checked from the file" : "Something is wrong with this file"}</span>
    </a>
  </li>`;
}

function VideoViewer({ video, settled }) {
  const title = text(video.title || video.name, 120) || "A video";
  const src = playable(video) ? safeApi(video.video.viewUrl) : null;
  const poster = safeApi(video.poster?.viewUrl);
  const download = safeApi(video.video?.url);
  const stills = list(video.stills, 6).map((f) => safeApi(f.viewUrl)).filter(Boolean);
  const head = useBringIntoView(video.id, settled);
  return html`<div class="p-studio__viewer">
    <div class="p-studio__viewer-head">
      <h3 class="p-studio__viewer-title" tabindex="-1" ref=${head}>${title}</h3>
      <a class="p-studio__close" href=${HERE}>Close</a>
    </div>
    ${src
      ? html`<video class="p-studio__video" controls preload="none" playsinline src=${src} poster=${poster || undefined} aria-label=${title}
          style=${videoBox(video) || undefined}>
          This browser cannot play the video. Use Download below.
        </video>`
      : html`<${Notice} tone="warn" title="This video cannot play here.">The file is not a video, or it is too large. Its checks are below.<//>`}
    <p class="p-studio__meta">${videoWords(video)}</p>
    <${CheckLines} lines=${videoChecks(video.checks)} />
    ${stills.length ? html`
      <h4 class="p-studio__subhead">Six stills</h4>
      <ol class="p-studio__stills">
        ${stills.map((s, i) => html`<li key=${s} class="p-studio__still">
          <img class="p-studio__still-img" src=${s} alt=${`${title}, still ${i + 1} of ${stills.length}`} loading="lazy" />
        </li>`)}
      </ol>` : null}
    <p class="p-studio__links">
      ${download ? html`<a href=${download} download>Download the video</a>` : null}
      ${video.goal ? html`<a href=${`#/tasks/${encodeURIComponent(text(video.goal, 40))}`}>Open its task</a>` : null}
    </p>
  </div>`;
}

// ---- Carousels ----------------------------------------------------------------------------------------------

function SetCard({ set, chosen }) {
  const contact = safeApi(set.contact?.viewUrl);
  const ok = Boolean(set.checks?.ok);
  const n = num(set.count, list(set.slides).length);
  const size = set.size && whole(set.size.w, 1, 4096) && whole(set.size.h, 1, 4096) ? `, ${set.size.w} by ${set.size.h}` : "";
  return html`<li class=${`p-studio__card${chosen ? " p-studio__card--chosen" : ""}`}>
    <a class="p-studio__card-link" href=${studioHref({ slides: set.id })} aria-current=${chosen ? "true" : undefined}>
      <span class="p-studio__frame">
        ${contact ? html`<img class="p-studio__contact" src=${contact} alt="" loading="lazy" />` : html`<span class="p-studio__no-picture">No contact picture</span>`}
      </span>
      <span class="p-studio__card-title">${text(set.title || set.name, 120) || "A carousel"}</span>
      <span class="p-studio__meta">${count(n, "slide")}${size}</span>
      <span class=${`p-studio__check${ok ? "" : " p-studio__check--warn"}`}>${ok ? "\u2713 Checked from the pictures" : "Something is wrong with these slides"}</span>
    </a>
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
      : html`<${Empty} title="The room is empty." text="Footage and sound you put in the folder show here." />`) : null}
    ${r && typeof r.path === "string" && r.path ? html`
      <details class="p-studio__where">
        <summary class="p-studio__where-line">Where is this folder?</summary>
        <p class="p-studio__where-text">Open this folder in Finder: <code class="p-studio__path">${text(r.path, 400)}</code></p>
      </details>` : null}
  <//>`;
}

// ---- The page -----------------------------------------------------------------------------------------------

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route?.query || new URLSearchParams();
  const art = useResource("/api/studio/art", { every: EVERY });
  const dept = useResource("/api/departments/studio", { every: EVERY });
  const slidesRes = useResource("/api/studio/slides", { every: EVERY });
  const videosRes = useResource("/api/studio/videos", { every: EVERY });
  const room = useResource("/api/studio/room", { every: EVERY });
  const a = art.data;
  const d = dept.data;
  const sl = slidesRes.data;
  const vd = videosRes.data;
  const sprites = list(a?.sprites);
  const images = list(a?.images);
  const sets = list(sl?.sets);
  const videos = list(vd?.videos);
  const problems = problemsOf(a, sl, vd);
  const notices = motionNotices(sl, vd);
  const sprite = query.get("sprite") || "";
  const videoId = query.get("video") || "";
  const slidesId = query.get("slides") || "";
  const chosenVideo = videoId ? videos.find((v) => v.id === videoId) : null;
  const chosenSet = slidesId ? sets.find((s) => s.id === slidesId) : null;
  const choose = (id) => { if (typeof location !== "undefined") location.hash = studioHref({ sprite: id }); };
  const cad = pick(d?.sections, "cad");
  const files = pick(d?.sections, "files");
  const figures = studioFigures({ art: a, dept: d, slides: sl, videos: vd });

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
  const settled = [art, dept, slidesRes, videosRes].every((r) => r.data || r.error);
  return html`
    <div class="p-studio p-dashboard" data-dept="studio">
      <${PageHeader} back=${{ label: "All dashboards", href: "#/dashboards" }} over="DASHBOARD" creature="studio" title="Studio"
        lead="Videos, slides, drawings, animations and parts made by the Artist and the Drafter."
        actions=${a?.agent || d?.agent ? html`<span class="p-studio__agents">
          ${a?.agent ? html`<${AgentHead} slug="artist" agent=${{ name: "Artist", ...a.agent }} />` : null}
          ${d?.agent ? html`<${AgentHead} slug="drafter" agent=${{ name: "Drafter", ...d.agent }} />` : null}
        </span>` : null} />
      ${first(art) && first(dept) ? html`<${Loading} lines=${4} label="Loading the Studio" />` : null}
      ${art.error && !a ? html`<${ErrorNotice} error=${art.error} onRetry=${art.reload} />` : null}
      ${dept.error && !d ? html`<${ErrorNotice} error=${dept.error} onRetry=${dept.reload} />` : null}
      ${a?.notConnected ? html`<${NotConnected} reason=${text(a.notConnected.reason, 300)} next=${text(a.notConnected.next, 300)} />` : null}
      ${d?.notConnected ? html`<${NotConnected} reason=${text(d.notConnected.reason, 300)} next=${text(d.notConnected.next, 300)} />` : null}
      ${notices.map((n, i) => html`<${NotConnected} key=${i} reason=${n.reason} next=${n.next} />`)}
      ${figures.length ? html`<div class="p-studio__figures"><${Figures} figures=${figures} /></div>` : null}

      <${Section} title="Videos" count=${vd ? videos.length : undefined}>
        ${videoId && vd ? (chosenVideo
          ? html`<${VideoViewer} key=${chosenVideo.id} video=${chosenVideo} settled=${settled} />`
          : html`<${Notice} tone="warn" title="That video is not here.">It may have been moved. <a href=${HERE}>Show all videos</a><//>`) : null}
        ${first(videosRes) ? html`<${Loading} lines=${2} label="Loading the videos" />` : null}
        ${videosRes.error && !vd ? html`<${ErrorNotice} error=${videosRes.error} onRetry=${videosRes.reload} />` : null}
        ${vd ? (videos.length
          ? html`<ul class="p-studio__cards">${videos.map((v) => html`<${VideoCard} key=${v.id} video=${v} chosen=${v.id === videoId} />`)}</ul>`
          : html`<${Empty} title="No videos yet." text="Title cards, slow reveals and cut clips the Artist makes show here." />`) : null}
      <//>

      <${Section} title="Carousels" count=${sl ? sets.length : undefined}>
        ${slidesId && sl && !chosenSet ? html`<${Notice} tone="warn" title="That carousel is not here.">It may have been moved. <a href=${HERE}>Show all carousels</a><//>` : null}
        ${first(slidesRes) ? html`<${Loading} lines=${2} label="Loading the carousels" />` : null}
        ${slidesRes.error && !sl ? html`<${ErrorNotice} error=${slidesRes.error} onRetry=${slidesRes.reload} />` : null}
        ${sl ? (sets.length
          ? html`<ul class="p-studio__cards">${sets.map((s) => html`<${SetCard} key=${s.id} set=${s} chosen=${s.id === slidesId} />`)}</ul>`
          : html`<${Empty} title="No carousels yet." text="Slide sets the Artist lays out for Marketing show here." />`) : null}
      <//>

      ${a ? html`
        <${Section} title="Sprites and animations" count=${sprites.length}>
          ${sprite ? html`<${Player} key=${sprite} id=${sprite} query=${query} settled=${settled} />` : null}
          ${sprites.length ? html`
            <ul class="p-studio__sprites">
              ${sprites.map((s) => html`<${SpriteCard} key=${s.id} sprite=${s} chosen=${s.id === sprite} onChoose=${choose} />`)}
            </ul>` : html`<${Empty} title="No sprites yet." text="Ask the Artist for one from a Studio job." />`}
        <//>
        <${Section} title="Pictures" count=${images.length}>
          ${images.length ? html`
            <ul class="p-studio__images">
              ${images.map((im) => html`
                <li key=${im.id} class="p-studio__image">
                  ${safeApi(im.file?.viewUrl) ? html`<img class="p-studio__picture" src=${safeApi(im.file.viewUrl)} alt=${text(im.title || im.name, 120)} loading="lazy" />` : null}
                  <p class="p-studio__image-title">${text(im.title || im.name, 120)}</p>
                  <${FileCard} file=${im.file} />
                </li>`)}
            </ul>` : html`<${Empty} title="No pictures yet." text="Badges, icons and other drawings the Artist makes show here." />`}
        <//>` : null}

      ${d ? html`<${FilesTable} section=${cad} /><${FilesTable} section=${files} />` : null}

      <${Room} res=${room} />

      ${problems.length ? html`
        <${Section} title="Files that could not be used" count=${problems.length}>
          <ul class="p-studio__problems">
            ${problems.map((p) => html`<li key=${p.key}><strong>${p.name}</strong> ${p.problem}</li>`)}
          </ul>
        <//>` : null}

      ${d?.switches?.length ? html`
        <${Section} title="Switched off">
          ${list(d.switches, 20).map((s) => html`<${Switch} key=${s.id} on=${false} disabled label=${text(s.label, 120)} explain=${text(s.explain, 300)} />`)}
        <//>` : null}

      <${Jobs} dept="studio" />
      <${OpenDepartment} dept="studio" />
    </div>`;
}
