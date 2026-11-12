// A company-brain form (CONTRACTS-V3 32.3): its fields in the six kinds, and the check before saving.
// `values` holds one entry per field id: a string for line, text and choice; an array of lines for list;
// an array of "#rrggbb" for colour; an array of { <column id>: string } for rows.
// `onChange(nextValues)` gets the whole set of values after every edit.
import { html, useState } from "../vendor/preact-htm.js";
import { Button } from "./button.js";
import { Field, Select, TextArea, TextInput } from "./fields.js";
import { Icon } from "./icon.js";
import { cx, nextId } from "./util.js";

export const FORM_KINDS = Object.freeze(["line", "text", "list", "rows", "colour", "choice"]);
const LINE_MAX = 200;
const TEXT_MAX = 4000;
const ROWS_MAX = 60;
const LIST_MAX = 40;
const COLOUR_MAX = 5;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const fieldsOf = (form) => arr(form && form.fields).filter((f) => f && typeof f.id === "string" && FORM_KINDS.includes(f.kind));
const maxOf = (f, fallback) => (Number.isInteger(f.max) && f.max > 0 ? f.max : fallback);
const columnsOf = (f) => arr(f.columns).filter((c) => c && typeof c.id === "string");
const filledLines = (v) => arr(v).map(str).map((s) => s.trim()).filter(Boolean);
const filledRows = (f, v) =>
  arr(v).filter((r) => r && typeof r === "object" && columnsOf(f).some((c) => str(r[c.id]).trim()));

