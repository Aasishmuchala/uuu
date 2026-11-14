// A plain data table that stacks into labelled rows below 860 px, and a row of figures. CONTRACTS-V2 13.2.
// Amounts, counts and dates sit at the right in tabular figures, their unit small and grey.
import { html } from "../vendor/preact-htm.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

const AMOUNT = /^[-+−]?(?:[₹$€£]|Rs\.?)?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[A-Za-z]{1,8}))?$/;
const DATE = /^(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?|\d{1,2} [A-Z][a-z]{2}(?: \d{4})?(?:,? \d{1,2}:\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)$/;

// A value that is read as a figure: an amount, a count, a share or a date. Pure.
export function isFigure(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && s.length <= 32 && (AMOUNT.test(s) || DATE.test(s));
}

// A column sits at the right when it says so (`align: "end"` or `numeric: true`), or when every value it has
// is a figure; `align: "start"` keeps it at the left. Pure.
export function numericColumn(col, rows) {
  if (!col) return false;
  if (col.align === "start") return false;
  if (col.align === "end" || col.numeric === true) return true;
  const values = (Array.isArray(rows) ? rows : []).map((r) => (r ? r[col.key] : undefined)).filter((v) => text(v).trim() !== "");
  return values.length > 0 && values.every(isFigure);
}

// "120 credits" → ["120", "credits"]: the figure and its trailing word unit, drawn small. A sign or a "%" stays
// with the figure. Pure.
export function splitUnit(v) {
  const s = text(v).trim();
  const m = /^(.*\d)\s+([A-Za-z]{1,8})$/.exec(s);
  return m && !DATE.test(s) ? [m[1], m[2]] : [s, ""];
}

// columns: [{ key, label, align? }]; rows: objects; renderCell(row, column) may return a node, else row[key] is
// shown as text.
export function DataTable({ columns = [], rows = [], emptyText = "Nothing to show yet.", renderCell }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return html`<p class="k-table k-table--empty">${text(emptyText)}</p>`;
  const cols = (Array.isArray(columns) ? columns : []).map((c) => ({ ...c, num: numericColumn(c, list) }));
  const cell = (row, col) => {
    if (renderCell) {
      const out = renderCell(row, col);
      if (out !== undefined) return out;
    }
    const v = text(row ? row[col.key] : "");
    if (!col.num) return v;
    const [figure, unit] = splitUnit(v);
    return unit ? html`<span class="k-table__figure">${figure} <span class="k-table__unit">${unit}</span></span>` : figure;
  };
  return html`<div class="k-table">
    <table class="k-table__table">
      <thead><tr>${cols.map((c) => html`<th scope="col" class=${c.num ? "k-table__num" : undefined}>${text(c.label)}</th>`)}</tr></thead>
      <tbody>
        ${list.map((row, i) => html`<tr key=${row && row.id !== undefined ? row.id : i}>
          ${cols.map((c) => html`<td data-label=${text(c.label)} class=${c.num ? "k-table__num" : undefined}>${cell(row, c)}</td>`)}
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

// A figure never breaks over two lines (a sum split like "₹ 1,18,000.0 / 0" is easy to misread, M51 F13); a long
// one is drawn smaller instead. Pure: the class for a value.
export function figureClass(v) {
  const n = text(v).length;
  return n > 16 ? "k-figures__value k-figures__value--longer" : n > 9 ? "k-figures__value k-figures__value--long" : "k-figures__value";
}

// figures: [{ id, label, value, hint }]. Values arrive already formatted.
// A currency sign stays on the same line as its number ("₹ 1,18,000.00" never breaks after the sign).
export const glueValue = (v) => text(v).replace(/(^|\s)([₹$€£]|Rs\.?)\s+(?=[-\d])/g, "$1$2 ");

export function Figures({ figures = [] }) {
  const list = Array.isArray(figures) ? figures : [];
  if (list.length === 0) return null;
  return html`<dl class="k-figures">
    ${list.map((f) => html`<div class="k-figures__item" key=${f.id}>
      <dt class="k-figures__label">${text(f.label)}</dt>
      <dd class=${figureClass(f.value)}>${glueValue(f.value)}</dd>
      ${f.hint && html`<dd class="k-figures__hint">${text(f.hint)}</dd>`}
    </div>`)}
  </dl>`;
}
