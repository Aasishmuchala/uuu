// A site an agent built for a task, as the owner sees it (PLAN-V5 K15, K16, T54; drawn on a stage by PLAN-COOK T41,
// from the C3 mockup's S01). Three pieces a page places in a StageLayout, all driven by one useSiteView:
//   SiteStage: the bar (which page, which look, Take pictures again, the zip, Open the preview) and the pictures of
//     the chosen page at desktop and phone width side by side at one scale (each opening larger), or the state of
//     the pictures when they are not there (being taken, the viewer off, none yet, failed), and the files left out;
//   SiteStrip: one card per version (a to c, as the server lists them), choosing which one the stage shows; nothing
//     for a single site;
//   SiteRail: what the page viewer found, numbered across the site's pages (choosing one shows its page), the brand
//     check as sent, and when the pictures were taken.
// SiteView stacks the three in one column for a page that has no stage. From GET /api/tasks/:id/sites
// (routes/sites.mjs, T52). "Open the preview" loads the site into the owner's preview and opens it in a new tab with
// noopener and noreferrer, only at the preview's own address on 127.0.0.1.
// Everything here came from an agent's folder or from the home server's reading of it: a direction's title, a page's
// name, a report line and a left-out file's name are text nodes, capped; a picture comes only from the exact
// /api/sites/shot/<64 hex>/<shot name> address (C21); nothing is ever set as HTML.
// ShotPair (the two frames) is also used by Settings for the page viewer's Test pictures.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { bytes, count } from "../lib/format.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Dialog } from "./overlays.js";
import { Blk } from "./layout.js";
import { Segmented } from "./segmented.js";
import { Finds, Frames, StageBar } from "./stage.js";
import { StatusDot } from "./status.js";
import { Notice } from "./states.js";
import { PickPrimary } from "./pick.js";
import { Tag } from "./tag.js";
import { OptionCard, Strip } from "./strip.js";
import { Time } from "./text.js";
import { cx, nextId } from "./util.js";

// ---- Words (rule 9; the server's own sentences win where it sends them) ----

export const SITE_WORDS = {
  title: "How the site looks",
  titleMany: "How each version looks",
  lead: "Pictures from a hidden Chrome on this Mac, at desktop and phone width. Nothing was sent anywhere.",
  off: "The page viewer is off, so there are no pictures of this site. Switch it on in Settings.",
  settingsLink: "Switch it on in Settings.",
  working: "Taking pictures. This takes about a minute.",
  again: "Take pictures again",
  tryAgain: "Try again",
  preview: "Open the preview",
  zip: "Download as a zip",
  opened: "The preview opened in a new tab.",
  openHere: "If it did not, open it here.",
  badAddress: "The preview gave an address this page does not open.",
  found: "What the page viewer found",
  nothing: "Nothing to fix was found.",
  desktop: "Desktop",
  phone: "Phone",
  light: "Light",
  dark: "Dark",
  noPicture: "No picture at this width",
  open: "open it larger",
  // The stage, the strip and the rail (PLAN-COOK T41).
  lightPage: "Light page",
  darkPage: "Dark page",
  whichPage: "Which page",
  whichLook: "The page's own colours",
  versions: "The versions",
  meets: "Meets the bar",
  below: "Below the bar",
  fine: "Nothing to fix",
  brand: "Your brand kit",
  notLoaded: "A picture of this page could not be loaded. Take pictures again, or open the preview.",
  taken: "Pictures taken",
  where: "by a hidden Chrome on this Mac. Nothing was sent anywhere.",
  // T102: a long list of findings shows this many, then "Show all 7".
  showAll: "Show all",
  toLook: "to look at",
  // T112: the larger picture as a place to look and decide.
  back: "Back to the versions",
  before: "The version before",
  after: "The next version",
  whichWidth: "Which picture",
  whole: "The whole page; it scrolls",
  // R5-D: the pictures' facts as a fold in the rail.
  pictures: "About the pictures",
};

// How many findings the rail shows before "Show all".
const FIRST_FINDS = 4;

const POLL_MS = 4000;
const PREVIEW_ADDRESS = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/$/;
const SHOT_ADDRESS = /^\/api\/sites\/shot\/[0-9a-f]{64}\/shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;
const REF = /^[a-z0-9][a-z0-9-]{0,35}(-[abc])?$/;
const LETTER = /^[abc]$/;
const WIDTHS = { 1280: "desktop", 390: "phone" };

const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
// Plain capped text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => {
  const s = text(v).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/ {2,}/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// ---- Pure helpers (tested in test/kit-site.test.mjs) ----

// The preview's address as the home server gave it, only when it is exactly the preview's own on 127.0.0.1.
export function previewAddress(url) {
  return typeof url === "string" && PREVIEW_ADDRESS.test(url) ? url : null;
}

// A kept picture's address, only when it is exactly the home server's own (C21); anything else is not shown.
export function shotUrl(url) {
  return typeof url === "string" && SHOT_ADDRESS.test(url) ? url : null;
}

// The sites of the answer that can be shown: a ref the server's rule allows, each once, in the server's order.
export function sitesOf(data) {
  const seen = new Set();
  const out = [];
  for (const s of list(obj(data) ? data.sites : null)) {
    if (!obj(s) || typeof s.ref !== "string" || !REF.test(s.ref) || seen.has(s.ref)) continue;
    seen.add(s.ref);
    out.push(s);
  }
  return out.slice(0, 6);
}

// True while any site's pictures are being taken (the page then reads the list again every few seconds).
export const anyWorking = (data) => sitesOf(data).some((s) => obj(s.shots) && s.shots.state === "working");

