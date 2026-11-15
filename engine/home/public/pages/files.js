// Files: the company brain (CONTRACTS-V3 30, 32, 33.6): the documents every agent reads before it works.
// PLAN-COOK T68 (R09 leads, R02 for an opened file): the kit's DocLayout, whose list of sections is the brain's
// places (all files, the brand kit, each folder with its count, what is shared with the Researcher, what agents
// learned; the current one lifted), and at the right the set: the title, one grey line, a toolbar (the view switch
// and sort at the left, the search field at the far right), a count line, then the files as rows (the default) or
// cards. Below 1100 px the places are one filter menu in the toolbar. An opened file (`?file=`) is read in place:
// a reading column (a Markdown file through the kit's DocView) with its facts, the Researcher switch and its
// actions in a rail. Adding a file (`?new=`) and the readiness panel are brain/new-file.js and brain/readiness.js;
// until they are built the page says so.
// Every name and every word of a file is shown as text, never as HTML. A picture is shown only from its own raw address.
// A text or table file can be marked as fine to share with the Researcher (PLAN-V5 K10, T35): the switch sits in the
// file's rail, and `?shared=1` lists what the Researcher can read.
// Fix round R5 (R5-H): a row's tile is the kit's Tile in the quiet tint the kit gives the file's kind (identity, never
// a state); the size short ("250 B") and the time in one right-hand group; every block of the set in one 760 px
// column; a place's count stands beside its name.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { go } from "../lib/router.js";
import { bytes, count, fullWhen, when } from "../lib/format.js";
import { useApp } from "../lib/context.js";
import {
  BeingBuilt, Blk, Button, DataTable, Dialog, DocLayout, DocView, Empty, ErrorNotice, Field, Group, Icon, Loading,
  Card, FILE_ICONS, fileKind, Menu, PageHeader, Row, Rows, Segmented, Select, Switch, Tag, TextInput, Tile, Time, tintFor,
} from "../kit/index.js";

const EVERY = 10000;
const NAME_MAX = 100;
const SNIPPET_MAX = 300;
const LESSON_MAX = 300;
const ID = /^[a-z][a-z0-9-]{0,40}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,700}$/;
// The folders' titles of CONTRACTS-V3 32.1, for while /api/brain has not answered.
const FOLDER_TITLES = {
  company: "Company basics", brand: "Brand", pricing: "Prices and services", policies: "Policies", people: "People",
  customers: "Customers", calls: "Calls and meetings", references: "References", packs: "Packs", loose: "Loose files",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const cut = (v, n) => str(v).slice(0, n);
// Go to an address in place of this one, so Back does not land on an address that sends the owner on again.
const redirect = (href) => { try { location.replace(href); } catch { go(href); } };

// The modules of M29, loaded when they exist: [path from this file, export name]. The Brand kit (PLAN-V5 T14) is
// its own page at #/files/brand-kit, handed over from here so the route table stays as it is.
const BRAIN_PARTS = {
  newFile: ["../brain/new-file.js", "NewFile"],
  readiness: ["../brain/readiness.js", "Readiness"],
  brandKit: ["./brand-kit.js", "default"],
};
export const BRAND_KIT_HREF = "#/files/brand-kit";
export const BRAND_KIT_WORDS = "your colours, type, logo, voice and examples. Agents' tools obey it.";

// True when the address is the Brand kit's (#/files/brand-kit), which is not a folder.
export const isBrandKit = (parts) => Array.isArray(parts) && parts.length === 2 && parts[0] === "files" && parts[1] === "brand-kit";

// The brand form is replaced by the Brand kit: `?new=form:brand` and a brand file not there yet lead to it.
export const formLeadsToKit = (form) => form === "brand";

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/files.test.mjs)

// The address of a state of this page: #/files, #/files/<folder>, with ?file=, ?q=, ?tab=lessons, ?new=, ?shared=1.
export function filesHref({ folder, file, q, tab, mode, shared } = {}) {
  const f = ID.test(str(folder)) ? `/${folder}` : "";
  const qs = new URLSearchParams();
  if (TOKEN.test(str(file))) qs.set("file", file);
  if (str(q).trim()) qs.set("q", str(q).trim().slice(0, 200));
  if (tab === "lessons") qs.set("tab", "lessons");
  if (newMode(mode)) qs.set("new", mode);
  if (shared === true && !f) qs.set("shared", "1");
  const s = qs.toString();
  return `#/files${f}${s ? `?${s}` : ""}`;
}

// What `?new=` asks for: { mode: "paste" | "upload" } or { mode: "form", form: <id> }; null for anything else.
export function newMode(value) {
  const v = str(value);
  if (v === "paste" || v === "upload") return { mode: v };
  const m = /^form:([a-z][a-z0-9-]{0,40})$/.exec(v);
  return m ? { mode: "form", form: m[1] } : null;
}

// The same hash with one key of its query taken out ("#/files/brand?file=x&q=y", "file" → "#/files/brand?q=y").
export function withoutKey(hash, key) {
  const raw = str(hash);
  const at = raw.indexOf("?");
  if (at < 0) return raw;
  const qs = new URLSearchParams(raw.slice(at + 1));
  qs.delete(key);
  const s = qs.toString();
  return `${raw.slice(0, at)}${s ? `?${s}` : ""}`;
}

