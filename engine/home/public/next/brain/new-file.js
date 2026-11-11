// A new file in the company brain (CONTRACTS-V3 30 "Files", 32.3, 33.6). The Files page shows it for its
// address `?new=<mode>`:
//   paste        a folder, a name and the text                               POST /api/brain/files { folder, name, text }
//   upload       a folder and a file from this Mac, within GET /api/brain's limits   POST /api/brain/files { folder, name, base64 }
//   form         the forms to choose from; each one is the address `?new=form:<id>`
//   form:<id>    the form's questions (GET /api/brain/forms/<id>), saved with its version   POST /api/brain/forms/<id>
// Nothing typed is lost: what is being typed lives in this component and in the tab's session storage until it
// is saved, so a refusal, a refresh of the page's data or a reload of the tab keeps it. The form is read once,
// never on a timer. Every refusal of the server is shown in the server's own words beside the field it is
// about; the one exception is a stale version, which shows the pinned sentence of CONTRACTS 9.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes } from "../lib/format.js";
import { Button, Empty, Field, FilePicker, FormFields, Icon, Loading, Notice, Select, TextArea, TextInput, checkForm } from "../kit/index.js";

// The folders of 32.1, used until GET /api/brain answers (and when it cannot).
export const FOLDERS = Object.freeze([
  { id: "company", title: "Company basics", about: "What the company does, for whom, where." },
  { id: "brand", title: "Brand", about: "How the company looks and sounds, and what it never says." },
  { id: "pricing", title: "Prices and services", about: "What is sold, at what price, on what terms." },
  { id: "policies", title: "Policies", about: "Refunds, warranty, support hours, how things are done." },
  { id: "people", title: "People", about: "Who is who." },
  { id: "customers", title: "Customers", about: "Who the company sells to." },
  { id: "calls", title: "Calls and meetings", about: "Notes and transcripts you add." },
  { id: "references", title: "References", about: "Examples and pictures you collect." },
  { id: "packs", title: "Packs", about: "One page per kind of output: its shape, length and rules." },
  { id: "loose", title: "Loose files", about: "Files directly in the brain, outside every folder." },
]);
const FOLDER_IDS = FOLDERS.map((f) => f.id);

// The nine basics of 32.3: where each form saves. The form file's own folder and file win when they are sound.
export const FORM_FILES = Object.freeze({
  about: "company/about.md",
  brand: "brand/brand.md",
  "cant-say": "brand/cant-say.md",
  services: "pricing/services.md",
  terms: "pricing/terms.md",
  refunds: "policies/refunds.md",
  "support-promise": "policies/support-promise.md",
  team: "people/team.md",
  "ideal-customer": "customers/ideal-customer.md",
});

// Fixed sentences.
export const STALE = "This changed after you looked at it. Nothing was done.";
export const STALE_NEXT = "Your answers are still here. Load the saved file to see what changed, or save yours over it.";
export const FORM_NOTE = "Only you know these facts. Agents never fill them in.";

const TEXT_ENDINGS = [".md", ".txt", ".csv"];
const IMAGE_ENDINGS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const NAME_MAX = 100;
const DEFAULT_LIMITS = Object.freeze({ imageBytes: 10485760, textBytes: 2097152, endings: [...TEXT_ENDINGS, ...IMAGE_ENDINGS, ".pdf"] });
const FORM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DRAFT_PREFIX = "uuu.brain.new.";

const str = (v) => (typeof v === "string" ? v : "");
const isFolder = (id) => typeof id === "string" && FOLDER_IDS.includes(id);

// "paste" | "upload" | "form" | "form:<id>" → { kind, form } or null for anything else.
export function parseMode(mode) {
  const m = str(mode).trim();
  if (m === "paste" || m === "upload" || m === "form") return { kind: m, form: null };
  if (m.startsWith("form:") && FORM_ID.test(m.slice(5))) return { kind: "form", form: m.slice(5) };
  return null;
}

// The Files page's address for a flow, inside a folder when one is given.
export function newHref(mode, folder) {
  const where = isFolder(folder) ? `#/files/${folder}` : "#/files";
  return parseMode(mode) ? `${where}?new=${mode}` : where;
}

// The address that opens a file of the brain on the Files page.
export const fileHref = (token) => `#/files?file=${encodeURIComponent(str(token))}`;

