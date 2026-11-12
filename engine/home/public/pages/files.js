// Files: the company brain (CONTRACTS-V3 30, 32, 33.6). The folders, one folder's files, one file in the work panel,
// a search over them, and what agents have learned. Adding a file (`?new=`) and the readiness panel are
// brain/new-file.js and brain/readiness.js; until they are built the page says so.
// Every name and every word of a file is shown as text, never as HTML. A picture is shown only from its own raw address.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { go } from "../lib/router.js";
import { bytes, count } from "../lib/format.js";
import { useApp } from "../lib/context.js";
import {
  BeingBuilt, Button, Card, Chip, DataTable, Dialog, Empty, ErrorNotice, Field, Icon, Loading, Menu, PageHeader,
  Ring, Section, Segmented, Select, Tag, TextInput, Time,
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

// The modules of M29, loaded when they exist: [path from this file, export name].
const BRAIN_PARTS = {
  newFile: ["../brain/new-file.js", "NewFile"],
  readiness: ["../brain/readiness.js", "Readiness"],
};

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/files.test.mjs)

// The address of a state of this page: #/files, #/files/<folder>, with ?file=, ?q=, ?tab=lessons, ?new=.
export function filesHref({ folder, file, q, tab, mode } = {}) {
  const f = ID.test(str(folder)) ? `/${folder}` : "";
  const qs = new URLSearchParams();
  if (TOKEN.test(str(file))) qs.set("file", file);
  if (str(q).trim()) qs.set("q", str(q).trim().slice(0, 200));
  if (tab === "lessons") qs.set("tab", "lessons");
  if (newMode(mode)) qs.set("new", mode);
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

// ---------------------------------------------------------------------------------------------------------------
// One file, in the work panel.

function FileBody({ data }) {
  const file = data.file || {};
  const how = viewOf(file);
  const download = safeBrainUrl(file.downloadUrl);
  if (how === "text") {
    return html`
      <pre class="p-files__text">${str(data.text)}</pre>
      ${data.truncated ? html`<p class="u-caption">Only the start of this long file is shown. Download it to read the rest.</p>` : null}`;
  }
  if (how === "table") {
    const csv = readCsv(data.text);
    const t = tableOf(csv.rows);
    return html`
      <div class="p-files__table">
        <${DataTable} columns=${t.columns} rows=${t.rows} emptyText="This table has no rows under its headings." />
      </div>
      ${csv.moreRows || csv.moreCols || data.truncated
        ? html`<p class="u-caption">Only the first 200 rows and 30 columns are shown. Download it to see all of it.</p>`
        : null}`;
  }
  if (how === "image") {
    return html`<figure class="p-files__picture">
      <img src=${safeBrainUrl(file.rawUrl)} alt=${cut(file.name, NAME_MAX)} loading="lazy" decoding="async" />
    </figure>`;
  }
  if (how === "pdf") {
    return html`<${Card} tone="sunken" class="p-files__pdf">
      <span class="p-files__pdf-icon"><${Icon} name="file" size=${24} /></span>
      <span class="p-files__pdf-body">
        <strong class="u-wrap">${cut(file.name, NAME_MAX)}</strong>
        <span class="u-caption">PDF · ${bytes(file.size)}</span>
        <span class="u-muted">Search does not look inside PDF files.</span>
      </span>
      ${download ? html`<${Button} size="sm" icon="download" href=${download} download=${cut(file.name, NAME_MAX)}>Download<//>` : null}
    <//>`;
  }
  return html`<p class="u-muted">This file cannot be shown here.</p>`;
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

// `onGone` runs when the panel closes, so the page can take `?file=` out of its address.
// `formHref` is set when the token names one of the basics: a basic that is not there yet leads to its form.
function FileView({ token, folders, formHref, onMoved, onDeleted, onGone }) {
  const res = useResource(`/api/brain/file/${encodeURIComponent(token)}`);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => () => gone.current && gone.current(), []);
  const notFound = !!(res.error && res.error.code === "file_not_found");
  useEffect(() => { if (notFound && formHref) redirect(formHref); }, [notFound, formHref]);

  if (res.loading && !res.data) return html`<div class="p-files p-files--panel"><${Loading} lines=${4} label="Opening the file" /></div>`;
  if (res.error) {
    return html`<div class="p-files p-files--panel">
      ${notFound && formHref
        ? html`<${Empty} title="This has not been filled in yet."><${Button} href=${formHref} icon="form">Fill it in<//><//>`
        : notFound
        ? html`<${Empty} title="This file is not in your files any more." text="It may have been moved or deleted." />`
        : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
    </div>`;
  }
  const file = (res.data && res.data.file) || {};
  return html`<div class="p-files p-files--panel">
    <p class="p-files__name u-wrap">${cut(file.name, NAME_MAX)}</p>
    <div class="p-files__meta">
      <${Chip} icon=${ICONS[file.kind] || "file"}>${kindLabel(file.kind)}<//>
      <span class="u-caption">${bytes(file.size)}</span>
      <${Time} at=${file.changedAt || file.addedAt} prefix="Changed" />
    </div>
    <${FileActions} key=${str(file.version)} file=${file} folders=${folders}
      onMoved=${(moved) => onMoved(moved || file)} onDeleted=${onDeleted} />
    <${FileBody} data=${res.data} />
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Lists

function FileItem({ file, folder, grid }) {
  const name = cut(file.name, NAME_MAX);
  const href = filesHref({ folder, file: file.token });
  const at = file.changedAt || file.addedAt;
  if (grid) {
    // A picture shows itself (from the brain's own raw address, served with a sandbox policy); the size follows
    // the date, as C3 30 asks (M52 F8).
    const picture = file.kind === "image" ? safeBrainUrl(file.rawUrl) : null;
    return html`<li class="p-files__tile">
      <a class="p-files__tile-link u-glass" href=${href} title=${name}>
        <span class="p-files__tile-name u-truncate">${name}</span>
        <span class=${`p-files__tile-face${picture ? " p-files__tile-face--picture" : ""}`} aria-hidden="true">
          ${picture
            ? html`<img class="p-files__tile-img" src=${picture} alt="" loading="lazy" decoding="async" />`
            : html`<${Icon} name=${ICONS[file.kind] || "file"} size=${24} />
              <span class="p-files__tile-kind">${kindLabel(file.kind)}</span>`}
        </span>
        <span class="p-files__tile-foot u-caption"><${Time} at=${at} prefix="Added" /> · ${bytes(file.size)}</span>
      </a>
    </li>`;
  }
  return html`<li class="p-files__row">
    <a class="p-files__row-link" href=${href}>
      <span class="p-files__row-icon"><${Icon} name=${ICONS[file.kind] || "file"} /></span>
      <span class="p-files__row-name u-truncate" title=${name}>${name}</span>
      <span class="p-files__row-meta u-caption">
        <span>${kindLabel(file.kind)}</span>
        <span>${bytes(file.size)}</span>
        <${Time} at=${at} />
      </span>
      <${Icon} name="chevron-right" size=${14} class="p-files__chev" />
    </a>
  </li>`;
}

function FileList({ files, folder, grid }) {
  return html`<ul class=${grid ? "p-files__grid" : "p-files__rows"}>
    ${files.map((f) => html`<${FileItem} key=${f.token} file=${f} folder=${folder} grid=${grid} />`)}
  </ul>`;
}

function SearchResults({ term, folder }) {
  const res = useResource(term.length >= 2 ? `/api/brain/search?q=${encodeURIComponent(term)}` : null);
  if (term.length < 2) return html`<p class="u-muted">Type at least two letters.</p>`;
  if (res.loading && !res.data) return html`<${Loading} lines=${2} label="Searching your files" />`;
  if (res.error) return html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  const results = arr(res.data && res.data.results).filter((r) => r && TOKEN.test(str(r.token))).slice(0, 20);
  if (!results.length) return html`<p class="u-muted">Nothing in your files matches "${cut(term, 80)}".</p>`;
  return html`<ul class="p-files__results">
    ${results.map((r) => html`<li key=${r.token}>
      <a class="p-files__result u-glass" href=${filesHref({ folder, q: term, file: r.token })}>
        <span class="p-files__result-name u-wrap">${cut(r.name, NAME_MAX)}</span>
        ${r.snippet ? html`<span class="p-files__result-snippet u-wrap">${cut(r.snippet, SNIPPET_MAX)}</span>` : null}
      </a>
    </li>`)}
  </ul>`;
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
      return html`<${Card} key=${r.slug}>
        <div class="u-spread">
          <strong>${cut(r.name, 80)}</strong>
          ${ID.test(str(r.slug)) ? html`<a href=${`#/team/${r.slug}?tab=lessons`}>Edit</a>` : null}
        </div>
        ${lessons.length
          ? html`<ul class="p-files__lesson-list">${lessons.map((l, i) => {
              const { date, text } = splitLesson(cut(String(l ?? ""), LESSON_MAX));
              return html`<li key=${i} class="u-wrap">${text}${date ? html` <span class="u-caption">${date}</span>` : null}</li>`;
            })}</ul>`
          : html`<p class="u-muted">Nothing learned yet.</p>`}
      <//>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The top of the page: readiness and the folders

function BasicsFallback({ brain }) {
  const items = arr(brain && brain.basics && brain.basics.items);
  if (!items.length) return null;
  return html`<ul class="p-files__basics">
    ${items.map((b) => html`<li key=${b.form} class="p-files__basic">
      <span class="u-truncate">${cut(b.title, 80)}</span>
      ${b.state === "filled"
        ? html`<${Tag} tone="ok">Filled<//>`
        : ID.test(str(b.form)) ? html`<a href=${filesHref({ mode: `form:${b.form}` })}>Fill it in</a>` : null}
    </li>`)}
  </ul>`;
}

function ReadinessCard({ brain }) {
  const part = useBrainPart("readiness");
  if (part.state === "ready") return html`<div class="p-files__ready"><${part.C} brain=${brain} /></div>`;
  const b = (brain && brain.basics) || {};
  return html`<${Card} class="p-files__ready">
    <div class="p-files__ready-head">
      <${Ring} value=${b.filled} total=${b.total ?? 9} size=${48} label=${basicsLine(brain)} />
      <div class="p-files__ready-words">
        <p class="u-over">The basics</p>
        <p class="p-files__ready-line">${basicsLine(brain)}</p>
        <p class="u-caption">Agents read these before they write anything for you.</p>
      </div>
    </div>
    ${part.state === "missing" ? html`<${BasicsFallback} brain=${brain} />` : null}
  <//>`;
}

function Folders({ brain }) {
  const folders = arr(brain && brain.folders).filter((f) => f && ID.test(str(f.id)));
  if (!folders.length) return html`<${Empty} title="No folders yet." text="Add a file and its folder appears here." />`;
  return html`<ul class="p-files__folders">
    ${folders.map((f) => html`<li key=${f.id}>
      <${Card} href=${filesHref({ folder: f.id })} class="p-files__folder">
        <span class="p-files__folder-head">
          <${Icon} name="folder" size=${18} />
          <span class="p-files__folder-title u-truncate">${cut(f.title, 60)}</span>
        </span>
        <span class="p-files__folder-about">${cut(f.about, 200)}</span>
        <span class="u-caption">${count(Number(f.files) || 0, "file")}</span>
      <//>
    </li>`)}
  </ul>`;
}

// ---------------------------------------------------------------------------------------------------------------
// One folder

function FolderForms({ forms, folder }) {
  const list = arr(forms).filter((f) => f && ID.test(str(f.id)));
  if (!list.length) return null;
  return html`<${Section} title="Forms for this folder" hint="Only you know these facts. Fill them in and agents read them.">
    <ul class="p-files__forms">
      ${list.map((f) => html`<li key=${f.id} class="p-files__form">
        <${Icon} name="form" />
        <span class="u-grow u-truncate">${cut(f.title, 80)}</span>
        ${f.state === "filled" ? html`<${Tag} tone="ok">Filled<//>` : html`<${Tag}>Not filled in yet<//>`}
        <a href=${filesHref({ folder, mode: `form:${f.id}` })}>${f.state === "filled" ? "Edit" : "Fill it in"}</a>
      </li>`)}
    </ul>
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
  return html`<${Section} title="Starter packs" hint="A page about the shape of one kind of work. Add one, then change it as you like.">
    <ul class="p-files__starters">
      ${list.map((s) => html`<li key=${s.id} class="p-files__starter">
        <span class="p-files__starter-words">
          <strong>${cut(s.title, 80)}</strong>
          <span class="u-caption">${cut(s.about, 200)}</span>
        </span>
        ${s.added ? html`<${Tag} tone="ok">Added<//>` : html`<${Button} size="sm" icon="plus" busy=${busy === s.id} onClick=${() => add(s.id)}>Add<//>`}
      </li>`)}
    </ul>
    ${message ? html`<p class="p-files__refusal" role="status">${message}</p>` : null}
  <//>`;
}

function FolderView({ id, brain, onChanged }) {
  const res = useResource(`/api/brain/folder/${encodeURIComponent(id)}`, { every: EVERY });
  const [grid, setGrid] = useState(true);
  const [by, setBy] = useState("date");
  if (res.loading && !res.data) return html`<${Loading} lines=${4} label="Opening the folder" />`;
  if (res.error) {
    return res.error.code === "folder_not_found"
      ? html`<${Empty} title="There is no folder of that name."><${Button} href="#/files" icon="arrow-left">All files<//><//>`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }
  const files = sortFiles(arr(res.data && res.data.files).filter((f) => f && TOKEN.test(str(f.token))), by);
  return html`
    <div class="p-files__bar">
      <span class="p-files__count u-caption">${count(files.length, "file")}</span>
      <div class="p-files__bar-tools">
        <${Field} label="Sort by">
          <${Select} options=${[{ value: "date", label: "Newest first" }, { value: "name", label: "Name" }]} value=${by}
            onChange=${(e) => setBy(e.currentTarget.value)} />
        <//>
        <${Segmented} size="sm" label="Show as" current=${grid ? "grid" : "list"} onChange=${(v) => setGrid(v === "grid")}
          items=${[{ id: "list", label: "List", icon: "list" }, { id: "grid", label: "Grid", icon: "grid" }]} />
      </div>
    </div>
    ${files.length
      ? html`<${FileList} files=${files} folder=${id} grid=${grid} />`
      : html`<${Empty} title="Nothing in this folder yet.">
          <${Button} href=${filesHref({ folder: id, mode: "paste" })} icon="plus">Paste text<//>
        <//>`}
    <${FolderForms} forms=${res.data && res.data.forms} folder=${id} />
    ${id === "packs" ? html`<${Starters} brain=${brain} onAdded=${() => { res.refresh(); onChanged(); }} />` : null}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The page

const NEW_TITLES = { paste: "Paste text", upload: "Add a file", form: "Fill in a form" };

export default function Page({ route }) {
  const { announce, openPanel, closePanel } = useApp();
  const parts = arr(route && route.parts);
  const query = (route && route.query) || new URLSearchParams();
  const folder = parts.length === 2 && ID.test(parts[1]) ? parts[1] : "";
  const badFolder = parts.length === 2 && !folder;
  const fileTok = TOKEN.test(query.get("file") || "") ? query.get("file") : "";
  const tab = query.get("tab") === "lessons" ? "lessons" : "files";
  const wanted = newMode(query.get("new"));
  const routeQ = cut(query.get("q") || "", 200);

  const brain = useResource("/api/brain", { every: EVERY });
  const newFile = useBrainPart("newFile");
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState(routeQ);
  const [term, setTerm] = useState(routeQ.trim());
  const [folderKey, setFolderKey] = useState(0);
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

  // The file named by ?file= opens in the work panel. It opens after the shell has finished its own work for a new
  // address (the shell closes the panel when the address changes). Closing the panel takes ?file= out of the address.
  const opened = useRef(null);
  // The file a form, a paste or an upload has just saved (M52 K2): it opens in the panel even while /api/brain still
  // lists it as missing, focus goes to the panel's title, and the page says "Saved.".
  const saved = useRef("");
  const [savedName, setSavedName] = useState("");
  const path = parts.join("/");
  const brainSettled = !!(brain.data || brain.error);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  useEffect(() => {
    if (!fileTok) {
      if (opened.current) { opened.current = null; closePanel(); }
      return undefined;
    }
    const shown = typeof document === "undefined" || !!document.querySelector(".s-panel");
    if (opened.current && opened.current.token === fileTok && opened.current.path === path && (shown || saved.current !== fileTok)) return undefined;
    // A folder's token opens the folder; a basic not there yet opens its form (that needs /api/brain, so wait for it).
    const target = fileTarget(fileTok, brain.data);
    if (target.to === "folder") { redirect(target.href); return undefined; }
    if (target.to === "file" && !brainSettled) return undefined;
    if (target.to === "form" && saved.current !== fileTok) { redirect(target.href); return undefined; }
    const formTarget = fileTarget(fileTok, brain.data, { missingOnly: false });
    const formHref = formTarget.to === "form" ? formTarget.href : "";
    const show = () => {
      const mine = { token: fileTok, path };
      opened.current = mine;
      const known = arr(brain.data && brain.data.recent).find((f) => f && f.token === fileTok);
      openPanel(html`<${FileView} key=${fileTok} token=${fileTok} folders=${foldersRef.current} formHref=${formHref}
        onMoved=${(file) => {
          announce && announce("File moved.");
          reloadAll();
          if (file && TOKEN.test(str(file.token))) go(filesHref({ folder: ID.test(str(file.folder)) ? file.folder : folder, file: file.token }));
        }}
        onDeleted=${() => {
          announce && announce("File deleted.");
          reloadAll();
          closePanel();
        }}
        onGone=${() => {
          if (opened.current === mine) opened.current = null;
          try {
            const h = location.hash;
            const hp = h.replace(/^#\/?/, "").split("?")[0];
            if (hp === mine.path && new URLSearchParams(h.split("?")[1] || "").get("file") === mine.token) {
              history.replaceState(null, "", withoutKey(h, "file"));
            }
          } catch { /* the address stays as it is */ }
        }} />`, { title: cut(known && known.name, NAME_MAX) || (saved.current === fileTok && savedName) || "File" });
      if (saved.current === fileTok && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          const title = typeof document !== "undefined" ? document.querySelector(".s-panel-title") : null;
          if (title) { title.setAttribute("tabindex", "-1"); title.focus({ preventScroll: true }); }
        });
      }
    };
    const t = setTimeout(show, 0);
    // After a save the address moves to the file's folder, and the shell closes the panel for the new page; when that
    // lands after ours, open the saved file again (M52 K2).
    const again = saved.current === fileTok ? setTimeout(() => {
      if (typeof document !== "undefined" && !document.querySelector(".s-panel")
        && new URLSearchParams(location.hash.split("?")[1] || "").get("file") === fileTok) show();
    }, 400) : 0;
    return () => { clearTimeout(t); clearTimeout(again); };
  }, [route, brainSettled]);

  const folderInfo = folders.find((f) => f && f.id === folder);
  // A folder the brain does not have is "Folder not found", never the typed address (M52 F5).
  const unknownFolder = badFolder || (folder && brain.data && !folderInfo && !FOLDER_TITLES[folder]);
  const folderTitle = cut(folderInfo && folderInfo.title, 60) || FOLDER_TITLES[folder] || (brain.data ? "Folder not found" : "Files");
  const closeNew = () => go(filesHref({ folder, q: term, tab: tab === "lessons" ? "lessons" : "" }));

  const built = newFile.state === "ready";
  const later = built ? "" : " (being built)";
  const menu = html`<div class="p-files__new">
    <${Menu} label="+ New" items=${[
      { id: "form", icon: "form", label: `Fill in a form${later}`, onSelect: () => setPicking(true) },
      { id: "paste", icon: "file", label: `Paste text${later}`, onSelect: () => go(filesHref({ folder, mode: "paste" })) },
      { id: "upload", icon: "upload", label: `Add a file${later}`, onSelect: () => go(filesHref({ folder, mode: "upload" })) },
    ]} />
  </div>`;

  const basics = arr(brain.data && brain.data.basics && brain.data.basics.items).filter((b) => b && ID.test(str(b.form)));
  const formTitle = wanted && wanted.mode === "form" ? cut((basics.find((b) => b.form === wanted.form) || {}).title, 60) : "";

  const header = folder || badFolder
    ? html`<${PageHeader} over="Company brain" title=${unknownFolder ? "Folder not found" : folderTitle}
        lead=${folderInfo ? cut(folderInfo.about, 200) : undefined}
        chip=${{ label: unknownFolder ? ["Files"] : ["Files", folderTitle], href: "#/files", closeLabel: "Back to all files" }}
        actions=${menu} />`
    : html`<${PageHeader} over="Company brain" title="Files"
        lead="Your company's own files. Every agent reads them before it works." actions=${menu} />`;

  const searching = tab === "files" && q.trim().length > 0;

  return html`<div class="p-files">
    ${header}

    ${savedName && saved.current && saved.current === fileTok ? html`<p class="p-files__saved" role="status"><${Icon} name="check" size=${16} />Saved. ${savedName}</p>` : null}
    ${brain.error && !brain.data ? html`<${ErrorNotice} error=${brain.error} onRetry=${brain.reload} />` : null}

    ${!folder && !badFolder && brain.data ? html`<${ReadinessCard} brain=${brain.data} />` : null}

    <div class="p-files__tools">
      <div class="p-files__search">
        <${Field} label="Search your files">
          <${TextInput} type="search" value=${q} maxLength=${200} placeholder="Search in files"
            onInput=${(e) => setQ(e.currentTarget.value)} />
        <//>
      </div>
      ${!folder && !badFolder
        ? html`<${Segmented} label="Show" current=${tab} items=${[
            { id: "files", label: "Folders", icon: "folder", href: filesHref({}) },
            { id: "lessons", label: "What agents learned", icon: "spark", href: filesHref({ tab: "lessons" }) },
          ]} />`
        : null}
    </div>

    ${searching
      ? html`<${Section} title="Found in your files"><${SearchResults} term=${term} folder=${folder} /><//>`
      : tab === "lessons" && !folder
        ? html`<${Section} title="What agents have learned"><${Lessons} /><//>`
        : badFolder
          ? html`<${Empty} title="There is no folder of that name."><${Button} href="#/files" icon="arrow-left">All files<//><//>`
          : folder
            ? html`<${FolderView} key=${`${folder}-${folderKey}`} id=${folder} brain=${brain.data} onChanged=${reloadAll} />`
            : brain.loading && !brain.data
              ? html`<${Loading} lines=${4} label="Loading your files" />`
              : brain.data
                ? html`
                  <${Section} title="Folders" count=${folders.length}><${Folders} brain=${brain.data} /><//>
                  ${arr(brain.data.recent).length
                    ? html`<${Section} title="Recently changed">
                        <${FileList} files=${sortFiles(arr(brain.data.recent).filter((f) => f && TOKEN.test(str(f.token)))).slice(0, 6)} folder="" grid=${false} />
                      <//>`
                    : null}`
                : null}

    <${Dialog} open=${picking} title="Fill in a form" onClose=${() => setPicking(false)}>
      ${basics.length
        ? html`<ul class="p-files__forms">
            ${basics.map((b) => html`<li key=${b.form} class="p-files__form">
              <${Icon} name="form" />
              <span class="u-grow u-truncate">${cut(b.title, 80)}</span>
              ${b.state === "filled" ? html`<${Tag} tone="ok">Filled<//>` : null}
              <a href=${filesHref({ folder, mode: `form:${b.form}` })} onClick=${() => setPicking(false)}>${b.state === "filled" ? "Edit" : "Fill it in"}</a>
            </li>`)}
          </ul>`
        : html`<p class="u-muted">The forms could not be read yet.</p>`}
    <//>

    <${Dialog} open=${!!wanted} size="lg" title=${wanted ? (formTitle ? `Fill in: ${formTitle}` : NEW_TITLES[wanted.mode]) : ""} onClose=${closeNew}>
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