// The brain path a token names ("cmVmZXJlbmNlcy8" → "references/"), or "" when it is not base64url of UTF-8 text.
export function tokenPath(token) {
  const t = str(token);
  if (!TOKEN.test(t)) return "";
  try {
    const b64 = t.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

// Where a `?file=` token should lead: a folder's token ('<folder>/') opens that folder; a basic that does not exist
// yet (or, with `missingOnly` false, any basic) opens its form; anything else opens the file in the work panel.
// Returns { to: "folder" | "form", href } or { to: "file" }.
export function fileTarget(token, brain, { missingOnly = true } = {}) {
  const path = tokenPath(token);
  const dir = /^([a-z][a-z0-9-]{0,40})\/$/.exec(path);
  if (dir) return { to: "folder", href: filesHref({ folder: dir[1] }) };
  const items = arr(brain && brain.basics && brain.basics.items);
  const item = items.find((b) => b && ID.test(str(b.form)) && ((str(b.token) && b.token === token) || (path && str(b.file) === path)));
  if (item && (!missingOnly || item.state === "missing")) {
    if (formLeadsToKit(item.form)) return { to: "form", href: BRAND_KIT_HREF };
    const folder = str(item.file).split("/")[0];
    return { to: "form", href: filesHref({ folder: ID.test(folder) ? folder : "", mode: `form:${item.form}` }) };
  }
  return { to: "file" };
}

// The kind of a file in words.
export function kindLabel(kind) {
  return { text: "Text", table: "Table", image: "Picture", pdf: "PDF" }[kind] || "File";
}

const ICONS = { text: "file", table: "list", image: "image", pdf: "file" };

// The kit's glyph for a file, from its name's ending (the same glyphs a task's files carry).
export const glyphOf = (file) => FILE_ICONS[fileKind(str(file && file.name))] || FILE_ICONS.file;

// A file's size, short, for a row or a card: "250 B" under a kilobyte, else as the kit writes it ("1.2 KB"). The
// number is the server's; only the unit's word is shortened. Pure.
export function sizeShort(n) {
  const v = Number(n) || 0;
  return v < 1024 ? `${v} B` : bytes(v);
}

// The tint of a file's tile: the kit's tint for its kind (from the name's ending; a picture is a picture), the same
// tint for the same kind everywhere. Pure.
export const tintOf = (file) => tintFor(file && file.kind === "image" ? "picture" : fileKind(str(file && file.name)));

// How long ago, for a row's time column: "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the
// date as the kit writes it. "" for no time. The full time stays on the element's title.
export function ago(iso, now = new Date()) {
  const t = Date.parse(str(iso));
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now.getTime() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return when(iso, now);
}

// The second line of a file's row, from what /api/brain already says of it (it sends no heading or first words, so
// none is drawn): the basic it holds when it came from a form ("About the company"), then its place when the list
// mixes places ("Company basics"). "" when there is nothing to add.
export function rowLine(file, brain, { inFolder = false } = {}) {
  if (!file || typeof file !== "object") return "";
  const items = arr(brain && brain.basics && brain.basics.items);
  const basic = items.find((b) => b && ((str(file.form) && b.form === file.form) || (str(file.path) && b.file === file.path)));
  const folder = arr(brain && brain.folders).find((f) => f && f.id === file.folder);
  const place = inFolder ? "" : cut(folder && folder.title, 60) || FOLDER_TITLES[file.folder] || "";
  const title = cut(basic && basic.title, 80);
  return [title, place].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ");
}

// How a file is shown: "text", "table", "image" (only with a raw address of the brain's own), "pdf", else "none".
export function viewOf(file) {
  const kind = file && file.kind;
  if (kind === "text" || kind === "table" || kind === "pdf") return kind;
  if (kind === "image" && safeBrainUrl(file.rawUrl)) return "image";
  return "none";
}

// An address of the brain's own raw files, or null: nothing that leaves /api/brain/raw/ is ever put in a page.
export function safeBrainUrl(url) {
  const u = str(url);
  return /^\/api\/brain\/raw\/[A-Za-z0-9_-]{1,700}(\?download=1)?$/.test(u) ? u : null;
}

// The files in the order the owner chose: "name" (A to Z) or "date" (newest first, the default).
export function sortFiles(files, by = "date") {
  const list = arr(files).filter((f) => f && typeof f === "object");
  const stamp = (f) => {
    const t = Date.parse(f.changedAt || f.addedAt || "");
    return Number.isFinite(t) ? t : 0;
  };
  const name = (f) => str(f.name).toLowerCase();
  return [...list].sort((a, b) => (by === "name"
    ? name(a).localeCompare(name(b)) || stamp(b) - stamp(a)
    : stamp(b) - stamp(a) || name(a).localeCompare(name(b))));
}

// "4 of 9 basics filled", from the `brain` shape.
export function basicsLine(brain) {
  const b = brain && brain.basics;
  const filled = b && Number.isFinite(b.filled) ? Math.max(0, Math.round(b.filled)) : 0;
  const total = b && Number.isFinite(b.total) ? Math.max(0, Math.round(b.total)) : 9;
  return `${filled} of ${total} basics filled`;
}

// A small CSV reader: quotes, commas and line breaks inside quotes, "" for a quote; at most `maxRows` rows of at most
// `maxCols` cells of at most `maxCell` characters. Runs in one pass over the text and never throws.
// Returns { rows: [[cell]], moreRows, moreCols }.
export function readCsv(text, { maxRows = 200, maxCols = 30, maxCell = 500 } = {}) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  let moreRows = false;
  let moreCols = false;
  const add = (c) => { if (cell.length < maxCell) cell += c; };
  const endCell = () => {
    if (row.length < maxCols) row.push(cell);
    else moreCols = true;
    cell = "";
  };
  const endRow = () => {
    const blank = row.length === 0 && cell === "" && !wasQuoted;
    endCell();
    wasQuoted = false;
    if (!blank) {
      if (rows.length < maxRows) rows.push(row);
      else moreRows = true;
    }
    row = [];
  };
  for (let i = 0; i < s.length && !moreRows; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { add('"'); i++; } else quoted = false;
      } else add(c);
    } else if (c === '"' && cell === "") {
      quoted = true;
      wasQuoted = true;
    } else if (c === ",") {
      endCell();
      wasQuoted = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRow();
    } else add(c);
  }
  if (!moreRows && (cell !== "" || row.length || wasQuoted)) endRow();
  return { rows, moreRows, moreCols };
}

// The rows of a CSV as a DataTable: the first row names the columns.
export function tableOf(rows) {
  const list = arr(rows);
  const width = list.reduce((n, r) => Math.max(n, arr(r).length), 0);
  const head = arr(list[0]);
  const columns = Array.from({ length: width }, (_, i) => ({ key: `c${i}`, label: str(head[i]).trim() || `Column ${i + 1}` }));
  const body = list.slice(1).map((r, n) => {
    const o = { id: n };
    columns.forEach((c, i) => { o[c.key] = str(arr(r)[i]); });
    return o;
  });
  return { columns, rows: body };
}

// The folders a file can be moved to: every folder but its own, as Select options.
export function moveOptions(folders, current) {
  return arr(folders)
    .filter((f) => f && ID.test(str(f.id)) && f.id !== current)
    .map((f) => ({ value: f.id, label: cut(f.title, 60) || f.id }));
}

// What Move and Delete send: the file's version always goes with them.
export function moveBody(file, folder) {
  return { token: str(file && file.token), folder: str(folder), version: str(file && file.version) };
}
export function deleteUrl(file) {
  return `/api/brain/file/${encodeURIComponent(str(file && file.token))}?version=${encodeURIComponent(str(file && file.version))}`;
}

// The sentence to show when an action failed: the server's own words (a 409 says why), else a plain one.
export function refusal(error, fallback = "That did not work. Try again.") {
  const m = error && typeof error.message === "string" ? error.message.trim() : "";
  return m ? m.slice(0, 300) : fallback;
}

// A lesson line "2026-11-09: text" as { date: "9 Nov 2026", text }; a line with no date keeps its words as they are.
export function splitLesson(line) {
  const s = String(line ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2}):\s*(.*)$/s.exec(s);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return { date: "", text: s };
  return { date: `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`, text: m[4] };
}