// A name the store will take: no folder parts, no control characters, no leading dot, at most 100 characters.
// Pasted text without one of the text endings becomes a Markdown file.
export function cleanName(name, kind = "paste") {
  let s = str(name).replace(/[\u0000-\u001f\u007f/\\:]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "");
  if (!s) return "";
  const lower = s.toLowerCase();
  if (kind === "paste" && !TEXT_ENDINGS.some((e) => lower.endsWith(e) && lower.length > e.length)) s = `${s}.md`;
  if (s.length > NAME_MAX) {
    const dot = s.lastIndexOf(".");
    const ending = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : "";
    s = `${s.slice(0, NAME_MAX - ending.length).trim()}${ending}`;
  }
  return s;
}

// Where a form saves: { folder, file, path }. Null for a form the brain does not know.
export function formTarget(form, id) {
  const f = form && typeof form === "object" ? form : {};
  const name = str(f.file);
  if (isFolder(f.folder) && f.folder !== "loose" && /^[^./\\][^/\\]{0,99}$/.test(name)) {
    return { folder: f.folder, file: name, path: `${f.folder}/${name}` };
  }
  const path = FORM_FILES[str(f.id) || str(id)];
  if (!path) return null;
  const [folder, file] = path.split("/");
  return { folder, file, path };
}

// The biggest file of each kind GET /api/brain allows, by the file's ending (a PDF is held to the image limit).
export function limitFor(name, limits) {
  const l = { ...DEFAULT_LIMITS, ...(limits && typeof limits === "object" ? limits : {}) };
  const lower = str(name).toLowerCase();
  return TEXT_ENDINGS.some((e) => lower.endsWith(e)) ? Number(l.textBytes) : Number(l.imageBytes);
}

const utf8Size = (text) => new TextEncoder().encode(str(text)).length;

// What a flow sends: { method, path, body }. `input` is what the owner typed or picked.
export function requestFor(mode, input) {
  const m = parseMode(mode);
  const i = input && typeof input === "object" ? input : {};
  if (!m) return null;
  if (m.kind === "paste") return { method: "POST", path: "/api/brain/files", body: { folder: str(i.folder), name: cleanName(i.name, "paste"), text: str(i.text) } };
  if (m.kind === "upload") return { method: "POST", path: "/api/brain/files", body: { folder: str(i.folder), name: cleanName(i.name, "upload"), base64: str(i.base64) } };
  if (m.form) {
    const version = i.version === undefined || i.version === null || i.version === "" ? null : String(i.version);
    return { method: "POST", path: `/api/brain/forms/${encodeURIComponent(m.form)}`, body: { values: i.values && typeof i.values === "object" ? i.values : {}, version } };
  }
  return null;
}

// What must be put right before anything is sent: { <field>: sentence }. Empty when it may be sent.
export function checkNew(kind, input, limits) {
  const i = input && typeof input === "object" ? input : {};
  const out = {};
  if (!isFolder(i.folder)) out.folder = "Pick a folder.";
  if (kind === "paste") {
    if (!cleanName(i.name, "paste")) out.name = "Give it a name.";
    if (!str(i.text).trim()) out.text = "Paste or type the text.";
    else if (utf8Size(i.text) > limitFor(".md", limits)) out.text = `That text is too long. The limit is ${bytes(limitFor(".md", limits))}.`;
  } else if (kind === "upload") {
    if (!str(i.base64)) out.file = "Pick a file first.";
    else if (Number(i.size) > limitFor(i.pickedName || i.name, limits)) out.file = `That file is too large. The limit is ${bytes(limitFor(i.pickedName || i.name, limits))}.`;
    if (str(i.base64) && !cleanName(i.name, "upload")) out.name = "Give it a name.";
  }
  return out;
}

// The field a refusal of POST /api/brain/files is about.
const FILE_FIELDS = {
  paste: { name_type: "name", file_exists: "name", kind_mismatch: "text", too_large: "text", folder_not_found: "folder" },
  upload: { name_type: "name", file_exists: "name", kind_mismatch: "file", too_large: "file", folder_not_found: "folder" },
};

// The field of a form a sentence of the server names: the one whose label it contains (the longest such label).
export function fieldOfMessage(form, message) {
  const text = str(message).toLowerCase();
  let best = null;
  for (const f of Array.isArray(form && form.fields) ? form.fields : []) {
    const label = str(f && f.label).toLowerCase().replace(/[?.:]+$/, "").trim();
    if (label && text.includes(label) && (!best || label.length > best.len)) best = { id: f.id, len: label.length };
  }
  return best ? best.id : null;
}

