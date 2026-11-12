// A file chosen from this Mac, by a click, the keyboard or a drop. A real <input type="file"> sits behind a glass
// area. The size and the ending are checked first, from what the browser already knows, so a file that is too
// large or of another kind is never read into memory and nothing is sent. Then `onPick({ name, base64, size })`.
import { html, useRef, useState } from "../vendor/preact-htm.js";
import { bytes } from "../lib/format.js";
import { Icon } from "./icon.js";
import { cx, nextId } from "./util.js";

// ".md, .png" or [".md", ".png"] → [".md", ".png"]. Endings only: lower case, a dot, letters and digits.
export function endingsOf(accept) {
  const list = Array.isArray(accept) ? accept : typeof accept === "string" ? accept.split(",") : [];
  return list.map((x) => String(x).trim().toLowerCase()).filter((x) => /^\.[a-z0-9]{1,8}$/.test(x));
}

// The sentence that refuses a file, or null when it may be read. Pure: it looks only at the name and the size.
export function refusePick(file, { accept, maxBytes } = {}) {
  if (!file || typeof file.name !== "string" || !file.name) return "Pick a file first.";
  const endings = endingsOf(accept);
  const name = file.name.toLowerCase();
  if (endings.length && !endings.some((e) => name.endsWith(e) && name.length > e.length)) {
    return "That kind of file cannot be added here.";
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size < 0) return "That file could not be read.";
  if (size === 0) return "That file is empty.";
  const max = Number(maxBytes);
  if (Number.isFinite(max) && max > 0 && size > max) return `That file is too large. The limit is ${bytes(max)}.`;
  return null;
}

// The base64 part of a data: address, as FileReader gives it.
const base64Of = (dataUrl) => {
  const s = String(dataUrl || "");
  const i = s.indexOf(",");
  return i >= 0 ? s.slice(i + 1) : "";
};

export function FilePicker({ accept, maxBytes, onPick, busy, error }) {
  const [id] = useState(() => nextId("k-upload"));
  const [refused, setRefused] = useState(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const endings = endingsOf(accept);
  const off = Boolean(busy || reading);

  const take = (file) => {
    if (!file || off) return;
    const no = refusePick(file, { accept, maxBytes });
    setRefused(no);
    if (no) return;
    const reader = new FileReader();
    setReading(true);
    reader.onload = () => {
      setReading(false);
      if (onPick) onPick({ name: file.name, base64: base64Of(reader.result), size: file.size });
    };
    reader.onerror = () => {
      setReading(false);
      setRefused("That file could not be read.");
    };
    reader.readAsDataURL(file);
  };

  const onChange = (e) => {
    const file = e.target.files && e.target.files[0];
    take(file);
    // The same file may be picked again after a refusal.
    e.target.value = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    take(file);
  };
  const onDragOver = (e) => {
    e.preventDefault();
    if (!over) setOver(true);
  };

  const message = refused || (typeof error === "string" ? error : error && error.message ? String(error.message) : "");
  const limit = Number(maxBytes) > 0 ? `Up to ${bytes(Number(maxBytes))}.` : "";
  return html`<div class=${cx("k-upload", over && "k-upload--over", off && "k-upload--busy", message && "k-upload--error")}
    onDragOver=${onDragOver} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
    <input ref=${input} id=${id} type="file" class="k-upload__input" accept=${endings.join(",") || undefined}
      disabled=${off} aria-describedby=${`${id}-about${message ? ` ${id}-error` : ""}`} onChange=${onChange} />
    <label for=${id} class="k-upload__area">
      <${Icon} name=${off ? "clock" : "upload"} size=${24} class="k-upload__icon" />
      <span class="k-upload__title">${off ? "Reading the file…" : "Choose a file, or drop it here"}</span>
      <span class="k-upload__about" id=${`${id}-about`}>${limit}</span>
    </label>
    ${message
      ? html`<p class="k-upload__error" id=${`${id}-error`} role="alert"><${Icon} name="alert" size=${14} /><span>${message}</span></p>`
      : null}
  </div>`;
}