// What the Researcher may read (PLAN-V5 K10, T35). Only text and table files can be shared; the list comes from
// /api/web, where `source` is "brand-kit" (the brand's public summary), "brain" (a file of yours) or "other".
export const SHARE_WORDS = {
  label: "Fine to share with the Researcher",
  explain: "The Researcher reads nothing else of your files. Switch it off to take this file back.",
  title: "Shared with the Researcher",
  lead: "The Researcher can read these and its own task, nothing else of yours.",
  none: "Nothing is shared yet.",
  noneHow: "Open a text or table file and switch on \"Fine to share with the Researcher\".",
  restart: "This list appears after the home screen is restarted: engine stop, then engine start.",
};
export const SOURCE_WORDS = { "brand-kit": "From the brand kit", brain: "From your files", other: "Put there another way" };
export const canShare = (file) => Boolean(file) && (file.kind === "text" || file.kind === "table");
export const sharedLine = (n) => `Shared with the Researcher: ${count(Math.max(0, Math.round(Number(n)) || 0), "file")}`;
export const sharedFiles = (view) => arr(view && view.shared)
  .filter((f) => f && typeof f === "object" && typeof f.name === "string" && Object.hasOwn(SOURCE_WORDS, f.source));
export const isShared = (view, token) => TOKEN.test(str(token)) && sharedFiles(view).some((f) => f.source === "brain" && f.token === token);
// Where a shared file leads: the brand kit, the file in its panel over the list, or nowhere.
export function sharedHref(f) {
  if (f && f.source === "brand-kit") return BRAND_KIT_HREF;
  if (f && f.source === "brain" && TOKEN.test(str(f.token))) return filesHref({ file: f.token, shared: true });
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The parts M29 builds, loaded by address when they exist (a module that is not there yet is not an error).

function useBrainPart(key) {
  const [part, setPart] = useState({ state: "loading", C: null });
  useEffect(() => {
    let live = true;
    const [path, name] = BRAIN_PARTS[key];
    import(new URL(path, import.meta.url).href)
      .then((m) => (m && typeof m[name] === "function" ? m[name] : null))
      .catch(() => null)
      .then((C) => { if (live) setPart({ state: C ? "ready" : "missing", C }); });
    return () => { live = false; };
  }, [key]);
  return part;
}

// The page's own words (PLAN-COOK T68), pinned by test/pages/files.test.mjs.
export const FILES_WORDS = {
  title: "Files",
  lead: "Your company's own files. Every agent reads them before it works.",
  all: "All files",
  brandKit: "Brand kit",
  lessons: "What agents learned",
  lessonsLead: "When an agent learns something from your answers, it shows here.",
  recent: "Recently changed",
  places: "Places",
  search: "Search your files",
  sort: "Sort",
  view: "Show as",
  about: "About this file",
  researcher: "The Researcher",
  written: "Written",
  byForm: "By you, in its form",
  added: "Added",
  changed: "Changed",
  kind: "Kind",
  size: "Size",
  place: "In",
};
const SORTS = [{ id: "date", label: "Newest first" }, { id: "name", label: "Name" }];

// A Markdown file as the kit's document: { sections: [{ heading, text }] }. A `#` or `##` heading starts a section
// (a fence is never split); what comes before the first heading is a section with no heading. Deeper headings stay
// in the text. Nothing is parsed as HTML here; the kit's Markdown builds elements from plain data.
export function docOf(text) {
  const lines = str(text).replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let cur = { heading: "", lines: [] };
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      if (cur.heading || cur.lines.join("").trim()) sections.push(cur);
      cur = { heading: m[1], lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.heading || cur.lines.join("").trim()) sections.push(cur);
  return { sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })) };
}

// True for a Markdown file, which is read as a document; any other text file is shown as it is.
export const isMarkdown = (file) => Boolean(file) && file.kind === "text" && /\.(md|markdown)$/i.test(str(file.name));

// Which place of the list is current: "all", a folder's id, "shared" or "lessons".
export function placeOf({ folder, shared, tab } = {}) {
  if (ID.test(str(folder))) return folder;
  if (shared) return "shared";
  if (tab === "lessons") return "lessons";
  return "all";
}

// The places of the brain, in order: [{ id, label, icon, count, href }]. A count is null when it is not known.
export function placesOf(brain, { shared = null } = {}) {
  const folders = arr(brain && brain.folders).filter((f) => f && ID.test(str(f.id)));
  const total = brain && brain.totals && Number.isFinite(brain.totals.files) ? Math.max(0, Math.round(brain.totals.files)) : null;
  const list = [{ id: "all", label: FILES_WORDS.all, icon: "files", count: total, href: filesHref({}) }];
  list.push({ id: "brand-kit", label: FILES_WORDS.brandKit, icon: "spark", count: null, href: BRAND_KIT_HREF });
  for (const f of folders) {
    list.push({ id: f.id, label: cut(f.title, 60) || FOLDER_TITLES[f.id] || f.id, icon: "folder",
      count: Number.isFinite(Number(f.files)) ? Math.max(0, Math.round(Number(f.files))) : null, href: filesHref({ folder: f.id }) });
  }
  list.push({ id: "shared", label: SHARE_WORDS.title, icon: "lock", count: Number.isFinite(shared) ? shared : null, href: filesHref({ shared: true }) });
  list.push({ id: "lessons", label: FILES_WORDS.lessons, icon: "bulb", count: null, href: filesHref({ tab: "lessons" }) });
  return list;
}

// ---------------------------------------------------------------------------------------------------------------
// One file, read in place