// A site's name: { letter: "A", title: "Editorial", label: "Version A: Editorial" }; a single site is named by its
// folder ("launch").
export function siteName(site) {
  const s = obj(site) ? site : {};
  const letter = typeof s.variant === "string" && LETTER.test(s.variant) ? s.variant.toUpperCase() : "";
  const title = plain(obj(s.direction) ? s.direction.title : "", 80) || (letter ? `Version ${letter}` : plain(s.ref, 40) || "The site");
  return { letter, title, label: letter ? `Version ${letter}: ${title}` : title };
}

// "6 files, 84 KB".
export function sizeWords(site) {
  const s = obj(site) ? site : {};
  return `${count(num(s.files), "file")}, ${bytes(num(s.bytes))}`;
}

// A page's name as the owner reads it: the first page is the home page.
export function pageWords(page) {
  const p = plain(page, 100);
  if (p === "index.html") return "Home page";
  const name = p.replace(/\.html$/, "");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "A page";
}

// The pages of a site with pictures or a report, in the server's order (index.html first).
export function pagesOfSite(site) {
  const s = obj(site) ? site : {};
  const shots = obj(s.shots) ? s.shots : {};
  const out = [];
  const add = (p) => { if (typeof p === "string" && p && !out.includes(p) && out.length < 3) out.push(p); };
  for (const p of list(s.pages)) add(p);
  for (const r of list(shots.report)) if (obj(r)) add(r.page);
  for (const i of list(shots.images)) if (obj(i)) add(i.page);
  return out;
}

// The looks a site's pictures come in: ["light"], or ["light", "dark"] when there are dark ones.
export function schemesOf(images) {
  const dark = list(images).some((i) => obj(i) && i.scheme === "dark" && shotUrl(i.url));
  return dark ? ["light", "dark"] : ["light"];
}

// The two pictures of one page in one look: { desktop, phone }, each a checked address or null.
export function picturesOf(images, page, scheme = "light") {
  const out = { desktop: null, phone: null };
  for (const i of list(images)) {
    if (!obj(i) || i.page !== page || i.scheme !== scheme || !Object.hasOwn(WIDTHS, i.width)) continue;
    const url = shotUrl(i.url);
    const at = WIDTHS[i.width];
    if (url && !out[at]) out[at] = url;
  }
  return out;
}

// One page's report as the card lays it out: { page, fine, lines: [{ text, tone }], drawn }. "Nothing to fix was
// found." makes it fine; "Drawn with: …" is said apart, quietly; a page that was cut is a problem; the rest are
// things to look at.
export function reportOf(site, page) {
  const s = obj(site) ? site : {};
  const shots = obj(s.shots) ? s.shots : {};
  const r = list(shots.report).find((x) => obj(x) && x.page === page);
  const out = { page: plain(page, 100), fine: false, lines: [], drawn: "" };
  if (!r) return out;
  for (const l of list(r.lines).slice(0, 30)) {
    const t = plain(l, 300);
    if (!t) continue;
    if (t === SITE_WORDS.nothing) out.fine = true;
    else if (t.startsWith("Drawn with: ")) out.drawn = t;
    else out.lines.push({ text: t, tone: t.startsWith("This page was cut") ? "bad" : "warn" });
  }
  if (out.lines.length) out.fine = false;
  return out;
}

// Each page's report, for every page of the site.
export const reportLayout = (site) => pagesOfSite(site).map((p) => reportOf(site, p));

// The files the server left out of the site, one sentence each: "Left out of the site: linked.css (a link)".
export function leftLines(left) {
  return list(left).filter(obj).slice(0, 20).map((l) => {
    const why = plain(l.why, 80);
    return `Left out of the site: ${plain(l.name, 120) || "a file"}${why ? ` (${why})` : ""}`;
  });
}

// A sentence that ends in "Switch it on in Settings." as its words and the link: { before, link }.
export function settingsSplit(sentence) {
  const s = plain(sentence, 300);
  const at = s.lastIndexOf(SITE_WORDS.settingsLink);
  if (at < 0 || at + SITE_WORDS.settingsLink.length !== s.length) return { before: s, link: "" };
  return { before: s.slice(0, at).trim(), link: SITE_WORDS.settingsLink };
}

// The state of a site's pictures as one line: { state, tone, sentence, retry } (null when the pictures are there
// and nothing is being taken). `retry` is the button that goes with it, if any.
export function stateLine(site, viewer) {
  const s = obj(site) ? site : {};
  const shots = obj(s.shots) ? s.shots : {};
  const on = obj(viewer) && viewer.on === true;
  const said = plain(shots.sentence, 300);
  switch (shots.state) {
    case "ready": return null;
    case "working": return { state: "working", tone: "live", sentence: said || SITE_WORDS.working, retry: "" };
    case "off": return { state: "off", tone: "off", sentence: said || SITE_WORDS.off, retry: "" };
    case "failed": return { state: "failed", tone: "bad", sentence: said || "No pictures could be taken.", retry: on ? SITE_WORDS.tryAgain : "" };
    default: return { state: "none", tone: "off", sentence: said || "No pictures of this site yet.", retry: on && obj(viewer) && viewer.state === "on" ? SITE_WORDS.again : "" };
  }
}

// The addresses of one site's actions. `id` is the task's id or identifier as the page has it.
export function siteAddress(id, ref, what) {
  const base = `/api/tasks/${encodeURIComponent(text(id))}/sites/${encodeURIComponent(text(ref))}`;
  return what ? `${base}/${what}` : base;
}

// The findings of a site, numbered across its pages in the server's order: [{ n, page, text, tone, width }]. `width`
// is 1280 or 390 when the sentence names that width ("Wider than the screen at 390 px: …"), else null (both).
export function findsOf(site) {
  const out = [];
  for (const r of reportLayout(site)) {
    for (const l of r.lines) {
      if (out.length >= 30) return out;
      const m = /\bat (1280|390) px\b/.exec(l.text);
      out.push({ n: out.length + 1, page: r.page, text: l.text, tone: l.tone, width: m ? Number(m[1]) : null });
    }
  }
  return out;
}