// A refusal as the owner reads it: { field, message, next, stale }. `field` is null when it is about the whole.
export function refusalOf(error, kind, form) {
  const e = error && typeof error === "object" ? error : {};
  const code = str(e.code);
  if (code === "changed_since_seen") return { field: null, message: STALE, next: STALE_NEXT, stale: true };
  const message = str(e.message) || "That could not be saved.";
  const next = str(e.next);
  let field = null;
  if (kind === "form") field = code === "bad_value" ? fieldOfMessage(form, message) : null;
  else field = (FILE_FIELDS[kind] && FILE_FIELDS[kind][code]) || null;
  return { field, message, next: field ? "" : next, stale: false };
}

// Where a flow's unsaved typing is kept in the tab's session storage.
export function draftKey(mode, folder) {
  const m = parseMode(mode);
  if (!m) return null;
  return `${DRAFT_PREFIX}${m.form ? `form:${m.form}` : `${m.kind}:${isFolder(folder) ? folder : ""}`}`;
}

function readDraft(key) {
  if (!key || typeof sessionStorage === "undefined") return null;
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function writeDraft(key, value) {
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or closed storage only means a reload would lose the typing; what is on screen stays.
  }
}

// True while the screen is narrower than the tab bar's limit, so a form can be filled one question at a time.
function useNarrow() {
  const query = "(max-width: 859px)";
  const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  const [narrow, setNarrow] = useState(() => Boolean(media && media.matches));
  useEffect(() => {
    if (!media) return undefined;
    const on = () => setNarrow(media.matches);
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);
  return narrow;
}

// GET /api/brain once, for the folders and the limits; the pinned ones stand in until (and unless) it answers.
function useBrainFacts() {
  const [facts, setFacts] = useState({ folders: FOLDERS, limits: DEFAULT_LIMITS, basics: null });
  useEffect(() => {
    let live = true;
    api.get("/api/brain").then((b) => {
      if (!live || !b || typeof b !== "object") return;
      const folders = (Array.isArray(b.folders) ? b.folders : []).filter((f) => f && isFolder(f.id));
      const known = new Set(folders.map((f) => f.id));
      setFacts({
        folders: folders.length ? [...folders, ...FOLDERS.filter((f) => !known.has(f.id))] : FOLDERS,
        limits: b.limits && typeof b.limits === "object" ? { ...DEFAULT_LIMITS, ...b.limits } : DEFAULT_LIMITS,
        basics: b.basics && Array.isArray(b.basics.items) ? b.basics.items : null,
      });
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return facts;
}

function Problem({ refusal }) {
  if (!refusal || refusal.field) return null;
  return html`<div class="p-brain__problem" role="alert">
    <${Notice} tone=${refusal.stale ? "warn" : "bad"} title=${refusal.message}>${refusal.next || null}<//>
  </div>`;
}

function FolderField({ folders, value, error, onChange }) {
  const chosen = folders.find((f) => f.id === value);
  const options = [{ value: "", label: "Choose a folder" }, ...folders.map((f) => ({ value: f.id, label: str(f.title) || f.id }))];
  return html`<${Field} label="Folder" hint=${chosen ? str(chosen.about) || null : null} error=${error || null}>
    <${Select} value=${value} options=${options} onChange=${(e) => onChange(String(e.target.value))} />
  <//>`;
}

function Head({ over, title, lead }) {
  return html`<div class="p-brain__head">
    <p class="p-brain__over">${over}</p>
    <h2 class="p-brain__title">${title}</h2>
    ${lead ? html`<p class="p-brain__lead">${lead}</p>` : null}
  </div>`;
}

function Saved({ file, onAnother }) {
  return html`<div class="p-brain__saved" role="status">
    <${Notice} tone="ok" title="Saved to the company brain.">Every agent reads it from now on.<//>
    <div class="p-brain__actions">
      ${file && file.token ? html`<${Button} variant="primary" href=${fileHref(file.token)}>Open it<//>` : null}
      ${onAnother ? html`<${Button} onClick=${onAnother}>Add another<//>` : null}
    </div>
  </div>`;
}

// Paste text: a folder, a name, the text.
function PasteFlow({ folder, onDone, facts }) {
  const key = draftKey("paste", folder);
  const [draft, setDraft] = useState(() => ({ folder: isFolder(folder) ? folder : "", name: "", text: "", ...(readDraft(key) || {}) }));
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const { announce } = useApp();

  const put = (k) => (v) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    writeDraft(key, next);
    if (errors[k]) setErrors({ ...errors, [k]: null });
  };

  const save = async (event) => {
    if (event) event.preventDefault();
    const local = checkNew("paste", draft, facts.limits);
    setErrors(local);
    setRefusal(null);
    if (Object.keys(local).length) return;
    const req = requestFor("paste", draft);
    setBusy(true);
    try {
      const res = await api.post(req.path, req.body);
      writeDraft(key, null);
      setDraft({ folder: draft.folder, name: "", text: "" });
      setSaved(res && res.file ? res.file : {});
      if (announce) announce("Saved to the company brain.");
      if (onDone) onDone(res && res.file ? res.file : null);
    } catch (error) {
      const r = refusalOf(error, "paste");
      if (r.field) setErrors({ [r.field]: r.message });
      setRefusal(r);
    } finally {
      setBusy(false);
    }
  };

  if (saved) return html`<${Saved} file=${saved} onAnother=${() => setSaved(null)} />`;
  const shownName = cleanName(draft.name, "paste");
  return html`<form class="p-brain__flow" onSubmit=${save} novalidate>
    <${Head} over="Paste text" title="Add text to the company brain" lead="Notes, a price list, an email you want agents to know about. It is saved as a file you can change later." />
    <${FolderField} folders=${facts.folders} value=${draft.folder} error=${errors.folder} onChange=${put("folder")} />
    <${Field} label="Name" hint=${shownName && shownName !== draft.name.trim() ? `Saved as ${shownName}` : "Such as: Call with a new customer"} error=${errors.name || null}>
      <${TextInput} value=${draft.name} maxlength=${NAME_MAX} onInput=${(e) => put("name")(String(e.target.value))} />
    <//>
    <${Field} label="Text" hint="Plain text. Headings and lists in Markdown are kept as they are." error=${errors.text || null}>
      <${TextArea} autoGrow value=${draft.text} rows=${8} onInput=${(e) => put("text")(String(e.target.value))} />
    <//>
    <${Problem} refusal=${refusal} />
    <div class="p-brain__actions">
      <${Button} type="submit" variant="primary" busy=${busy}>Save<//>
      <${Button} variant="quiet" href=${newHref("", folder)} onClick=${() => writeDraft(key, null)}>Cancel<//>
    </div>
  </form>`;
}

// Add a file: a folder and a file from this Mac.
function UploadFlow({ folder, onDone, facts }) {
  const key = draftKey("upload", folder);
  const [draft, setDraft] = useState(() => ({ folder: isFolder(folder) ? folder : "", ...(readDraft(key) || {}) }));
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const { announce } = useApp();
  const limits = facts.limits;
  const most = Math.max(Number(limits.imageBytes) || 0, Number(limits.textBytes) || 0) || DEFAULT_LIMITS.imageBytes;

  const setFolder = (v) => {
    const next = { ...draft, folder: v };
    setDraft(next);
    writeDraft(key, next);
    if (errors.folder) setErrors({ ...errors, folder: null });
  };
  const pick = (file) => {
    setRefusal(null);
    const p = { pickedName: file.name, base64: file.base64, size: file.size };
    const tooBig = Number(file.size) > limitFor(file.name, limits);
    setPicked(tooBig ? null : p);
    setName(tooBig ? "" : cleanName(file.name, "upload"));
    setErrors(tooBig ? { file: `That file is too large. The limit is ${bytes(limitFor(file.name, limits))}.` } : {});
  };

  const save = async (event) => {
    if (event) event.preventDefault();
    const input = { folder: draft.folder, name, ...(picked || {}) };
    const local = checkNew("upload", input, limits);
    setErrors(local);
    setRefusal(null);
    if (Object.keys(local).length) return;
    const req = requestFor("upload", input);
    setBusy(true);
    try {
      const res = await api.post(req.path, req.body);
      writeDraft(key, null);
      setPicked(null);
      setName("");
      setSaved(res && res.file ? res.file : {});
      if (announce) announce("Saved to the company brain.");
      if (onDone) onDone(res && res.file ? res.file : null);
    } catch (error) {
      const r = refusalOf(error, "upload");
      if (r.field) setErrors({ [r.field]: r.message });
      setRefusal(r);
    } finally {
      setBusy(false);
    }
  };

  if (saved) return html`<${Saved} file=${saved} onAnother=${() => setSaved(null)} />`;
  const endings = Array.isArray(limits.endings) ? limits.endings : DEFAULT_LIMITS.endings;
  return html`<form class="p-brain__flow" onSubmit=${save} novalidate>
    <${Head} over="Add a file" title="Add a file to the company brain"
      lead=${`Text, tables, pictures and PDF files. Text and tables up to ${bytes(limits.textBytes)}, pictures and PDF files up to ${bytes(limits.imageBytes)}. Search does not look inside PDF files.`} />
    <${FolderField} folders=${facts.folders} value=${draft.folder} error=${errors.folder} onChange=${setFolder} />
    <div class="p-brain__pick">
      <${FilePicker} accept=${endings} maxBytes=${most} busy=${busy} error=${errors.file || null} onPick=${pick} />
      ${picked ? html`<p class="p-brain__picked"><${Icon} name="file" size=${14} /><span>${picked.pickedName} · ${bytes(picked.size)}</span></p>` : null}
    </div>
    ${picked
      ? html`<${Field} label="Save as" hint="A name that is already in the folder is never replaced." error=${errors.name || null}>
          <${TextInput} value=${name} maxlength=${NAME_MAX} onInput=${(e) => { setName(String(e.target.value)); if (errors.name) setErrors({ ...errors, name: null }); }} />
        <//>`
      : null}
    <${Problem} refusal=${refusal} />
    <div class="p-brain__actions">
      <${Button} type="submit" variant="primary" busy=${busy} disabled=${!picked}>Add<//>
      <${Button} variant="quiet" href=${newHref("", folder)} onClick=${() => writeDraft(key, null)}>Cancel<//>
    </div>
  </form>`;
}

// Fill in a form: the list of forms to choose from.
function FormChoice({ folder, facts }) {
  const items = Array.isArray(facts.basics)
    ? facts.basics.filter((b) => b && FORM_ID.test(str(b.form)))
    : Object.keys(FORM_FILES).map((form) => ({ form, title: form, state: null }));
  const order = isFolder(folder) ? [...items.filter((b) => str(b.file).startsWith(`${folder}/`)), ...items.filter((b) => !str(b.file).startsWith(`${folder}/`))] : items;
  return html`<div class="p-brain__flow">
    <${Head} over="Fill in a form" title="Which basic do you want to fill in?" lead=${FORM_NOTE} />
    <ul class="p-brain__forms">
      ${order.map((b) => html`<li key=${b.form}>
        <a class="p-brain__form-link" href=${newHref(`form:${b.form}`, folder)}>
          <${Icon} name="form" size=${16} />
          <span class="p-brain__form-title">${str(b.title) || b.form}</span>
          <span class="p-brain__form-state">${b.state === "filled" ? "Filled" : b.state ? "Not filled in yet" : ""}</span>
          <${Icon} name="chevron-right" size=${16} />
        </a>
      </li>`)}
    </ul>
  </div>`;
}

// Fill in one form, saved with the version it was read at.
function FormFlow({ id, folder, onDone }) {
  const mode = `form:${id}`;
  const key = draftKey(mode, folder);
  const [load, setLoad] = useState({ loading: true, error: null, data: null });
  const [values, setValues] = useState(null);
  const [fromDraft, setFromDraft] = useState(false);
  const [version, setVersion] = useState(null);
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [step, setStep] = useState(0);
  const [allAtOnce, setAllAtOnce] = useState(false);
  const narrow = useNarrow();
  const { announce } = useApp();
  const top = useRef(null);

  // Reads the form. With `keepTyping` the owner's values stay and only the version is taken (for "save mine over it").
  const read = async (keepTyping) => {
    if (!keepTyping) setLoad((l) => ({ ...l, loading: true, error: null }));
    const data = await api.get(`/api/brain/forms/${encodeURIComponent(id)}`);
    setVersion(data && data.version !== undefined ? data.version : null);
    if (!keepTyping) {
      const draft = readDraft(key);
      const kept = draft && draft.values && typeof draft.values === "object" ? draft.values : null;
      setValues(kept || (data && data.values && typeof data.values === "object" ? data.values : {}));
      setFromDraft(Boolean(kept));
      setLoad({ loading: false, error: null, data });
    }
    return data;
  };
  const first = () => read(false).catch((error) => setLoad({ loading: false, error, data: null }));
  useEffect(() => { first(); }, [id]);

  const form = load.data && load.data.form && typeof load.data.form === "object" ? load.data.form : null;
  const fields = form && Array.isArray(form.fields) ? form.fields : [];
  const stepped = narrow && !allAtOnce && fields.length > 1;
  const at = Math.min(step, Math.max(fields.length - 1, 0));

  const change = (next) => {
    setValues(next);
    writeDraft(key, { values: next });
    const cleared = { ...errors };
    for (const f of fields) if (cleared[f.id] && JSON.stringify(next[f.id]) !== JSON.stringify(values && values[f.id])) cleared[f.id] = null;
    setErrors(cleared);
  };

  const post = async (withVersion) => {
    const req = requestFor(mode, { values, version: withVersion });
    setBusy(true);
    setRefusal(null);
    try {
      const res = await api.post(req.path, req.body);
      writeDraft(key, null);
      setFromDraft(false);
      setSaved({ file: res && res.file ? res.file : null, state: res && res.state });
      if (announce) announce("Saved to the company brain.");
      if (onDone) onDone(res && res.file ? res.file : null);
    } catch (error) {
      const r = refusalOf(error, "form", form);
      if (r.field) {
        setErrors({ [r.field]: r.message });
        const i = fields.findIndex((f) => f.id === r.field);
        if (i >= 0) setStep(i);
      }
      setRefusal(r);
    } finally {
      setBusy(false);
    }
  };

  const save = (event) => {
    if (event) event.preventDefault();
    // In the one-question-at-a-time view, Enter on a question that is not the last moves on.
    if (stepped && at < fields.length - 1) {
      nextStep();
      return;
    }
    const checked = checkForm(form, values);
    setErrors(checked.errors);
    setRefusal(null);
    if (!checked.ok) {
      const i = fields.findIndex((f) => checked.errors[f.id]);
      if (i >= 0) setStep(i);
      return;
    }
    post(version);
  };

  // "Save mine over it": the saved file's version is read again; the owner's answers stay as they are.
  const overwrite = async () => {
    try {
      const data = await read(true);
      await post(data && data.version !== undefined ? data.version : null);
    } catch (error) {
      setRefusal(refusalOf(error, "form", form));
    }
  };
  // "Load the saved file": the owner's unsaved answers are dropped for what is saved now.
  const reload = () => {
    writeDraft(key, null);
    setErrors({});
    setRefusal(null);
    setStep(0);
    first();
  };

  const nextStep = () => {
    const f = fields[at];
    const one = checkForm({ ...form, fields: [f] }, values);
    if (!one.ok) {
      setErrors({ ...errors, ...one.errors });
      return;
    }
    setStep(at + 1);
    if (top.current && typeof top.current.scrollIntoView === "function") top.current.scrollIntoView({ block: "nearest" });
  };

  if (load.loading && !form) return html`<div class="p-brain__flow"><${Loading} lines=${4} label="Opening the form" /></div>`;
  if (load.error && !form) {
    if (load.error.status === 404) {
      return html`<div class="p-brain__flow"><${Empty} title="There is no such form." text="Pick one of the forms instead.">
        <${Button} href=${newHref("form", folder)}>See the forms<//>
      <//></div>`;
    }
    return html`<div class="p-brain__flow">
      <${Notice} tone="bad" title="The form could not be opened.">${load.error.message}<//>
      <div class="p-brain__actions"><${Button} onClick=${first}>Try again<//></div>
    </div>`;
  }
  if (saved) {
    return html`<div class="p-brain__saved" role="status">
      <${Notice} tone="ok" title="Saved to the company brain.">
        ${saved.state === "filled" ? "This basic is filled. Every agent reads it from now on." : "Saved. Some answers are still missing, so this basic is not filled yet."}
      <//>
      <div class="p-brain__actions">
        ${saved.file && saved.file.token ? html`<${Button} variant="primary" href=${fileHref(saved.file.token)}>Open it<//>` : null}
        <${Button} href=${newHref("form", folder)}>Fill in another<//>
      </div>
    </div>`;
  }

  const target = formTarget(form, id);
  const shown = stepped ? { ...form, fields: [fields[at]] } : form;
  const unknown = Array.isArray(load.data && load.data.unknown) ? load.data.unknown.length : 0;
  return html`<form class="p-brain__flow" onSubmit=${save} novalidate>
    <div ref=${top}><${Head} over="Fill in a form" title=${str(form.title) || "A form"} lead=${str(form.lead)} /></div>
    <p class="p-brain__note"><${Icon} name="lock" size=${14} /><span>${FORM_NOTE}</span></p>
    <div class="p-brain__notes">
    ${target ? html`<p class="p-brain__where">Saved in ${(FOLDERS.find((f) => f.id === target.folder) || {}).title || target.folder}.${load.data && load.data.exists ? " It replaces what this form saved before." : ""}</p>` : null}
    ${fromDraft ? html`<p class="p-brain__where">These are the answers you had not saved yet.</p>` : null}
    ${unknown ? html`<p class="p-brain__where">The file also has parts this form does not show. They are kept as they are.</p>` : null}
    </div>
    ${stepped ? html`<p class="p-brain__step" aria-live="polite">Question ${at + 1} of ${fields.length}</p>` : null}
    <${FormFields} form=${shown} values=${values || {}} errors=${errors} onChange=${change} />
    <${Problem} refusal=${refusal} />
    ${refusal && refusal.stale
      ? html`<div class="p-brain__actions">
          <${Button} variant="primary" busy=${busy} onClick=${overwrite}>Save mine over it<//>
          <${Button} onClick=${reload}>Load the saved file<//>
        </div>`
      : html`<div class="p-brain__actions">
          ${stepped && at > 0 ? html`<${Button} icon="arrow-left" onClick=${() => setStep(at - 1)}>Back<//>` : null}
          ${stepped && at < fields.length - 1
            ? html`<${Button} variant="primary" onClick=${nextStep}>Next<//>`
            : html`<${Button} type="submit" variant="primary" busy=${busy}>Save<//>`}
          <${Button} variant="quiet" href=${newHref("", folder)}>Cancel<//>
        </div>`}
    ${narrow && fields.length > 1
      ? html`<button type="button" class="p-brain__toggle" onClick=${() => setAllAtOnce(!allAtOnce)}>${stepped ? "Show every question at once" : "One question at a time"}</button>`
      : null}
  </form>`;
}

// The three ways in, for an address the flows do not know.
function Choices({ folder }) {
  const ways = [
    { mode: "form", icon: "form", title: "Fill in a form", text: "Answer a few questions about your company." },
    { mode: "paste", icon: "file", title: "Paste text", text: "Notes, a price list, an email." },
    { mode: "upload", icon: "upload", title: "Add a file", text: "Text, a table, a picture or a PDF file from this Mac." },
  ];
  return html`<div class="p-brain__flow">
    <${Head} over="New" title="Add to the company brain" />
    <ul class="p-brain__forms">
      ${ways.map((w) => html`<li key=${w.mode}>
        <a class="p-brain__form-link" href=${newHref(w.mode, folder)}>
          <${Icon} name=${w.icon} size=${16} />
          <span class="p-brain__form-title">${w.title}<span class="p-brain__form-text">${w.text}</span></span>
          <${Icon} name="chevron-right" size=${16} />
        </a>
      </li>`)}
    </ul>
  </div>`;
}

export function NewFile({ mode, folder, onDone }) {
  const m = parseMode(mode);
  const facts = useBrainFacts();
  let body;
  if (!m) body = html`<${Choices} folder=${folder} />`;
  else if (m.kind === "paste") body = html`<${PasteFlow} folder=${folder} onDone=${onDone} facts=${facts} />`;
  else if (m.kind === "upload") body = html`<${UploadFlow} folder=${folder} onDone=${onDone} facts=${facts} />`;
  else if (m.form) body = html`<${FormFlow} key=${m.form} id=${m.form} folder=${folder} onDone=${onDone} />`;
  else body = html`<${FormChoice} folder=${folder} facts=${facts} />`;
  return html`<section class="p-brain p-brain--new" aria-label="Add to the company brain">${body}</section>`;
}
