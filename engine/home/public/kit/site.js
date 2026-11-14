// SiteView (PLAN-V5 K15's owner part, K16, T54): a site an agent built for a task, as the owner sees it on the task's
// page. Per site (versions a to c, or the one): the home server's own pictures of each page at desktop and phone
// width side by side (light; "Dark" when the page has a dark look too), each opening larger; what the page viewer
// found, page by page, in the home server's sentences; "Take pictures again"; "Open the preview" (the site loaded
// into the owner's preview, opened in a new tab with noopener and noreferrer, only at the preview's own address
// on 127.0.0.1); "Download as a zip". From GET /api/tasks/:id/sites (routes/sites.mjs, T52).
// Everything here came from an agent's folder or from the home server's reading of it: a direction's title, a page's
// name, a report line and a left-out file's name are text nodes, capped; a picture comes only from the exact
// /api/sites/shot/<64 hex>/<shot name> address (C21); nothing is ever set as HTML.
// ShotPair (the two frames) is also used by Settings for the page viewer's Test pictures.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { bytes, count } from "../lib/format.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Dialog } from "./overlays.js";
import { Segmented } from "./segmented.js";
import { StatusDot } from "./status.js";
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
};

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
  return p.replace(/\.html$/, "") || "A page";
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

// ---- Parts ----