// A finding's line as it is shown: when the server's line ends in a bracketed measurement ("Hard to read: \"…\"
// (#8A8278 on #FBFAF7, 3.63 to 1)"), the words before the bracket and the bracket's contents on a line of their own:
// { line, measure }. A display split only: every word of the line is still shown. No bracket: { line, measure: "" }.
export function findSplit(t) {
  const s = text(t);
  const m = /^(.*\S)\s+\(([^()]+)\)$/s.exec(s);
  return m ? { line: m[1], measure: m[2] } : { line: s, measure: "" };
}

const CONTRAST = /^(Hard to read): ("[\s\S]*") \((#[0-9A-Fa-f]{3,8}) on (#[0-9A-Fa-f]{3,8}), ([0-9]+(?:\.[0-9]+)?) to 1\)$/;

// A finding's line as its row shows it (PLAN-COOK T112): { title, rest, measure, swatch }. The server's
// `Hard to read: "…" (#8A8278 on #FBFAF7, 3.63 to 1)` is the title "Hard to read", the quoted words as `rest`, and
// the bracket as `measure` with its two colours and the ratio in `swatch` ({ ink, ground, ratio }); any other line
// is split at its first ": " (a short head with no quote in it) and its closing bracket (findSplit). A display split
// only: `${title}: ${rest} (${measure})`, each part where present, is the line as sent (pinned).
export function findParts(t) {
  const s = text(t);
  const c = CONTRAST.exec(s);
  if (c) return { title: c[1], rest: c[2], measure: `${c[3]} on ${c[4]}, ${c[5]} to 1`, swatch: { ink: c[3], ground: c[4], ratio: c[5] } };
  const { line, measure } = findSplit(s);
  const at = line.indexOf(": ");
  const head = at > 0 && at <= 60 && !line.slice(0, at).includes("\"")
    ? { title: line.slice(0, at), rest: line.slice(at + 2) }
    : { title: line, rest: "" };
  return { ...head, measure, swatch: null };
}

// The findings a frame of one page at one width names in its label, as pins with no place (the server sends no
// positions yet, PLAN-COOK O8): [{ n }].
export function pinsFor(finds, page, width) {
  return list(finds).filter((f) => obj(f) && f.page === page && (f.width === null || f.width === width)).map((f) => ({ n: f.n }));
}

// "The page viewer found 5 things in A"; a single site is named by its folder.
export function foundWords(n, site) {
  const name = siteName(site);
  return `The page viewer found ${count(num(n), "thing")} in ${name.letter || name.title}`;
}

// What the stage is called: "How version A looks", or "How the site looks".
export function stageLabel(site) {
  const name = siteName(site);
  return name.letter ? `How version ${name.letter} looks` : SITE_WORDS.title;
}

// A version's line from the Art director's review as the caller passes it ({ total, meets, reason }):
// { total: "55 of 70", state: the bar's chip or null, reason }. null without a total from 0 to 70.
export function scoreLine(review) {
  if (!obj(review) || !Number.isInteger(review.total) || review.total < 0 || review.total > 70) return null;
  const state = review.meets === true ? { tone: "good", text: SITE_WORDS.meets }
    : review.meets === false ? { tone: "warn", text: SITE_WORDS.below } : null;
  return { total: `${review.total} of 70`, state, reason: plain(review.reason, 200) };
}

// ---- Parts ----

// One picture in a frame drawn like the screen it was taken on: a browser window for the desktop, a phone for the
// phone (ShotPair, the Settings Test's size). The frame shows the top of the page; pressing it opens the whole page.
function PairFrame({ url, at, label, onOpen }) {
  const word = at === "desktop" ? SITE_WORDS.desktop : SITE_WORDS.phone;
  const px = at === "desktop" ? "1280 px" : "390 px";
  return html`<figure class=${cx("k-site__frame", `k-site__frame--${at}`)}>
    ${url
      ? html`<button type="button" class="k-site__screen" onClick=${onOpen} aria-label=${`${label}, ${word.toLowerCase()} (${px}): ${SITE_WORDS.open}`}>
          <span class="k-site__bar" aria-hidden="true"><span class="k-site__dots"></span></span>
          <img class="k-site__img" src=${url} alt="" loading="lazy" decoding="async" />
          <span class="k-site__zoom" aria-hidden="true"><${Icon} name="external" size=${14} /></span>
        </button>`
      : html`<div class="k-site__screen k-site__screen--none">
          <span class="k-site__bar" aria-hidden="true"><span class="k-site__dots"></span></span>
          <span class="k-site__none-words">${SITE_WORDS.noPicture}</span>
        </div>`}
    <figcaption class="k-site__cap"><span class="k-site__cap-word">${word}</span><span class="k-site__cap-px">${px}</span></figcaption>
  </figure>`;
}

// ShotPair's whole page opened larger in the kit's dialog (a stage's frames open Viewer instead): the picture as wide as the
// dialog, the whole page scrolling in it, and the switch between the two widths in the head beside the title.
// `desktop` and `phone` are checked addresses or null; `open` is "desktop", "phone" or null; `sub` (optional) is the
// muted line under the title, a function of the width shown.
function Larger({ desktop, phone, open, onOpen, label, sub }) {
  const shown = open === "phone" ? phone : open === "desktop" ? desktop : null;
  return html`<${Dialog} open=${Boolean(shown)} size="full" onClose=${() => onOpen(null)}
    title=${`${label}: ${open === "phone" ? "phone, 390 px" : "desktop, 1280 px"}`}
    sub=${typeof sub === "function" ? sub(open) : undefined}
    tools=${desktop && phone ? html`<${Segmented} label="Which picture" size="sm" current=${open}
      items=${[{ id: "desktop", label: SITE_WORDS.desktop }, { id: "phone", label: SITE_WORDS.phone }]} onChange=${onOpen} />` : null}>
    <figure class=${cx("k-site__large", open === "phone" && "k-site__large--phone")}>
      <img src=${shown} alt=${`${label}, the whole page at ${open === "phone" ? "phone" : "desktop"} width`} decoding="async" />
    </figure>
  <//>`;
}

// The desktop and the phone picture of one page side by side, each opening larger in a dialog where the whole page
// scrolls. `small` is the Settings Test's size. `label` names what the pictures are of (built here, plain text).
export function ShotPair({ desktop = null, phone = null, label = "The page", small = false }) {
  const [open, setOpen] = useState(null);
  const d = shotUrl(desktop);
  const p = shotUrl(phone);
  if (!d && !p) return null;
  return html`<div class=${cx("k-site__pair", small && "k-site__pair--small")}>
    <${PairFrame} url=${d} at="desktop" label=${label} onOpen=${() => setOpen("desktop")} />
    <${PairFrame} url=${p} at="phone" label=${label} onOpen=${() => setOpen("phone")} />
    <${Larger} desktop=${d} phone=${p} open=${open} onOpen=${setOpen} label=${label} />
  </div>`;
}

// A sentence that may end in "Switch it on in Settings.", that ending a link to Settings.
function WithSettings({ sentence }) {
  const s = settingsSplit(sentence);
  if (!s.link) return html`<span>${s.before}</span>`;
  return html`<span>${s.before} <a class="k-site__link" href="#/settings?s=viewer">${s.link}</a></span>`;
}

// A failed action's sentence, the server's own: "… Run: engine start" sets the command apart.
function Failed({ failure }) {
  if (!failure) return null;
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(failure.message);
  return html`<p class="k-site__failed" role="alert"><${Icon} name="alert" size=${14} />
    ${m ? html`<span>${m[1]} <code class="k-next__command">${m[2]}</code></span>` : html`<span><${WithSettings} sentence=${failure.message} /></span>`}
  </p>`;
}

// The state of the pictures when they are not simply there. With no pictures to show, it is said inside the footprint
// of the two frames (a desktop's and a phone's outline at their true shapes), so the stage keeps its shape; with
// pictures already there (a new set being taken), `inline` says it on one line above them.
function NoPictures({ line, problem, busy, onAgain, inline = false }) {
  const say = problem ? { state: "failed", sentence: problem, retry: "" } : line;
  if (!say) return null;
  const words = say.state === "working"
    ? html`<p class="k-site__state k-site__state--live" role="status"><${StatusDot} tone="live" label=${say.sentence} /></p>`
    : html`<span class="k-site__empty-icon" aria-hidden="true"><${Icon} name=${say.state === "failed" ? "alert" : "image"} size=${18} /></span>
      <p class="k-site__empty-words">${problem ? problem : html`<${WithSettings} sentence=${say.sentence} />`}</p>
      ${say.retry ? html`<${Button} size="sm" icon="loop" busy=${busy} onClick=${onAgain}>${say.retry}<//>` : null}`;
  const role = say.state === "failed" ? "alert" : undefined;
  if (inline) return html`<div class=${cx("k-site__line", `k-site__line--${say.state}`)} role=${role}>${words}</div>`;
  return html`<div class=${cx("k-site__empty", `k-site__empty--${say.state}`)}>
    <div class="k-site__ghost k-site__ghost--desk" role=${role}>${words}</div>
    <div class="k-site__ghost k-site__ghost--phone" aria-hidden="true"></div>
  </div>`;
}

// The sites of a task, read when `stamp` changes and every few seconds while pictures are being taken. null while
// unread, when the route is missing (an older home server answers 404) or when the first read fails; a later failed
// read keeps what was shown.
function useSites(id, stamp) {
  const [got, setGot] = useState({ id: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    api.get(`/api/tasks/${encodeURIComponent(id)}/sites`)
      .then((data) => { if (live) setGot({ id, data: obj(data) ? data : null }); })
      .catch(() => { if (live) setGot((g) => (g.id === id ? g : { id, data: null })); });
    return () => { live = false; };
  }, [id, stamp, tick]);
  const data = got.id === id ? got.data : null;
  const working = anyWorking(data);
  useEffect(() => {
    if (!working) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [working, data]);
  return { data, reload: () => setTick((n) => n + 1) };
}

// useSiteView({ id, stamp }): the one state the three pieces share. Reads the task's sites (as SiteView always has)
// and holds which version, which page, which look and which finding are chosen:
// { id, sites, site, many, viewer, pages, page, schemes, scheme, pictures, finds, finding,
//   broken, choose(ref), setPage(page), setScheme(scheme), setFinding(n), lost(event), reload() }. `site` is null for a task with no sites.
export function useSiteView({ id, stamp = "" } = {}) {
  const { data, reload } = useSites(id, stamp);
  const [chosen, setChosen] = useState(null);
  const [want, setWant] = useState({ page: null, scheme: "light", finding: null });
  const sites = sitesOf(data);
  const site = sites.find((s) => s.ref === chosen) || sites[0] || null;
  const viewer = obj(data) && obj(data.viewer) ? data.viewer : { on: false, state: "off" };
  const pages = site ? pagesOfSite(site) : [];
  const page = pages.includes(want.page) ? want.page : pages[0] || null;
  const images = site && obj(site.shots) ? list(site.shots.images) : [];
  const schemes = schemesOf(images);
  const scheme = schemes.includes(want.scheme) ? want.scheme : "light";
  const finds = site ? findsOf(site) : [];
  const finding = finds.some((f) => f.n === want.finding) ? want.finding : null;
  // Pictures that did not load: taken off the stage and the strip, and said once (SiteStage).
  const [broken, setBroken] = useState([]);
  return {
    id, sites, site, many: sites.length > 1, viewer, pages, page, schemes, scheme, finds, finding,
    pictures: page ? picturesOf(images, page, scheme) : { desktop: null, phone: null },
    choose: (ref) => { setChosen(ref); setWant((w) => ({ ...w, page: null, finding: null })); },
    setPage: (p) => setWant((w) => ({ ...w, page: p, finding: null })),
    setScheme: (s) => setWant((w) => ({ ...w, scheme: s })),
    setFinding: (n) => {
      const f = finds.find((x) => x.n === n);
      if (f) setWant((w) => ({ ...w, page: f.page, finding: n }));
    },
    broken,
    // An img's error event: its address joins `broken` (only a kept picture's address is ever there).
    lost: (event) => {
      const src = event && event.target && typeof event.target.getAttribute === "function" ? event.target.getAttribute("src") : null;
      if (src && shotUrl(src)) setBroken((b) => (b.includes(src) ? b : [...b, src]));
    },
    reload: () => { setBroken([]); reload(); },
  };
}

// SiteStage({ view, scores, pick }): the bar, then the pictures of the chosen page at one scale, or the state of the
// pictures; a frame opens the larger picture (Viewer). `scores` (optional) is SiteStrip's: the version's score and
// verdict in the larger picture's head. `pick` (optional) is { item, onDone, onChanged } while a pick waits on the
// owner: the larger picture's foot then carries the same pick as the rail's (kit/pick.js PickPrimary).
export function SiteStage({ view, scores = null, pick = null }) {
  const [open, setOpen] = useState(null);
  if (!view || !view.site) return null;
  // The viewer stays open across versions (StageBody is drawn again for each), so it lives here.
  return html`<${StageBody} key=${view.site.ref} view=${view} onOpen=${setOpen} />
    <${Viewer} view=${view} open=${open} onOpen=${setOpen} scores=${scores} pick=${pick} />`;
}

// A colour code from the server's line, only as a colour: "#8A8278".
const COLOUR = /^#[0-9A-Fa-f]{3,8}$/;

// A finding's measurement as a small neutral chip: for a contrast, the ink on its ground as two swatches and the
// ratio ("3.63 : 1"), its codes in the chip's name for a screen reader and on hover; else the bracket's words.
function Measure({ parts }) {
  if (!parts.measure) return null;
  const sw = parts.swatch;
  if (!sw || !COLOUR.test(sw.ink) || !COLOUR.test(sw.ground)) return html`<span class="k-site__measure"><${Tag}>${parts.measure}<//></span>`;
  return html`<span class="k-site__measure" role="img" aria-label=${parts.measure} title=${parts.measure}><${Tag}>
    <span class="k-site__swatch" style=${`background:${sw.ink}`} aria-hidden="true"></span><span class="k-site__swatch" style=${`background:${sw.ground}`} aria-hidden="true"></span>
    <span class="k-site__ratio" aria-hidden="true">${sw.ratio} : 1</span>
  <//></span>`;
}

// One finding as a row of Finds: its plain name, the measurement as a chip at the right, the line's other words
// muted under it (two lines at most; all of them on hover), and the page as a small tag when it is not the page in
// view (`here`): at the head of the muted line, or beside the name when there is none, so a narrow rail keeps the
// name and its chip on one line. Every word is a text node, as sent.
export function findItem(f, here) {
  const p = findParts(f.text);
  const tag = f.page !== here ? html`<span class="k-site__find-page"><${Tag}>${pageWords(f.page)}<//></span>` : null;
  const side = p.measure || tag ? html`<span class="k-site__find-side"><${Measure} parts=${p} />${tag}</span>` : null;
  return {
    n: f.n,
    title: html`<span class="k-site__find-head"><span class="k-site__find">${p.title}</span>${side}</span>${p.rest ? html`<span class="k-site__find-rest" title=${p.rest}>${p.rest}</span>` : null}`,
  };
}

// What a finding is called in the one line that sums them, by its plain name: "small target", "hard to read".
const KINDS = [
  [/^[0-9]+ links? or buttons? (is|are) smaller than/, "small target", "small targets"],
  [/^Hard to read$/, "hard to read", "hard to read"],
  [/^Wider than the screen/, "too wide", "too wide"],
  [/^Pictures that did not load|did not load$/, "picture not loaded", "pictures not loaded"],
  [/^This page was cut/, "page cut", "pages cut"],
];

// The line that sums a site's findings, by kind, in the order met: "7 things: 2 small targets,
// 5 hard to read". A kind it has no short word for is counted as "other". "" with no findings.
export function findsSum(finds) {
  const all = list(finds).filter((f) => obj(f) && typeof f.text === "string");
  if (!all.length) return "";
  const kinds = new Map();
  for (const f of all) {
    const title = findParts(f.text).title;
    const k = KINDS.find(([re]) => re.test(title));
    const key = k ? k[1] : "other";
    const got = kinds.get(key) || { n: 0, one: key, many: k ? k[2] : "other" };
    got.n += 1;
    kinds.set(key, got);
  }
  const parts = [...kinds.values()].map((k) => `${k.n} ${k.n === 1 ? k.one : k.many}`);
  return `${count(all.length, "thing")}: ${parts.join(", ")}`;
}

// A row of the rail that opens in place (the shotlist's fold, drawn for a site): its name, a short fact at the right,
// and a chevron; closed at first. Its body is the caller's.
export function SiteFold({ title, aside, children }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : children;
  if (!kids || (Array.isArray(kids) && !kids.length)) {
    return html`<div class="k-site__fold k-site__fold--still"><div class="k-site__fold-head">
      <span class="k-site__fold-name">${title}</span>
      ${aside ? html`<span class="k-site__fold-aside">${aside}</span>` : null}
      <span class="k-site__fold-mark" aria-hidden="true"></span>
    </div></div>`;
  }
  return html`<details class="k-site__fold">
    <summary class="k-site__fold-head">
      <span class="k-site__fold-name">${title}</span>
      ${aside ? html`<span class="k-site__fold-aside">${aside}</span>` : null}
      <span class="k-site__fold-mark" aria-hidden="true"><${Icon} name="chevron-down" size=${16} /></span>
    </summary>
    <div class="k-site__fold-body">${children}</div>
  </details>`;
}

// The larger picture, a place to look and decide: the kit's Dialog at the window's size. The head: the version's
// name, its score and verdict as chips, the page tabs, the Desktop and Phone switch, "A of 3" with the version before
// and the next; the body: the whole page in a well on the stage's tone (it scrolls; a fade at its foot while more is
// below) and a rail with every finding; the foot: back to the versions, and the pick when one waits.
function Viewer({ view, open, onOpen, scores, pick }) {
  const well = useRef(null);
  const [more, setMore] = useState(false);
  const site = view.site;
  const look = () => {
    const el = well.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useEffect(() => {
    const el = well.current;
    if (el) el.scrollTop = 0;
    look();
  }, [open, site && site.ref, view.page, view.scheme]);
  if (!open || !site) return null;
  const { sites, pages, page, finds, finding, pictures, broken } = view;
  const desk = pictures.desktop && !broken.includes(pictures.desktop) ? pictures.desktop : null;
  const phone = pictures.phone && !broken.includes(pictures.phone) ? pictures.phone : null;
  const at = open === "phone" ? (phone ? "phone" : "desktop") : (desk ? "desktop" : "phone");
  const shown = at === "phone" ? phone : desk;
  const name = siteName(site);
  const sc = scoreLine(obj(scores) ? scores[site.variant] || scores[site.ref] : null);
  const i = sites.findIndex((s) => s.ref === site.ref);
  const letterAt = (k) => siteName(sites[k]).letter || String(k + 1);
  const go = (k) => { if (sites[k]) view.choose(sites[k].ref); };
  const label = pages.length > 1 && page ? `${name.label}, ${pageWords(page)}` : name.label;
  const waiting = pick && obj(pick) && pick.item && typeof site.variant === "string";
  const close = () => onOpen(null);
  const reports = reportLayout(site);
  const drawn = [...new Set(reports.map((r) => r.drawn).filter(Boolean))];
  const shots = obj(site.shots) ? site.shots : {};
  const size = `${sizeWords(site)}${pages.length ? `, ${count(pages.length, "page")}` : ""}`;
  const foot = view.many || waiting ? html`
    ${view.many ? html`<${Button} variant="ghost" class="k-site__back" onClick=${close}>${SITE_WORDS.back}<//>` : null}
    ${waiting ? html`<${PickPrimary} item=${pick.item} chosen=${site.variant} onChanged=${pick.onChanged}
      onDone=${(r) => { close(); if (typeof pick.onDone === "function") pick.onDone(r); }} />` : null}` : null;
  return html`<${Dialog} open=${Boolean(shown)} size="full" onClose=${close} title=${name.label}
    sub=${sc ? html`<span class="k-site__chips"><${Tag}>${sc.total}<//>${sc.state ? html`<${Tag} tone=${sc.state.tone}>${sc.state.text}<//>` : null}</span>` : undefined}
    tools=${html`<div class="k-site__viewer-tools">
      ${pages.length > 1 ? html`<${Segmented} label=${SITE_WORDS.whichPage} size="sm" current=${page}
        items=${pages.map((p) => ({ id: p, label: pageWords(p) }))} onChange=${view.setPage} />` : null}
      ${desk && phone ? html`<${Segmented} label=${SITE_WORDS.whichWidth} size="sm" current=${at}
        items=${[{ id: "desktop", label: SITE_WORDS.desktop }, { id: "phone", label: SITE_WORDS.phone }]} onChange=${onOpen} />` : null}
      ${view.many && i >= 0 ? html`<div class="k-site__pager" role="group" aria-label=${SITE_WORDS.versions}>
        <${Button} variant="quiet" size="sm" icon="chevron-left" aria-label=${SITE_WORDS.before} disabled=${i === 0} onClick=${() => go(i - 1)} />
        <span class="k-site__pager-at">${letterAt(i)} of ${sites.length}</span>
        <${Button} variant="quiet" size="sm" icon="chevron-right" aria-label=${SITE_WORDS.after} disabled=${i === sites.length - 1} onClick=${() => go(i + 1)} />
      </div>` : null}
    </div>`}
    footer=${foot}>
    <div class=${cx("k-site__viewer", at === "phone" && "k-site__viewer--phone")}>
      <div class=${cx("k-site__well-box", more && "k-site__well-box--more")}>
        <div class="k-site__well" ref=${well} onScroll=${look} tabindex="0" role="region" aria-label=${SITE_WORDS.whole}>
          <figure class="k-site__whole">
            <img src=${shown} alt=${`${label}, the whole page at ${at} width`} decoding="async" onLoad=${look} />
          </figure>
        </div>
        <span class="k-site__well-fade" aria-hidden="true"></span>
      </div>
      <section class="k-site__viewer-rail" aria-label=${SITE_WORDS.found}>
        <h3 class="k-site__viewer-h">${finds.length ? foundWords(finds.length, site) : SITE_WORDS.found}</h3>
        ${finds.length
          ? html`<${Finds} selected=${finding} onSelect=${view.setFinding} items=${finds.map((f) => findItem(f, page))} />`
          : reports.some((r) => r.fine) ? html`<p class="k-site__fine"><${Icon} name="check" size=${16} /><span>${SITE_WORDS.nothing}</span></p>` : null}
        ${drawn.map((d) => html`<p key=${d} class="k-say k-site__drawn">${d}</p>`)}
        ${shots.state === "ready" && shots.taken ? html`<p class="k-say k-site__facts">${SITE_WORDS.taken} <${Time} at=${shots.taken} /> ${SITE_WORDS.where} ${size}.</p>` : null}
        ${finds.length > 1 ? html`<p class="k-site__sum">${findsSum(finds)}</p>` : null}
      </section>
    </div>
  <//>`;
}

// The line under the larger picture's title: the version's score as the Art director gave it, and what the page
// viewer found at that width ("55 of 70 · Meets the bar · 4 things to look at").
export function largerLine(review, finds, page, width) {
  const sc = scoreLine(review);
  const n = pinsFor(finds, page, width).length;
  const parts = sc ? [sc.total, sc.state ? sc.state.text : ""] : [];
  parts.push(n ? `${count(n, "thing")} ${SITE_WORDS.toLook}` : SITE_WORDS.fine);
  return parts.filter(Boolean).join(" · ");
}

function StageBody({ view, onOpen }) {
  const { id, site, viewer, pages, page, schemes, scheme, finds, finding, pictures } = view;
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [opened, setOpened] = useState(null);
  const broken = view.broken;
  const name = siteName(site);
  const shots = obj(site.shots) ? site.shots : {};
  const ready = shots.state === "ready";
  const problem = plain(site.problem, 300);
  const line = stateLine(site, viewer);
  const left = leftLines(site.left);
  const label = pages.length > 1 && page ? `${name.label}, ${pageWords(page)}` : name.label;
  const looked = scheme === "dark" ? `${label}, dark` : label;
  const desk = pictures.desktop && !broken.includes(pictures.desktop) ? pictures.desktop : null;
  const phone = pictures.phone && !broken.includes(pictures.phone) ? pictures.phone : null;
  const lost = Boolean((pictures.desktop && !desk) || (pictures.phone && !phone));
  const canAgain = !problem && ready && viewer && viewer.on === true;

  const fail = (where, error) => setFailure({ where, message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) });

  async function again() {
    if (busy) return;
    setBusy("again");
    setFailure(null);
    try {
      await api.post(siteAddress(id, site.ref, "shots"), {});
      view.reload();
    } catch (error) {
      fail("again", error);
    } finally {
      setBusy("");
    }
  }

  async function preview() {
    if (busy) return;
    setBusy("preview");
    setFailure(null);
    setOpened(null);
    try {
      const answer = await api.post(siteAddress(id, site.ref, "preview"), {});
      const url = previewAddress(answer && answer.url);
      if (!url) { setFailure({ where: "preview", message: SITE_WORDS.badAddress, next: "" }); return; }
      setOpened(url);
      if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      fail("preview", error);
    } finally {
      setBusy("");
    }
  }

  // The frame's word in its label, and the button that opens it larger laid over the whole frame, so its own ring
  // is drawn round the frame (site.css); the word stays in the label's flow.
  const opener = (at, url) => {
    const word = at === "desktop" ? SITE_WORDS.desktop : SITE_WORDS.phone;
    const px = at === "desktop" ? "1280 px" : "390 px";
    return html`<span class=${cx("k-site__frame", `k-site__frame--${at}`)}>${url
      ? html`<span class="k-site__word" aria-hidden="true">${word}</span><button type="button" class="k-site__open" onClick=${() => onOpen(at)}
          aria-label=${`${looked}, ${word.toLowerCase()} (${px}): ${SITE_WORDS.open}`}><span class="k-sr">${word}</span></button>`
      : word}</span>`;
  };
  const items = [];
  if (pictures.desktop) items.push({ width: 1280, src: desk, alt: "", label: opener("desktop", desk), pins: pinsFor(finds, page, 1280) });
  if (pictures.phone) items.push({ width: 390, src: phone, alt: "", label: opener("phone", phone), pins: pinsFor(finds, page, 390) });

  const bar = pages.length > 1 || schemes.length > 1 || !problem;
  return html`<div class="k-site__stage">
    ${bar ? html`<${StageBar}>
      ${pages.length > 1 ? html`<${Segmented} label=${SITE_WORDS.whichPage} size="sm" current=${page}
        items=${pages.map((p) => ({ id: p, label: pageWords(p) }))} onChange=${view.setPage} />` : null}
      ${schemes.length > 1 ? html`<${Segmented} label=${SITE_WORDS.whichLook} size="sm" current=${scheme}
        items=${[{ id: "light", label: SITE_WORDS.lightPage, icon: "sun" }, { id: "dark", label: SITE_WORDS.darkPage, icon: "moon" }]} onChange=${view.setScheme} />` : null}
      <span class="k-stagebar__gap"></span>
      ${canAgain ? html`<${Button} class="k-site__tool" variant="ghost" size="sm" icon="camera" aria-label=${SITE_WORDS.again} title=${SITE_WORDS.again}
        busy=${busy === "again"} disabled=${Boolean(busy) && busy !== "again"} onClick=${again}>${SITE_WORDS.again}<//>` : null}
      ${problem ? null : html`<${Button} class="k-site__tool" variant="ghost" size="sm" icon="download" aria-label=${SITE_WORDS.zip} title=${SITE_WORDS.zip}
        href=${siteAddress(id, site.ref, "zip")} download="" />`}
      ${problem ? null : html`<${Button} class="k-site__tool" size="sm" icon="external" aria-label=${SITE_WORDS.preview}
        busy=${busy === "preview"} disabled=${Boolean(busy) && busy !== "preview"} onClick=${preview}>${SITE_WORDS.preview}<//>`}
    <//>` : null}
    ${opened ? html`<p class="k-site__opened" role="status"><${Icon} name="check" size=${14} />
      <span>${SITE_WORDS.opened} <a class="k-site__link" href=${opened} target="_blank" rel="noopener noreferrer">${SITE_WORDS.openHere}</a></span></p>` : null}
    ${failure ? html`<${Failed} failure=${failure} />` : null}
    ${items.length && !problem
      ? html`
        ${line ? html`<${NoPictures} line=${line} busy=${busy === "again"} onAgain=${again} inline />` : null}
        ${lost ? html`<${Notice} tone="bad">${SITE_WORDS.notLoaded}<//>` : null}
        <div class="k-site__frames" onErrorCapture=${view.lost}>
          <${Frames} items=${items} selected=${finding} onPin=${view.setFinding} />
        </div>`
      : html`<${NoPictures} line=${line} problem=${problem} busy=${busy === "again"} onAgain=${again} />`}
    ${left.length ? html`<div class="k-site__left" role="group" aria-label="Files left out of the site">
      <${Notice} tone="warn">${left.map((l, i) => html`<p key=${i}>${l}</p>`)}<//>
    </div>` : null}
  </div>`;
}

// SiteStrip({ view, scores, label }): one card per version; choosing one shows it on the stage. `scores` (optional)
// is the Art director's review per version, keyed by its letter ("a") or its ref: { total, meets, reason }.
// Nothing for a single site.
export function SiteStrip({ view, scores = null, label = SITE_WORDS.versions }) {
  if (!view || !view.site || view.sites.length < 2) return null;
  return html`<div class="k-site__strip" onErrorCapture=${view.lost}>
    <${Strip} label=${label}>
      ${view.sites.map((s) => {
        const n = siteName(s);
        const images = obj(s.shots) ? s.shots.images : [];
        const first = pagesOfSite(s)[0];
        const kept = first ? picturesOf(images, first, "light").desktop : null;
        const thumb = kept && !view.broken.includes(kept) ? kept : null;
        const review = obj(scores) ? scores[s.variant] || scores[s.ref] : null;
        const sc = scoreLine(review);
        const found = findsOf(s).length;
        const ready = obj(s.shots) && s.shots.state === "ready";
        const state = sc ? sc.state
          : ready ? (found ? { tone: "warn", text: `${count(found, "thing")} to look at` } : { tone: "good", icon: "check", text: SITE_WORDS.fine })
            : null;
        return html`<${OptionCard} key=${s.ref} checked=${s.ref === view.site.ref} onPick=${() => view.choose(s.ref)}
          title=${n.letter ? `${n.letter} · ${n.title}` : n.title} amount=${sc ? sc.total : undefined}
          sub=${sc ? undefined : sizeWords(s)} state=${state} say=${sc && sc.reason ? sc.reason : undefined}
          boards=${[{ src: thumb, alt: "" }]} />`;
      })}
    <//>
  </div>`;
}

// SiteRail({ view, children }): what the page viewer found (one numbered row per report line, naming its page;
// choosing one shows that page; four, then "Show all"), the brand check as the server sent it, then the folds, closed:
// the caller's (`children`: the Art director's scores) and the pictures' facts (when they were taken, the fonts, the
// size).
export function SiteRail({ view, children }) {
  if (!view || !view.site) return null;
  const { site, finds, finding, pages } = view;
  const shots = obj(site.shots) ? site.shots : {};
  const reports = reportLayout(site);
  const fine = !finds.length && reports.some((r) => r.fine);
  const drawn = [...new Set(reports.map((r) => r.drawn).filter(Boolean))];
  const brand = obj(site.brand) ? list(site.brand.lines).map((l) => plain(l, 300)).filter(Boolean).slice(0, 6) : [];
  const ready = shots.state === "ready";
  const size = `${sizeWords(site)}${pages.length ? `, ${count(pages.length, "page")}` : ""}`;
  return html`<div class="k-site__rail">
    ${finds.length || fine
      ? html`<${Blk} title=${finds.length ? foundWords(finds.length, site) : SITE_WORDS.found}>
          ${finds.length
            ? html`<${Finds} selected=${finding} onSelect=${view.setFinding} limit=${FIRST_FINDS} more=${`${SITE_WORDS.showAll} ${finds.length}`}
                items=${finds.map((f) => findItem(f, view.page))} />`
            : html`<p class="k-site__fine"><${Icon} name="check" size=${16} /><span>${SITE_WORDS.nothing}</span></p>`}
        <//>`
      : null}
    ${brand.length
      ? html`<${Blk} title=${SITE_WORDS.brand}>
          ${brand.map((l, i) => html`<p key=${i} class="k-say k-site__brand">${l}</p>`)}
        <//>`
      : null}
    <div class="k-site__folds">
      ${children}
      <${SiteFold} title=${SITE_WORDS.pictures} aside=${size}>
        ${[
          ready && shots.taken ? html`<p key="taken" class="k-say">${SITE_WORDS.taken} <${Time} at=${shots.taken} /> ${SITE_WORDS.where}</p>` : null,
          ...drawn.map((d) => html`<p key=${d} class="k-say k-site__drawn">${d}</p>`),
        ]}
      <//>
    </div>
  </div>`;
}

// SiteView({ id, stamp, htmlId }) on a page with no stage: the three pieces stacked in one column. Nothing for a task
// with no sites.
export function SiteView({ id, stamp = "", htmlId = "p-task-sites" }) {
  const view = useSiteView({ id, stamp });
  if (!view.site) return null;
  return html`<section class="k-site" id=${htmlId} tabindex="-1" aria-labelledby=${`${htmlId}-h`}>
    <div class="k-site__top">
      <h2 class="k-site__title" id=${`${htmlId}-h`}>${view.many ? SITE_WORDS.titleMany : SITE_WORDS.title}</h2>
      <p class="k-site__lead">${SITE_WORDS.lead}</p>
    </div>
    <div class="k-site__on-stage" role="group" aria-label=${stageLabel(view.site)}><${SiteStage} view=${view} /></div>
    <${SiteStrip} view=${view} />
    <${SiteRail} view=${view} />
  </section>`;
}