// One sentence per field that would not save, or nothing. Pure: the same checks the home server makes, so the
// owner hears about a problem before anything is sent.
export function checkForm(form, values) {
  const v = values && typeof values === "object" ? values : {};
  const errors = {};
  for (const f of fieldsOf(form)) {
    const value = v[f.id];
    let problem = null;
    if (f.kind === "line" || f.kind === "text") {
      const s = str(value).trim();
      const limit = f.kind === "line" ? LINE_MAX : TEXT_MAX;
      if (!s) problem = f.required ? "Fill this in." : null;
      else if (f.kind === "line" && /[\r\n]/.test(s)) problem = "Keep this to one line.";
      else if (s.length > limit) problem = `Keep this to ${limit} characters.`;
    } else if (f.kind === "list") {
      const lines = filledLines(value);
      const max = maxOf(f, LIST_MAX);
      if (!lines.length) problem = f.required ? "Fill this in: one on each line." : null;
      else if (lines.length > max) problem = `Give at most ${max}, one on each line.`;
      else if (lines.some((l) => l.length > LINE_MAX)) problem = `Keep each line to ${LINE_MAX} characters.`;
    } else if (f.kind === "rows") {
      const rows = filledRows(f, value);
      if (!rows.length) problem = f.required ? "Add at least one row." : null;
      else if (rows.length > ROWS_MAX) problem = `Keep this to ${ROWS_MAX} rows.`;
      else if (rows.some((r) => columnsOf(f).some((c) => str(r[c.id]).trim().length > LINE_MAX))) problem = `Keep each box to ${LINE_MAX} characters.`;
    } else if (f.kind === "colour") {
      const list = filledLines(value);
      const max = maxOf(f, COLOUR_MAX);
      if (!list.length) problem = f.required ? "Add at least one colour." : null;
      else if (list.length > max) problem = `Give at most ${max} colours.`;
      else if (!list.every((c) => COLOUR.test(c))) problem = "Write each colour as # and six letters or numbers, such as #2f6f5e.";
    } else if (f.kind === "choice") {
      const s = str(value);
      if (!s) problem = f.required ? "Pick one." : null;
      else if (!arr(f.options).includes(s)) problem = "Pick one of the choices.";
    }
    if (problem) errors[f.id] = problem;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

function ListField({ f, value, error, set }) {
  const max = maxOf(f, LIST_MAX);
  const hint = [str(f.hint), `One on each line, at most ${max}.`].filter(Boolean).join(" ");
  return html`<${Field} label=${f.label} hint=${hint} error=${error}>
    <${TextArea} autoGrow value=${arr(value).map(str).join("\n")} required=${!!f.required}
      onInput=${(e) => set(String(e.target.value).split("\n"))} />
  <//>`;
}

function Fieldset({ f, error, hint, children }) {
  const [id] = useState(() => nextId("k-form"));
  return html`<fieldset class=${cx("k-form__set", error && "k-form__set--error")} aria-describedby=${cx(hint && `${id}-hint`, error && `${id}-error`) || undefined}>
    <legend class="k-form__legend">${f.label}${f.required ? null : html` <span class="k-form__optional">(optional)</span>`}</legend>
    ${children}
    ${hint ? html`<p class="k-form__hint" id=${`${id}-hint`}>${hint}</p>` : null}
    ${error ? html`<p class="k-form__error" id=${`${id}-error`}><${Icon} name="alert" size=${14} /><span>${error}</span></p>` : null}
  </fieldset>`;
}

function RowsField({ f, value, error, set }) {
  const cols = columnsOf(f);
  const rows = arr(value).filter((r) => r && typeof r === "object");
  const shown = rows.length ? rows : [{}];
  const put = (i, col, text) => set(shown.map((r, j) => (j === i ? { ...r, [col]: text } : r)));
  // The table knows its own width: when its columns do not fit, each row becomes a small card with a label over
  // each box, so no column is out of sight (M52 F3). `--k-form-cols` sizes the columns when they do fit.
  const fits = Math.min(Math.max(cols.length, 1), 6);
  return html`<${Fieldset} f=${f} error=${error} hint=${str(f.hint) || null}>
    <div class="k-form__rows-box">
    <div class=${`k-form__rows k-form__rows--c${fits}`} role="table" aria-label=${f.label}>
      <div class="k-form__row k-form__row--head" role="row">
        ${cols.map((c) => html`<span key=${c.id} class="k-form__cell" role="columnheader">${c.label}</span>`)}
        <span class="k-form__cell k-form__cell--tool" role="columnheader"><span class="k-sr">Remove</span></span>
      </div>
      ${shown.map((r, i) => html`<div key=${i} class="k-form__row" role="row">
        ${cols.map((c) => html`<span key=${c.id} class="k-form__cell" role="cell">
          <span class="k-form__cell-label" aria-hidden="true">${c.label}</span>
          <input type="text" class="k-input" maxlength=${LINE_MAX} aria-label=${`${c.label}, row ${i + 1}`}
            value=${str(r[c.id])} onInput=${(e) => put(i, c.id, String(e.target.value))} />
        </span>`)}
        <span class="k-form__cell k-form__cell--tool" role="cell">
          <${Button} variant="quiet" size="sm" icon="cross" aria-label=${`Remove row ${i + 1}`}
            onClick=${() => set(shown.filter((_, j) => j !== i))} />
        </span>
      </div>`)}
    </div>
    </div>
    <div class="k-form__more">
      <${Button} size="sm" icon="plus" disabled=${shown.length >= ROWS_MAX} onClick=${() => set([...shown, {}])}>Add a row<//>
    </div>
  <//>`;
}

function ColourField({ f, value, error, set }) {
  const max = maxOf(f, COLOUR_MAX);
  const list = arr(value).map(str);
  const shown = list.length ? list : [""];
  const put = (i, c) => set(shown.map((x, j) => (j === i ? c : x)));
  const hint = [str(f.hint), `Up to ${max}.`].filter(Boolean).join(" ");
  return html`<${Fieldset} f=${f} error=${error} hint=${hint}>
    <div class="k-form__colours">
      ${shown.map((c, i) => html`<div key=${i} class="k-form__colour">
        <input type="color" class="k-form__swatch" aria-label=${`Colour ${i + 1}, picker`}
          value=${COLOUR.test(c) ? c.toLowerCase() : "#000000"} onInput=${(e) => put(i, String(e.target.value))} />
        <input type="text" class="k-input k-form__hex" maxlength="7" spellcheck="false" aria-label=${`Colour ${i + 1}`}
          placeholder="#2f6f5e" value=${c} onInput=${(e) => put(i, String(e.target.value).trim())} />
        <${Button} variant="quiet" size="sm" icon="cross" aria-label=${`Remove colour ${i + 1}`}
          onClick=${() => set(shown.filter((_, j) => j !== i))} />
      </div>`)}
    </div>
    <div class="k-form__more">
      <${Button} size="sm" icon="plus" disabled=${shown.length >= max} onClick=${() => set([...shown, ""])}>Add a colour<//>
    </div>
  <//>`;
}

export function FormFields({ form, values, onChange, errors }) {
  const v = values && typeof values === "object" ? values : {};
  const errs = errors && typeof errors === "object" ? errors : {};
  const set = (id) => (next) => onChange && onChange({ ...v, [id]: next });
  return html`<div class="k-form">
    ${fieldsOf(form).map((f) => {
      const error = typeof errs[f.id] === "string" ? errs[f.id] : null;
      const label = f.required ? f.label : `${f.label} (optional)`;
      const hint = str(f.hint) || null;
      if (f.kind === "line") {
        return html`<${Field} key=${f.id} label=${label} hint=${hint} error=${error}>
          <${TextInput} value=${str(v[f.id])} maxlength=${LINE_MAX} required=${!!f.required} onInput=${(e) => set(f.id)(String(e.target.value))} />
        <//>`;
      }
      if (f.kind === "text") {
        return html`<${Field} key=${f.id} label=${label} hint=${hint} error=${error}>
          <${TextArea} autoGrow value=${str(v[f.id])} maxlength=${TEXT_MAX} required=${!!f.required} onInput=${(e) => set(f.id)(String(e.target.value))} />
        <//>`;
      }
      if (f.kind === "choice") {
        const options = [{ value: "", label: "Not chosen" }, ...arr(f.options).filter((o) => typeof o === "string").map((o) => ({ value: o, label: o }))];
        return html`<${Field} key=${f.id} label=${label} hint=${hint} error=${error}>
          <${Select} value=${str(v[f.id])} options=${options} onChange=${(e) => set(f.id)(String(e.target.value))} />
        <//>`;
      }
      if (f.kind === "list") return html`<${ListField} key=${f.id} f=${{ ...f, label }} value=${v[f.id]} error=${error} set=${set(f.id)} />`;
      if (f.kind === "rows") return html`<${RowsField} key=${f.id} f=${f} value=${v[f.id]} error=${error} set=${set(f.id)} />`;
      return html`<${ColourField} key=${f.id} f=${f} value=${v[f.id]} error=${error} set=${set(f.id)} />`;
    })}
  </div>`;
}