// One picture in a frame drawn like the screen it was taken on: a browser window for the desktop, a phone for the
// phone. The frame shows the top of the page, as the screen would; pressing it opens the whole page larger.
function Frame({ url, at, label, onOpen }) {
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

// The desktop and the phone picture of one page side by side, each opening larger in a dialog where the whole page
// scrolls. `small` is the Settings Test's size. `label` names what the pictures are of (built here, plain text).
export function ShotPair({ desktop = null, phone = null, label = "The page", small = false }) {
  const [open, setOpen] = useState(null);
  const d = shotUrl(desktop);
  const p = shotUrl(phone);
  if (!d && !p) return null;
  const shown = open === "phone" ? p : open === "desktop" ? d : null;
  const both = Boolean(d && p);
  return html`<div class=${cx("k-site__pair", small && "k-site__pair--small")}>
    <${Frame} url=${d} at="desktop" label=${label} onOpen=${() => setOpen("desktop")} />
    <${Frame} url=${p} at="phone" label=${label} onOpen=${() => setOpen("phone")} />
    <${Dialog} open=${Boolean(shown)} size="lg" onClose=${() => setOpen(null)}
      title=${`${label}: ${open === "phone" ? "phone, 390 px" : "desktop, 1280 px"}`}
      footer=${both ? html`<${Segmented} label="Which picture" size="sm" current=${open}
        items=${[{ id: "desktop", label: SITE_WORDS.desktop }, { id: "phone", label: SITE_WORDS.phone }]} onChange=${setOpen} />` : null}>
      <figure class=${cx("k-site__large", open === "phone" && "k-site__large--phone")}>
        <img src=${shown} alt=${`${label}, the whole page at ${open === "phone" ? "phone" : "desktop"} width`} decoding="async" />
      </figure>
    <//>
  </div>`;
}

// A sentence that may end in "Switch it on in Settings.", that ending a link to Settings.
function WithSettings({ sentence }) {
  const s = settingsSplit(sentence);
  if (!s.link) return html`<span>${s.before}</span>`;
  return html`<span>${s.before} <a class="k-site__link" href="#/settings">${s.link}</a></span>`;
}

// What the page viewer found on one page: what to fix, or that nothing was found, then the faces it was drawn with.
function Report({ report, many }) {
  const n = report.lines.length;
  return html`<section class="k-site__report" aria-label=${many ? `${SITE_WORDS.found}: ${pageWords(report.page)}` : SITE_WORDS.found}>
    <h4 class="k-site__report-title">${SITE_WORDS.found}${n ? html`<span class="k-site__report-n">${count(n, "thing")} to look at</span>` : null}</h4>
    ${n
      ? html`<ul class="k-site__lines">
          ${report.lines.map((l, i) => html`<li key=${i} class=${cx("k-site__line", `k-site__line--${l.tone}`)}>
            <${Icon} name="alert" size=${14} /><span>${l.text}</span>
          </li>`)}
        </ul>`
      : report.fine
        ? html`<p class="k-site__fine"><${Icon} name="check" size=${14} /><span>${SITE_WORDS.nothing}</span></p>`
        : null}
    ${report.drawn ? html`<p class="k-site__drawn">${report.drawn}</p>` : null}
  </section>`;
}

// The state of the pictures when they are not simply there: being taken, the viewer off, failed, none yet.
function StateRow({ line, busy, onAgain }) {
  if (!line) return null;
  if (line.state === "working") {
    return html`<p class="k-site__state k-site__state--live" role="status"><${StatusDot} tone="live" label=${line.sentence} /></p>`;
  }
  return html`<div class=${cx("k-site__state", `k-site__state--${line.state}`)} role=${line.state === "failed" ? "alert" : undefined}>
    <${Icon} name=${line.state === "failed" ? "alert" : "image"} size=${16} />
    <p class="k-site__state-words"><${WithSettings} sentence=${line.sentence} /></p>
    ${line.retry ? html`<${Button} size="sm" icon="loop" busy=${busy} onClick=${onAgain}>${line.retry}<//>` : null}
  </div>`;
}

// A failed action's sentence, the server's own: "… Run: engine start" sets the command apart.
function Failed({ failure }) {
  if (!failure) return null;
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(failure.message);
  return html`<p class="k-site__failed" role="alert"><${Icon} name="alert" size=${14} />
    ${m ? html`<span>${m[1]} <code class="k-next__command">${m[2]}</code></span>` : html`<span><${WithSettings} sentence=${failure.message} /></span>`}
  </p>`;
}

// One site: its name and size, its two actions, the state of its pictures, the pictures of the chosen page in the
// chosen look, what the viewer found there, and the files left out.
function SitePanel({ id, site, viewer, headLevel, onReload }) {
  const [page, setPage] = useState(null);
  const [scheme, setScheme] = useState("light");
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [opened, setOpened] = useState(null);
  const [headId] = useState(() => nextId("k-site"));
  const name = siteName(site);
  const shots = obj(site.shots) ? site.shots : {};
  const images = list(shots.images);
  const pages = pagesOfSite(site);
  const shownPage = pages.includes(page) ? page : pages[0] || null;
  const schemes = schemesOf(images);
  const look = schemes.includes(scheme) ? scheme : "light";
  const pics = shownPage ? picturesOf(images, shownPage, look) : { desktop: null, phone: null };
  const line = stateLine(site, viewer);
  const report = shownPage ? reportOf(site, shownPage) : null;
  const left = leftLines(site.left);
  const problem = plain(site.problem, 300);
  const ready = shots.state === "ready";
  const H = `h${Math.min(Math.max(headLevel, 2), 6)}`;
  const label = pages.length > 1 && shownPage ? `${name.label}, ${pageWords(shownPage)}` : name.label;
  // The row over the pictures: which page, which look, and Take pictures again; drawn only when it holds one of them.
  const tools = pages.length > 1 || schemes.length > 1 || Boolean(ready && viewer && viewer.on);

  const fail = (where, error) => setFailure({ where, message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) });

  async function again() {
    if (busy) return;
    setBusy("again");
    setFailure(null);
    try {
      await api.post(siteAddress(id, site.ref, "shots"), {});
      onReload();
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

  return html`<div class="k-site__panel" role="group" aria-labelledby=${headId}>
    <div class="k-site__head">
      ${name.letter ? html`<span class="k-site__letter" aria-hidden="true">${name.letter}</span>` : null}
      <div class="k-site__names">
        <${H} class="k-site__name" id=${headId}>${name.letter ? html`<span class="k-sr">Version ${name.letter}: </span>` : null}${name.title}<//>
        <p class="k-site__meta">
          <span>${sizeWords(site)}</span>
          ${pages.length ? html`<span>${count(pages.length, "page")}</span>` : null}
          ${ready && shots.taken ? html`<span>Pictures taken <${Time} at=${shots.taken} /></span>` : null}
        </p>
      </div>
      ${problem ? null : html`<div class="k-site__actions">
        <${Button} icon="external" busy=${busy === "preview"} disabled=${Boolean(busy) && busy !== "preview"} onClick=${preview}>${SITE_WORDS.preview}<//>
        <${Button} variant="quiet" icon="download" href=${siteAddress(id, site.ref, "zip")} download="">${SITE_WORDS.zip}<//>
      </div>`}
    </div>
    ${opened ? html`<p class="k-site__opened" role="status"><${Icon} name="check" size=${14} />
      <span>${SITE_WORDS.opened} <a class="k-site__link" href=${opened} target="_blank" rel="noopener noreferrer">${SITE_WORDS.openHere}</a></span></p>` : null}
    ${failure && failure.where === "preview" ? html`<${Failed} failure=${failure} />` : null}
    ${problem ? html`<div class="k-site__state k-site__state--failed" role="alert"><${Icon} name="alert" size=${16} /><p class="k-site__state-words">${problem}</p></div>` : null}
    ${problem ? null : html`<${StateRow} line=${line} busy=${busy === "again"} onAgain=${again} />`}
    ${failure && failure.where === "again" ? html`<${Failed} failure=${failure} />` : null}
    ${pics.desktop || pics.phone ? html`
      ${tools ? html`<div class="k-site__tools">
        ${pages.length > 1 ? html`<${Segmented} label="Which page" size="sm" current=${shownPage}
          items=${pages.map((p) => ({ id: p, label: pageWords(p) }))} onChange=${setPage} />` : null}
        ${schemes.length > 1 ? html`<${Segmented} label="Light or dark" size="sm" current=${look}
          items=${[{ id: "light", label: SITE_WORDS.light, icon: "sun" }, { id: "dark", label: SITE_WORDS.dark, icon: "moon" }]} onChange=${setScheme} />` : null}
        ${ready && viewer && viewer.on ? html`<${Button} class="k-site__again" variant="quiet" size="sm" icon="loop" busy=${busy === "again"}
          disabled=${Boolean(busy) && busy !== "again"} onClick=${again}>${SITE_WORDS.again}<//>` : null}
      </div>` : null}
      <${ShotPair} desktop=${pics.desktop} phone=${pics.phone} label=${look === "dark" ? `${label}, dark` : label} />` : null}
    ${report && (report.lines.length || report.fine || report.drawn) ? html`<${Report} report=${report} many=${pages.length > 1} />` : null}
    ${left.length ? html`<ul class="k-site__left" aria-label="Files left out of the site">
      ${left.map((l, i) => html`<li key=${i}><${Icon} name="file" size=${14} /><span>${l}</span></li>`)}
    </ul>` : null}
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

// SiteView({ id, stamp, htmlId }) on a task's page: nothing for a task with no sites. With versions, one at a time
// behind a lettered switch, in a to c order as the server lists them.
export function SiteView({ id, stamp = "", htmlId = "p-task-sites" }) {
  const { data, reload } = useSites(id, stamp);
  const [current, setCurrent] = useState(null);
  const sites = sitesOf(data);
  if (!sites.length) return null;
  const viewer = obj(data.viewer) ? data.viewer : { on: false, state: "off" };
  const site = sites.find((s) => s.ref === current) || sites[0];
  const many = sites.length > 1;
  const items = sites.map((s) => {
    const n = siteName(s);
    return { id: s.ref, label: n.letter ? html`<span class="k-site__ver-letter">${n.letter}</span><span class="k-site__ver-name">${n.title}</span>` : n.title };
  });
  return html`<section class="k-site" id=${htmlId} tabindex="-1" aria-labelledby=${`${htmlId}-h`}>
    <div class="k-site__top">
      <h2 class="k-site__title" id=${`${htmlId}-h`}>${many ? SITE_WORDS.titleMany : SITE_WORDS.title}</h2>
      <p class="k-site__lead">${SITE_WORDS.lead}</p>
    </div>
    ${many ? html`<div class="k-site__versions"><${Segmented} label="Versions" current=${site.ref} items=${items} onChange=${setCurrent} /></div>` : null}
    <${SitePanel} key=${site.ref} id=${id} site=${site} viewer=${viewer} headLevel=${3} onReload=${reload} />
  </section>`;
}
