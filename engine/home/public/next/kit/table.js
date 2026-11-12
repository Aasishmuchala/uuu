// A plain data table that stacks into labelled rows below 860 px, and a row of figures. CONTRACTS-V2 13.2.
import { html } from "../vendor/preact-htm.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

// columns: [{ key, label }]; rows: objects; renderCell(row, column) may return a node, else row[key] is shown as text.
export function DataTable({ columns = [], rows = [], emptyText = "Nothing to show yet.", renderCell }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return html`<p class="k-table k-table--empty">${text(emptyText)}</p>`;
  const cell = (row, col) => {
    if (renderCell) {
      const out = renderCell(row, col);
      if (out !== undefined) return out;
    }
    return text(row ? row[col.key] : "");
  };
  return html`<div class="k-table">
    <table class="k-table__table">
      <thead><tr>${columns.map((c) => html`<th scope="col">${text(c.label)}</th>`)}</tr></thead>
      <tbody>
        ${list.map((row, i) => html`<tr key=${row && row.id !== undefined ? row.id : i}>
          ${columns.map((c) => html`<td data-label=${text(c.label)}>${cell(row, c)}</td>`)}
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
export const glueValue = (v) => text(v).replace(/(^|\s)([₹$€£]|Rs\.?)\s+(?=[-\d])/g, "$1$2\u00a0");

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