// The owner's switch for one text or table file. Drawn only once /api/web has answered (before the home screen is
// restarted it has no such route, and nothing is shown).
function ShareSwitch({ file }) {
  const { announce } = useApp();
  const res = useResource("/api/web");
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const view = fresh || res.data;
  if (!canShare(file) || !TOKEN.test(str(file.token)) || !view) return null;
  const change = async (next) => {
    setBusy(true);
    setMessage("");
    try {
      setFresh(await api.post("/api/web/share", { token: file.token, share: next }));
      announce && announce(next ? "Shared with the Researcher." : "No longer shared with the Researcher.");
    } catch (e) {
      setMessage(refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return html`<${Blk} title=${FILES_WORDS.researcher}>
    <div class="p-files__share">
      <${Switch} on=${isShared(view, file.token)} disabled=${busy} label=${SHARE_WORDS.label} explain=${SHARE_WORDS.explain} onChange=${change} />
      ${message ? html`<p class="p-files__refusal" role="alert">${message}</p>` : null}
    </div>
  <//>`;
}

function FileBody({ data }) {
  const file = data.file || {};
  const how = viewOf(file);
  const download = safeBrainUrl(file.downloadUrl);
  if (how === "text" && isMarkdown(file)) {
    return html`<div class="p-files__doc">
      <${DocView} doc=${docOf(data.text)} />
      ${data.truncated ? html`<p class="p-files__caption">Only the start of this long file is shown. Download it to read the rest.</p>` : null}
    </div>`;
  }
  if (how === "text") {
    return html`<div class="p-files__doc">
      <pre class="p-files__text">${str(data.text)}</pre>
      ${data.truncated ? html`<p class="p-files__caption">Only the start of this long file is shown. Download it to read the rest.</p>` : null}
    </div>`;
  }
  if (how === "table") {
    const csv = readCsv(data.text);
    const t = tableOf(csv.rows);
    return html`<div class="p-files__sheet">
      <div class="p-files__table" tabindex="0" role="region" aria-label="The table">
        <${DataTable} columns=${t.columns} rows=${t.rows} emptyText="This table has no rows under its headings." />
      </div>
      ${csv.moreRows || csv.moreCols || data.truncated
        ? html`<p class="p-files__caption">Only the first 200 rows and 30 columns are shown. Download it to see all of it.</p>`
        : null}
    </div>`;
  }
  if (how === "image") {
    return html`<figure class="p-files__picture" data-cook-picture>
      <img src=${safeBrainUrl(file.rawUrl)} alt=${cut(file.name, NAME_MAX)} loading="lazy" decoding="async" />
    </figure>`;
  }
  if (how === "pdf") {
    return html`<div class="p-files__doc p-files__pdf">
      <span class="p-files__pdf-icon"><${Icon} name="file" size=${24} /></span>
      <span class="p-files__pdf-body">
        <strong class="u-wrap">${cut(file.name, NAME_MAX)}</strong>
        <span class="p-files__fact-note">PDF · ${bytes(file.size)}</span>
        <span class="p-files__fact-note">Search does not look inside PDF files.</span>
      </span>
      ${download ? html`<${Button} size="sm" icon="download" href=${download} download=${cut(file.name, NAME_MAX)}>Download<//>` : null}
    </div>`;
  }
  return html`<div class="p-files__doc"><p class="p-files__fact-note">This file cannot be shown here.</p></div>`;
}

function FileActions({ file, folders, onMoved, onDeleted }) {
  const options = moveOptions(folders, file.folder);
  const [to, setTo] = useState(options[0]?.value || "");
  const [moving, setMoving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const move = async () => {
    if (!to) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await api.post("/api/brain/move", moveBody(file, to));
      onMoved(res && res.file);
    } catch (e) {
      setMessage(refusal(e, "The file could not be moved."));
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.del(deleteUrl(file));
      onDeleted(file);
    } catch (e) {
      setMessage(refusal(e, "The file could not be deleted."));
      setBusy(false);
      setAsking(false);
    }
  };

  const download = safeBrainUrl(file.downloadUrl);
  return html`<div class="p-files__actions">
    <div class="p-files__action-row">
      ${file.form && ID.test(str(file.form))
        ? html`<${Button} size="sm" icon="form" href=${filesHref({ folder: file.folder, mode: `form:${file.form}` })}>Edit in its form<//>`
        : null}
      ${download && viewOf(file) !== "pdf" ? html`<${Button} size="sm" icon="download" href=${download} download=${cut(file.name, NAME_MAX)}>Download<//>` : null}
      ${options.length ? html`<${Button} size="sm" icon="folder" aria-expanded=${moving ? "true" : "false"} onClick=${() => setMoving(!moving)}>Move to...<//>` : null}
      ${asking ? null : html`<${Button} size="sm" variant="quiet" onClick=${() => { setAsking(true); setMoving(false); }}>Delete<//>`}
    </div>
    ${moving && !asking
      ? html`<div class="p-files__move">
          <${Field} label="Move it to">
            <${Select} options=${options} value=${to} onChange=${(e) => setTo(e.currentTarget.value)} />
          <//>
          <${Button} size="sm" variant="primary" busy=${busy} onClick=${move}>Move<//>
        </div>`
      : null}
    ${asking
      ? html`<div class="p-files__confirm" role="group" aria-label="Delete this file">
          <span>Delete this file? It cannot be brought back.</span>
          <span class="p-files__action-row">
            <${Button} size="sm" variant="danger" busy=${busy} onClick=${remove}>Delete<//>
            <${Button} size="sm" variant="quiet" onClick=${() => setAsking(false)}>Keep<//>
          </span>
        </div>`
      : null}
    ${message ? html`<p class="p-files__refusal" role="alert">${message}</p>` : null}
  </div>`;
}

// A label and its value, one line of the rail.
function Fact({ label, children }) {
  return html`<div class="p-files__fact"><dt>${label}</dt><dd>${children}</dd></div>`;
}

// `formHref` is set when the token names one of the basics: a basic that is not there yet leads to its form.
// `onName` tells the page the file's name once it is read, for the title.
function FileView({ token, folders, formHref, onMoved, onDeleted, onName }) {
  const res = useResource(`/api/brain/file/${encodeURIComponent(token)}`);
  const notFound = !!(res.error && res.error.code === "file_not_found");
  useEffect(() => { if (notFound && formHref) redirect(formHref); }, [notFound, formHref]);
  const opened = (res.data && res.data.file) || null;
  const name = cut(opened && opened.name, NAME_MAX);
  useEffect(() => { if (onName) onName(name); }, [name]);

  if (res.loading && !res.data) return html`<${Loading} lines=${6} label="Opening the file" />`;
  if (res.error) {
    return notFound && formHref
      ? html`<${Empty} title="This has not been filled in yet."><${Button} href=${formHref} icon="form">Fill it in<//><//>`
      : notFound
      ? html`<${Empty} title="This file is not in your files any more." text="It may have been moved or deleted.">
          <${Button} href="#/files" icon="arrow-left">All files<//>
        <//>`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }
  const file = opened || {};
  const place = folders.find((x) => x && x.id === file.folder);
  const placeTitle = cut(place && place.title, 60) || FOLDER_TITLES[file.folder] || "";
  return html`<div class="p-files__open">
    <article class="p-files__reading" aria-label=${name || "The file"}>
      <${FileBody} data=${res.data} />
    </article>
    <aside class="p-files__rail" aria-label="About this file">
      <${Blk} title=${FILES_WORDS.about}>
        <dl class="p-files__facts">
          <${Fact} label=${FILES_WORDS.kind}><span class="p-files__fact-kind"><${Icon} name=${ICONS[file.kind] || "file"} size=${16} />${kindLabel(file.kind)}</span><//>
          <${Fact} label=${FILES_WORDS.size}><span class="p-files__num">${bytes(file.size)}</span><//>
          ${placeTitle && ID.test(str(file.folder)) ? html`<${Fact} label=${FILES_WORDS.place}><a href=${filesHref({ folder: file.folder })}>${placeTitle}</a><//>` : null}
          ${file.form && ID.test(str(file.form)) ? html`<${Fact} label=${FILES_WORDS.written}>${FILES_WORDS.byForm}<//>` : null}
          ${file.addedAt ? html`<${Fact} label=${FILES_WORDS.added}><${Time} at=${file.addedAt} /><//>` : null}
          ${file.changedAt ? html`<${Fact} label=${FILES_WORDS.changed}><${Time} at=${file.changedAt} /><//>` : null}
        </dl>
      <//>
      <${ShareSwitch} file=${file} />
      <${Blk}>
        <${FileActions} key=${str(file.version)} file=${file} folders=${folders}
          onMoved=${(moved) => onMoved(moved || file)} onDeleted=${onDeleted} />
      <//>
    </aside>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Lists

// The one grey fact of a card: its kind and size.
const factOf = (file) => `${kindLabel(file.kind)} · ${sizeShort(file.size)}`;

// A time as "3 h ago", the full time on hover and for a screen reader's own reading of the element.
function Ago({ at }) {
  const text = ago(at);
  if (!text) return null;
  return html`<time class="p-files__ago" datetime=${new Date(at).toISOString()} title=${fullWhen(at)}>${text}</time>`;
}

// The kit's 28 px Tile with its glyph for the file's kind, in the tint for that kind.
const Glyph = ({ name, tint }) => html`<span class="p-files__row-icon" aria-hidden="true"><${Tile} icon=${name} tint=${tint || "neutral"} /></span>`;

function FileItem({ file, folder, grid, shared, brain }) {
  const name = cut(file.name, NAME_MAX);
  const href = filesHref({ folder, file: file.token, shared });
  const at = file.changedAt || file.addedAt;
  if (grid) {
    // A picture shows itself (from the brain's own raw address, served with a sandbox policy).
    const picture = file.kind === "image" ? safeBrainUrl(file.rawUrl) : null;
    return html`<li class="p-files__tile">
      <a class="p-files__tile-link" href=${href} title=${name}>
        <span class=${`p-files__tile-face${picture ? " p-files__tile-face--picture" : ""}`} aria-hidden="true" data-cook-picture=${picture ? "" : undefined}>
          ${picture
            ? html`<img class="p-files__tile-img" src=${picture} alt="" loading="lazy" decoding="async" />`
            : html`<${Icon} name=${glyphOf(file)} size=${24} />`}
        </span>
        <span class="p-files__tile-name">${name}</span>
        <span class="p-files__tile-foot"><span>${factOf(file)}</span><${Ago} at=${at} /></span>
      </a>
    </li>`;
  }
  const line = rowLine(file, brain, { inFolder: Boolean(folder) });
  return html`<li class="p-files__row">
    <a class="p-files__row-link" href=${href}>
      <${Glyph} name=${glyphOf(file)} tint=${tintOf(file)} />
      <span class="p-files__row-words">
        <span class="p-files__row-name" title=${name}>${name}</span>
        ${line ? html`<span class="p-files__row-line">${line}</span>` : null}
      </span>
      <span class="p-files__row-size">${sizeShort(file.size)}</span>
      <span class="p-files__row-date"><${Ago} at=${at} /></span>
    </a>
  </li>`;
}

// Rows stand on one card; cards stand on the ground.
function FileList({ files, folder, grid, brain }) {
  if (grid) {
    return html`<ul class="p-files__grid">
      ${files.map((f) => html`<${FileItem} key=${f.token} file=${f} folder=${folder} grid=${true} brain=${brain} />`)}
    </ul>`;
  }
  return html`<${Card} padding="none" class="p-files__card">
    <ul class="p-files__rows">
      ${files.map((f) => html`<${FileItem} key=${f.token} file=${f} folder=${folder} brain=${brain} />`)}
    </ul>
  <//>`;
}

function SearchResults({ term, folder }) {
  const res = useResource(term.length >= 2 ? `/api/brain/search?q=${encodeURIComponent(term)}` : null);
  if (term.length < 2) return html`<p class="p-files__count">Type at least two letters.</p>`;
  if (res.loading && !res.data) return html`<${Loading} lines=${2} label="Searching your files" />`;
  if (res.error) return html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  const results = arr(res.data && res.data.results).filter((r) => r && TOKEN.test(str(r.token))).slice(0, 20);
  if (!results.length) {
    return html`<${Empty} title=${`Nothing in your files matches "${cut(term, 80)}".`}>
      <${Button} href=${filesHref({ folder })} variant="quiet">Clear the search<//>
    <//>`;
  }
  return html`<p class="p-files__count">Found in your files: ${count(results.length, "file")}</p>
    <${Card} padding="none" class="p-files__card">
      <ul class="p-files__rows p-files__results">
        ${results.map((r) => html`<li key=${r.token} class="p-files__row">
          <a class="p-files__row-link p-files__result" href=${filesHref({ folder, q: term, file: r.token })}>
            <${Glyph} name=${glyphOf(r)} tint=${tintOf(r)} />
            <span class="p-files__result-words">
              <span class="p-files__row-name">${cut(r.name, NAME_MAX)}</span>
              ${r.snippet ? html`<span class="p-files__result-snippet">${cut(r.snippet, SNIPPET_MAX)}</span>` : null}
            </span>
          </a>
        </li>`)}
      </ul>
    <//>`;
}

function Lessons() {
  const res = useResource("/api/lessons", { every: EVERY });
  const roles = arr(res.data && res.data.roles);
  if (res.loading && !res.data) return html`<${Loading} lines=${3} label="Loading what agents learned" />`;
  if (res.error) return html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  if (!roles.length) return html`<${Empty} title="Nothing learned yet." text="When an agent learns something from your answers, it shows here." />`;
  return html`<div class="p-files__lessons">
    ${roles.map((r) => {
      const lessons = arr(r.lessons).slice(0, 5);
      return html`<${Group} key=${r.slug} title=${cut(r.name, 80)}
          aside=${ID.test(str(r.slug)) ? html`<a href=${`#/team/${r.slug}?tab=lessons`}>Edit</a>` : null}>
        ${lessons.length
          ? html`<${Card} padding="none" class="p-files__card"><ul class="p-files__lesson-list">${lessons.map((l, i) => {
              const { date, text } = splitLesson(cut(String(l ?? ""), LESSON_MAX));
              return html`<li key=${i}><span class="p-files__lesson-text">${text}</span>${date ? html`<span class="p-files__lesson-date">${date}</span>` : null}</li>`;
            })}</ul><//>`
          : html`<p class="p-files__count">Nothing learned yet.</p>`}
      <//>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// All files: the basics, then what changed lately

function BasicsFallback({ brain }) {
  const items = arr(brain && brain.basics && brain.basics.items).filter((b) => b && ID.test(str(b.form)));
  if (!items.length) return null;
  return html`<${Rows}>
    ${items.map((b) => html`<${Row} key=${b.form} icon=${b.state === "filled" ? "check" : "form"} title=${cut(b.title, 80)}
      state=${b.state === "filled" ? { tone: "good", text: "Filled" } : null}
      control=${b.state === "filled" ? null : html`<${Button} size="sm" href=${filesHref({ mode: `form:${b.form}` })}>Fill it in<//>`} />`)}
  <//>`;
}

function ReadinessPanel({ brain }) {
  const part = useBrainPart("readiness");
  if (part.state === "ready") return html`<${part.C} brain=${brain} />`;
  return html`<${Group} title="The basics" aside=${basicsLine(brain)} say="Agents read these before they write anything for you.">
    ${part.state === "missing" ? html`<${BasicsFallback} brain=${brain} />` : html`<${Loading} lines=${3} />`}
  <//>`;
}

// What the Researcher can read: the brand's public summary and every file the owner shared.
function SharedView() {
  const res = useResource("/api/web", { every: EVERY });
  if (res.loading && !res.data) return html`<${Loading} lines=${3} label="Loading what is shared" />`;
  if (res.error && !res.data) {
    return res.error.status === 404
      ? html`<${Empty} title=${SHARE_WORDS.restart} />`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }
  const files = sharedFiles(res.data);
  const t = (res.data && res.data.sharedTotals) || {};
  if (!files.length) return html`<${Empty} title=${SHARE_WORDS.none} text=${SHARE_WORDS.noneHow} />`;
  return html`<p class="p-files__count">
      ${`${count(files.length, "file")} of ${Number(t.maxFiles) || 50}, ${bytes(t.bytes)} of ${bytes(t.maxBytes || 5 * 1024 * 1024)}.`}
    </p>
    <${Card} padding="none" class="p-files__card">
      <ul class="p-files__rows">
        ${files.map((f) => {
          const href = sharedHref(f);
          const inner = html`<${Glyph} name=${f.source === "brand-kit" ? "spark" : glyphOf(f)} tint=${f.source === "brand-kit" ? "neutral" : tintOf(f)} />
            <span class="p-files__row-words">
              <span class="p-files__row-name" title=${cut(f.title || f.name, NAME_MAX)}>${cut(f.title || f.name, NAME_MAX)}</span>
              <span class="p-files__row-line">${SOURCE_WORDS[f.source]}</span>
            </span>
            <span class="p-files__row-size">${sizeShort(f.size)}</span>
            <span class="p-files__row-date"></span>`;
          return html`<li key=${f.name} class="p-files__row">
            ${href
              ? html`<a class="p-files__row-link" href=${href}>${inner}</a>`
              : html`<span class="p-files__row-link">${inner}</span>`}
          </li>`;
        })}
      </ul>
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// One folder

function FolderForms({ forms, folder }) {
  const list = arr(forms).filter((f) => f && ID.test(str(f.id)));
  if (!list.length) return null;
  return html`<${Group} title="Forms for this folder" say="Only you know these facts. Fill them in and agents read them.">
    <${Rows}>
      ${list.map((f) => (formLeadsToKit(f.id)
        ? html`<${Row} key=${f.id} icon="spark" title="Brand kit" say=${`${BRAND_KIT_WORDS.charAt(0).toUpperCase()}${BRAND_KIT_WORDS.slice(1)}`}
            control=${html`<${Button} size="sm" href=${BRAND_KIT_HREF}>Open the brand kit<//>`} />`
        : html`<${Row} key=${f.id} icon="form" title=${cut(f.title, 80)}
            state=${f.state === "filled" ? { tone: "good", text: "Filled" } : "Not filled in yet"}
            control=${html`<${Button} size="sm" variant=${f.state === "filled" ? "quiet" : "plain"}
              href=${filesHref({ folder, mode: `form:${f.id}` })}>${f.state === "filled" ? "Edit" : "Fill it in"}<//>`} />`))}
    <//>
  <//>`;
}

function Starters({ brain, onAdded }) {
  const list = arr(brain && brain.starters).filter((s) => s && ID.test(str(s.id)));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  if (!list.length) return null;
  const add = async (id) => {
    setBusy(id);
    setMessage("");
    try {
      const res = await api.post("/api/brain/starters", { ids: [id] });
      const skipped = arr(res && res.skipped).find((s) => s && s.id === id);
      if (skipped) setMessage(cut(skipped.why, 300) || "That pack was not added.");
      onAdded();
    } catch (e) {
      setMessage(refusal(e, "That pack could not be added."));
    } finally {
      setBusy("");
    }
  };
  return html`<${Group} title="Starter packs" say="A page about the shape of one kind of work. Add one, then change it as you like.">
    <${Rows}>
      ${list.map((s) => html`<${Row} key=${s.id} icon="layers" title=${cut(s.title, 80)} say=${cut(s.about, 200)}
        state=${s.added ? { tone: "good", text: "Added" } : null}
        control=${s.added ? null : html`<${Button} size="sm" icon="plus" busy=${busy === s.id} onClick=${() => add(s.id)}>Add<//>`} />`)}
    <//>
    ${message ? html`<p class="p-files__refusal" role="status">${message}</p>` : null}
  <//>`;
}

function FolderView({ id, brain, grid, by, onChanged }) {
  const res = useResource(`/api/brain/folder/${encodeURIComponent(id)}`, { every: EVERY });
  if (res.loading && !res.data) return html`<${Loading} lines=${4} label="Opening the folder" />`;
  if (res.error) {
    return res.error.code === "folder_not_found"
      ? html`<${Empty} title="There is no folder of that name."><${Button} href="#/files" icon="arrow-left">All files<//><//>`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }
  const files = sortFiles(arr(res.data && res.data.files).filter((f) => f && TOKEN.test(str(f.token))), by);
  const size = files.reduce((n, f) => n + (Number.isFinite(Number(f.size)) ? Number(f.size) : 0), 0);
  return html`
    <p class="p-files__count">${count(files.length, "file")}${files.length ? html` · <span class="p-files__num">${bytes(size)}</span>` : null}</p>
    ${files.length
      ? html`<${FileList} files=${files} folder=${id} grid=${grid} brain=${brain} />`
      : html`<${Empty} title="Nothing in this folder yet.">
          <${Button} href=${filesHref({ folder: id, mode: "paste" })} icon="plus">Paste text<//>
        <//>`}
    ${id === "brand" && !arr(res.data && res.data.forms).some((f) => f && formLeadsToKit(f.id))
      ? html`<${Group} title="Brand kit">
          <${Rows}><${Row} icon="spark" title="Brand kit" say=${`${BRAND_KIT_WORDS.charAt(0).toUpperCase()}${BRAND_KIT_WORDS.slice(1)}`}
            control=${html`<${Button} size="sm" href=${BRAND_KIT_HREF}>Open the brand kit<//>`} /><//>
        <//>`
      : null}
    <${FolderForms} forms=${res.data && res.data.forms} folder=${id} />
    ${id === "packs" ? html`<${Starters} brain=${brain} onAdded=${() => { res.refresh(); onChanged(); }} />` : null}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The page

const NEW_TITLES = { paste: "Paste text", upload: "Add a file", form: "Fill in a form" };

// The Brand kit's page, loaded the first time its address is opened.
function BrandKitHost({ route }) {
  const part = useBrainPart("brandKit");
  if (part.state === "ready") return html`<${part.C} route=${route} />`;
  return html`<div class="p-files">
    <${PageHeader} title="Brand kit" chip=${{ label: ["Files", "Brand kit"], href: "#/files", closeLabel: "Back to all files" }} />
    ${part.state === "missing" ? html`<${BeingBuilt} title="The brand kit page is not ready yet." />` : html`<${Loading} lines=${4} label="Opening the brand kit" />`}
  </div>`;
}

export default function Page({ route }) {
  return isBrandKit(route && route.parts) ? html`<${BrandKitHost} route=${route} />` : html`<${FilesPage} route=${route} />`;
}

// A place's count is shown only when it says something: an empty place shows none.
export const shownCount = (p) => Boolean(p) && Number.isFinite(p.count) && p.count > 0;

// The label of a place in the list: its name, and its count beside it in muted tabular figures.
function placeLabel(p) {
  return html`<span class="p-files__place">
    <span class="p-files__place-name">${p.label}</span>
    ${shownCount(p) ? html`<span class="p-files__place-count">${p.count}</span>` : null}
  </span>`;
}

function FilesPage({ route }) {
  const { announce, setTop } = useApp();
  const parts = arr(route && route.parts);
  const query = (route && route.query) || new URLSearchParams();
  const folder = parts.length === 2 && ID.test(parts[1]) ? parts[1] : "";
  const badFolder = parts.length === 2 && !folder;
  const fileTok = TOKEN.test(query.get("file") || "") ? query.get("file") : "";
  const tab = query.get("tab") === "lessons" ? "lessons" : "files";
  const sharedMode = !folder && !badFolder && query.get("shared") === "1";
  const wanted = newMode(query.get("new"));
  // The Brand form now lives in the Brand kit (PLAN-V5 T14).
  const toKit = Boolean(wanted && wanted.mode === "form" && formLeadsToKit(wanted.form));
  useEffect(() => { if (toKit) redirect(BRAND_KIT_HREF); }, [toKit]);
  const routeQ = cut(query.get("q") || "", 200);

  const brain = useResource("/api/brain", { every: EVERY });
  const web = useResource("/api/web");
  const newFile = useBrainPart("newFile");
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState(routeQ);
  const [term, setTerm] = useState(routeQ.trim());
  const [folderKey, setFolderKey] = useState(0);
  const [grid, setGrid] = useState(false);
  const [by, setBy] = useState("date");
  const [fileName, setFileName] = useState("");
  useEffect(() => { setQ(routeQ); setTerm(routeQ.trim()); }, [routeQ]);

  // Searching waits for a short pause in typing; the address keeps the words without reloading the page.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = q.trim();
      setTerm(next);
      try {
        const hash = withoutKey(location.hash, "q");
        const glue = hash.includes("?") ? "&" : "?";
        history.replaceState(null, "", next ? `${hash}${glue}q=${encodeURIComponent(next)}` : hash);
      } catch { /* the address stays as it is */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const folders = arr(brain.data && brain.data.folders);
  const reloadAll = () => { brain.refresh(); setFolderKey((n) => n + 1); };

  // The file named by ?file= is read in place. A folder's token opens the folder; a basic not there yet opens its
  // form (that needs /api/brain, so it waits for it), unless that file was just saved (M52 K2).
  const saved = useRef("");
  const [savedName, setSavedName] = useState("");
  const brainSettled = !!(brain.data || brain.error);
  const target = fileTok ? fileTarget(fileTok, brain.data) : null;
  useEffect(() => {
    if (!target) return;
    if (target.to === "folder") redirect(target.href);
    else if (target.to === "form" && saved.current !== fileTok) redirect(target.href);
  }, [fileTok, target && target.to, target && target.href]);
  const formTarget = fileTok ? fileTarget(fileTok, brain.data, { missingOnly: false }) : null;
  const formHref = formTarget && formTarget.to === "form" ? formTarget.href : "";
  useEffect(() => { setFileName(""); }, [fileTok]);

  const folderInfo = folders.find((f) => f && f.id === folder);
  // A folder the brain does not have is "Folder not found", never the typed address (M52 F5).
  const unknownFolder = badFolder || (folder && brain.data && !folderInfo && !FOLDER_TITLES[folder]);
  const folderTitle = cut(folderInfo && folderInfo.title, 60) || FOLDER_TITLES[folder] || (brain.data ? "Folder not found" : "Files");
  const closeNew = () => go(filesHref({ folder, q: term, tab: tab === "lessons" ? "lessons" : "" }));

  const showFile = Boolean(fileTok) && !(target && target.to === "folder");
  const title = showFile
    ? fileName || (saved.current === fileTok && savedName) || "File"
    : folder || badFolder ? (unknownFolder ? "Folder not found" : folderTitle)
    : sharedMode ? SHARE_WORDS.title
    : tab === "lessons" ? FILES_WORDS.lessons
    : FILES_WORDS.title;
  const lead = showFile ? ""
    : folder || badFolder ? (folderInfo ? cut(folderInfo.about, 200) : "")
    : sharedMode ? SHARE_WORDS.lead
    : tab === "lessons" ? FILES_WORDS.lessonsLead
    : FILES_WORDS.lead;

  // The top bar's crumbs: Files, the place, the file.
  const crumbKey = `${folder}|${sharedMode}|${tab}|${showFile ? title : ""}|${unknownFolder}`;
  useEffect(() => {
    if (typeof setTop !== "function") return;
    const crumbs = [{ label: FILES_WORDS.title, href: "#/files" }];
    if (folder && !unknownFolder) crumbs.push({ label: folderTitle, href: filesHref({ folder }) });
    else if (sharedMode) crumbs.push({ label: SHARE_WORDS.title, href: filesHref({ shared: true }) });
    else if (tab === "lessons") crumbs.push({ label: FILES_WORDS.lessons, href: filesHref({ tab: "lessons" }) });
    if (showFile) crumbs.push({ label: title });
    setTop({ crumbs: crumbs.map((c, i) => (i === crumbs.length - 1 ? { label: c.label } : c)) });
  }, [crumbKey]);

  // After a save the page title takes focus, so the owner hears where they are (M52 K2).
  useEffect(() => {
    if (!fileTok || saved.current !== fileTok || typeof document === "undefined") return undefined;
    const t = setTimeout(() => { const h = document.getElementById("page-title"); if (h) h.focus({ preventScroll: true }); }, 0);
    return () => clearTimeout(t);
  }, [fileTok]);

  const built = newFile.state === "ready";
  const later = built ? "" : " (being built)";
  const newMenu = html`<div class="p-files__new">
    <${Menu} label="+ New" items=${[
      { id: "form", icon: "form", label: `Fill in a form${later}`, onSelect: () => setPicking(true) },
      { id: "paste", icon: "file", label: `Paste text${later}`, onSelect: () => go(filesHref({ folder, mode: "paste" })) },
      { id: "upload", icon: "upload", label: `Add a file${later}`, onSelect: () => go(filesHref({ folder, mode: "upload" })) },
    ]} />
  </div>`;

  const basics = arr(brain.data && brain.data.basics && brain.data.basics.items).filter((b) => b && ID.test(str(b.form)));
  const formTitle = wanted && wanted.mode === "form" ? cut((basics.find((b) => b.form === wanted.form) || {}).title, 60) : "";

  const sharedCount = web.data ? sharedFiles(web.data).length : null;
  const places = placesOf(brain.data, { shared: sharedCount });
  // An opened file lifts the place it is in (a file directly in the brain is in Loose files).
  const filePath = showFile ? tokenPath(fileTok) : "";
  const fileFolder = filePath.includes("/") ? filePath.split("/")[0] : filePath ? "loose" : "";
  const current = placeOf({ folder: folder || (sharedMode ? "" : fileFolder), shared: sharedMode, tab });
  const sections = places.map((p) => ({ id: p.id, icon: p.icon, label: placeLabel(p), href: p.href }));
  const currentPlace = places.find((p) => p.id === current) || places[0];
  // Below 1100 px the places are this one menu.
  const placeMenu = html`<div class="p-files__places-menu">
    <${Menu} label=${`${FILES_WORDS.places}: ${currentPlace.label}`} items=${places.map((p) => ({
      id: p.id, label: shownCount(p) ? `${p.label} (${p.count})` : p.label,
      current: p.id === current, onSelect: () => go(p.href),
    }))} />
  </div>`;

  const searching = tab === "files" && !sharedMode && q.trim().length > 0;
  const listing = !showFile && !sharedMode && !(tab === "lessons" && !folder) && !badFolder;
  const toolbar = showFile ? html`<div class="p-files__toolbar p-files__toolbar--file">${placeMenu}</div>` : html`<div class="p-files__toolbar">
    <div class="p-files__tools-start">
      ${placeMenu}
      ${listing && !searching
        ? html`<${Segmented} size="sm" label=${FILES_WORDS.view} current=${grid ? "grid" : "list"} onChange=${(v) => setGrid(v === "grid")}
            items=${[{ id: "list", label: "List", icon: "list" }, { id: "grid", label: "Cards", icon: "grid" }]} />
          <div class="p-files__sort">
            <${Menu} label=${`${FILES_WORDS.sort}: ${(SORTS.find((s) => s.id === by) || SORTS[0]).label}`}
              items=${SORTS.map((s) => ({ id: s.id, label: s.label, current: s.id === by, onSelect: () => setBy(s.id) }))} />
          </div>`
        : null}
    </div>
    ${sharedMode ? null : html`<label class="p-files__search">
      <${Icon} name="search" size=${16} />
      <${TextInput} type="search" value=${q} maxLength=${200} placeholder="Search in files" aria-label=${FILES_WORDS.search}
        onInput=${(e) => setQ(e.currentTarget.value)} />
    </label>`}
  </div>`;

  const recent = sortFiles(arr(brain.data && brain.data.recent).filter((f) => f && TOKEN.test(str(f.token))), by).slice(0, 8);
  const totals = (brain.data && brain.data.totals) || {};

  let body;
  if (showFile) {
    body = !brainSettled || (target && target.to === "form" && saved.current !== fileTok)
      ? html`<${Loading} lines=${6} label="Opening the file" />`
      : html`<${FileView} key=${`${fileTok}-${folderKey}`} token=${fileTok} folders=${folders} formHref=${formHref} onName=${setFileName}
          onMoved=${(file) => {
            announce && announce("File moved.");
            reloadAll();
            if (file && TOKEN.test(str(file.token))) go(filesHref({ folder: ID.test(str(file.folder)) ? file.folder : folder, file: file.token }));
          }}
          onDeleted=${(file) => {
            announce && announce("File deleted.");
            reloadAll();
            go(filesHref({ folder: ID.test(str(file && file.folder)) ? file.folder : folder }));
          }} />`;
  } else if (sharedMode) body = html`<${SharedView} />`;
  else if (searching) body = html`<${SearchResults} term=${term} folder=${folder} />`;
  else if (tab === "lessons" && !folder) body = html`<${Lessons} />`;
  else if (badFolder) body = html`<${Empty} title="There is no folder of that name."><${Button} href="#/files" icon="arrow-left">All files<//><//>`;
  else if (folder) body = html`<${FolderView} key=${`${folder}-${folderKey}`} id=${folder} brain=${brain.data} grid=${grid} by=${by} onChanged=${reloadAll} />`;
  else if (brain.loading && !brain.data) body = html`<${Loading} lines=${4} label="Loading your files" />`;
  else if (brain.data) {
    body = html`
      <p class="p-files__count">${count(Number(totals.files) || 0, "file")} in ${count(folders.length, "folder")} · <span class="p-files__num">${bytes(totals.bytes)}</span></p>
      ${recent.length
        ? html`<${Group} title=${FILES_WORDS.recent}><${FileList} files=${recent} folder="" grid=${grid} brain=${brain.data} /><//>`
        : html`<${Empty} title="No files yet." text="Add a file and it appears here." />`}
      <${ReadinessPanel} brain=${brain.data} />`;
  } else body = null;

  return html`<div class=${`p-files${showFile ? " p-files--file" : ""}`}>
    <${DocLayout} title=${title} sections=${sections} current=${current}>
      <div class="p-files__lead">
        ${lead ? html`<p class="p-files__lead-line">${lead}</p>` : html`<span></span>`}
        ${showFile || sharedMode ? null : newMenu}
      </div>
      ${savedName && saved.current && saved.current === fileTok ? html`<p class="p-files__saved" role="status"><${Icon} name="check" size=${16} />Saved. ${savedName}</p>` : null}
      ${brain.error && !brain.data ? html`<${ErrorNotice} error=${brain.error} onRetry=${brain.reload} />` : null}
      ${toolbar}
      <div class="p-files__set">${body}</div>
    <//>

    <${Dialog} open=${picking} title="Fill in a form" onClose=${() => setPicking(false)}>
      ${basics.length
        ? html`<ul class="p-files__forms">
            ${basics.map((b) => html`<li key=${b.form} class="p-files__form">
              <${Icon} name="form" />
              <span class="p-files__form-title">${cut(b.title, 80)}</span>
              ${b.state === "filled" ? html`<${Tag} tone="ok">Filled<//>` : null}
              <a href=${filesHref({ folder, mode: `form:${b.form}` })} onClick=${() => setPicking(false)}>${b.state === "filled" ? "Edit" : "Fill it in"}</a>
            </li>`)}
          </ul>`
        : html`<p class="p-files__count">The forms could not be read yet.</p>`}
    <//>

    <${Dialog} open=${!!wanted && !toKit} size="lg" title=${wanted ? (formTitle ? `Fill in: ${formTitle}` : NEW_TITLES[wanted.mode]) : ""} onClose=${closeNew}>
      ${wanted && built
        ? html`<${newFile.C} mode=${query.get("new")} folder=${folder}
            onDone=${(res) => {
              reloadAll();
              const file = res && (res.file || res);
              announce && announce("Saved.");
              if (file && TOKEN.test(str(file.token))) {
                saved.current = file.token;
                setSavedName(cut(file.name, NAME_MAX));
                go(filesHref({ folder: ID.test(str(file.folder)) ? file.folder : folder, file: file.token }));
              } else closeNew();
            }} />`
        : wanted && newFile.state === "missing"
          ? html`<${BeingBuilt} title="Adding files here is not ready yet." />`
          : html`<${Loading} lines=${3} />`}
    <//>
  </div>`;
}
