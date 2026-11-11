// Docs: the company documents agents read before they work, a search over them, and what each role has learned.
import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { bytes } from "../lib/format.js";
import { useApp } from "../lib/context.js";
import {
  Button, Card, Empty, ErrorNotice, Field, Loading, Notice, PageHeader, Section, TextArea, TextInput, Time,
} from "../kit/index.js";

const MAX_READ = 2 * 1024 * 1024;
const MAX_SHOWN = 200000;

// Keeps letters, digits, space, ".", "_" and "-"; adds ".md" when there is no ending.
export function cleanName(name) {
  let n = String(name ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  n = n.replace(/^\.+/, "");
  if (!n) return "";
  if (!/\.[A-Za-z0-9]+$/.test(n)) n += ".md";
  return n;
}

// True for a .txt or .md file under 2 MB.
export function canRead(file) {
  if (!file || typeof file.name !== "string") return false;
  const size = Number(file.size);
  return /\.(txt|md)$/i.test(file.name) && Number.isFinite(size) && size >= 0 && size < MAX_READ;
}

function Search() {
  const [q, setQ] = useState("");
  const term = q.trim();
  const res = useResource(term.length >= 2 ? `/api/knowledge/search?q=${encodeURIComponent(term)}` : null);
  const results = res.data?.results || [];
  return html`
    <${Section} title="Search the documents">
      <${Field} label="Search">
        <${TextInput} type="search" value=${q} maxLength=${200} placeholder="Type at least two letters"
          onInput=${(e) => setQ(e.currentTarget.value)} />
      <//>
      ${term.length >= 2 && res.loading && !res.data ? html`<${Loading} lines=${2} label="Searching" />` : null}
      <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
      ${term.length >= 2 && res.data && !results.length ? html`<p class="u-muted">Nothing found for "${term}".</p>` : null}
      <ul class="p-docs__results">
        ${results.map((r, i) => html`
          <li key=${i}>
            <a href=${`#/docs?doc=${encodeURIComponent(r.name)}`}>${r.name}</a>
            ${r.snippet ? html`<p class="u-muted u-wrap">${String(r.snippet).slice(0, 400)}</p>` : null}
          </li>`)}
      </ul>
    <//>`;
}

function AddDocument({ onAdded }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fileNote, setFileNote] = useState("");

  const choose = async (e) => {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (!canRead(file)) { setFileNote("Only text files (.txt or .md) under 2 MB can be read."); return; }
    try {
      const body = await file.text();
      setText(body);
      setName(cleanName(file.name));
      setFileNote("");
    } catch {
      setFileNote("That file could not be read.");
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const clean = cleanName(name);
    if (!clean) { setMessage("Give the document a name."); return; }
    if (!text.trim()) { setMessage("Write or paste the document's text."); return; }
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/knowledge", { name: clean, text });
      setName(""); setText("");
      setMessage(`Added ${clean}.`);
      onAdded();
    } catch (err) {
      setMessage(err.message || "The document could not be added.");
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Section} title="Add a document">
      <form class="p-docs__add" onSubmit=${send}>
        <${Field} label="Name" hint="Letters, numbers, spaces, dots and dashes. It ends in .md unless you say otherwise.">
          <${TextInput} value=${name} maxLength=${120} onInput=${(e) => setName(e.currentTarget.value)} />
        <//>
        <${Field} label="Text">
          <${TextArea} value=${text} rows=${10} onInput=${(e) => setText(e.currentTarget.value)} />
        <//>
        <div class="u-row">
          <label class="p-docs__file">
            <span class="k-btn k-btn--plain k-btn--md">Choose a text file</span>
            <input type="file" accept=".txt,.md,text/plain,text/markdown" class="u-visually-hidden" onChange=${choose} />
          </label>
          <${Button} variant="primary" type="submit" busy=${busy}>Add document<//>
        </div>
        ${fileNote ? html`<p class="u-muted" role="status">${fileNote}</p>` : null}
        ${message ? html`<p role="status">${message}</p>` : null}
      </form>
    <//>`;
}

function DocBody({ id }) {
  const res = useResource(`/api/knowledge/doc/${encodeURIComponent(id)}`);
  if (res.loading && !res.data) return html`<${Loading} lines=${3} label="Opening the document" />`;
  if (res.error) return html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  const text = String(res.data?.text ?? "");
  return html`
    <pre class="p-docs__text u-wrap">${text.slice(0, MAX_SHOWN)}</pre>
    ${text.length > MAX_SHOWN ? html`<p class="u-caption">The rest of this long document is not shown here.</p>` : null}`;
}

function DocRow({ doc, open, onToggle, onDeleted }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/knowledge/doc/${encodeURIComponent(doc.id)}`);
      onDeleted(doc);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return html`
    <li class="p-docs__item">
      <div class="p-docs__row">
        <button type="button" class="p-docs__name u-wrap" aria-expanded=${open ? "true" : "false"} onClick=${() => onToggle(doc)}>${doc.name}</button>
        <span class="u-caption">${bytes(doc.size)}</span>
        <${Time} at=${doc.addedAt} />
        ${asking
          ? html`<span class="u-row" role="group" aria-label=${`Delete ${doc.name}`}>
              <span>Delete this document?</span>
              <${Button} variant="danger" size="sm" busy=${busy} onClick=${remove}>Delete<//>
              <${Button} variant="quiet" size="sm" onClick=${() => setAsking(false)}>Keep<//>
            </span>`
          : html`<${Button} variant="quiet" size="sm" onClick=${() => setAsking(true)}>Delete<//>`}
      </div>
      <${ErrorNotice} error=${error} />
      ${open ? html`<div class="p-docs__open"><${DocBody} id=${doc.id} /></div>` : null}
    </li>`;
}

function Lessons() {
  const res = useResource("/api/lessons");
  const roles = res.data?.roles || [];
  return html`
    <${Section} title="What agents have learned">
      ${res.loading && !res.data ? html`<${Loading} lines=${3} />` : null}
      <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
      <div class="p-docs__lessons">
        ${roles.map((r) => {
          const lessons = (r.lessons || []).slice(0, 5);
          return html`
            <${Card} key=${r.slug}>
              <div class="u-spread">
                <strong>${r.name}</strong>
                <a href=${`#/team/${encodeURIComponent(r.slug)}?tab=lessons`}>Edit</a>
              </div>
              ${lessons.length
                ? html`<ul class="p-docs__lesson-list">${lessons.map((l, i) => html`<li key=${i} class="u-wrap">${String(l).slice(0, 300)}</li>`)}</ul>`
                : html`<p class="u-muted">Nothing learned yet.</p>`}
            <//>`;
        })}
      </div>
    <//>`;
}

export default function Page({ route }) {
  const { announce } = useApp();
  const list = useResource("/api/knowledge");
  const [open, setOpen] = useState(route?.query?.get("doc") || "");
  const want = route?.query?.get("doc") || "";
  useEffect(() => { setOpen(want); }, [want]);
  const docs = list.data?.docs || [];

  const toggle = (doc) => {
    const next = open === doc.id ? "" : doc.id;
    setOpen(next);
    try {
      history.replaceState(null, "", next ? `#/docs?doc=${encodeURIComponent(next)}` : "#/docs");
    } catch { /* the address stays as it is */ }
  };

  return html`
    <div class="p-docs">
      <${PageHeader} title="Docs" lead="Company documents that agents read before they work." />
      <${Search} />
      <${AddDocument} onAdded=${() => { list.reload(); announce && announce("Document added."); }} />
      <${Section} title="Documents" count=${docs.length}>
        ${list.loading && !list.data ? html`<${Loading} lines=${3} />` : null}
        <${ErrorNotice} error=${list.error} onRetry=${list.reload} />
        ${list.data && !docs.length ? html`<${Empty} title="No documents yet. Add the first one above." />` : null}
        <ul class="p-docs__list">
          ${docs.map((d) => html`<${DocRow} key=${d.id} doc=${d} open=${open === d.id} onToggle=${toggle}
            onDeleted=${() => { if (open === d.id) setOpen(""); list.reload(); announce && announce("Document deleted."); }} />`)}
        </ul>
      <//>
      <${Lessons} />
    </div>`;
}
