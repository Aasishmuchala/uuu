// A sheet of paper (PLAN-3D-ALL D4, U2): what the owner reads and decides sits on it (a decision, a document being
// read, the brief, a dialog with a money or safety sentence). It carries data-surface="paper", so every kit part
// inside takes paper's inks, lines, fields and accent through the tokens, with no change to its own sheet.
// Tables, forms, lists and settings rows are never put on paper.
import { html } from "../vendor/preact-htm.js";
import { cx } from "./util.js";

const TAGS = ["div", "section", "article", "aside"];

// `as` is the element (div, section, article or aside; else div); `label` names it for readers; `wide` lets it
// take the column's whole width instead of a reading measure. Children are placed as given.
export function Sheet({ as, label, wide, children }) {
  const tag = TAGS.includes(as) ? as : "div";
  const named = typeof label === "string" && label !== "";
  return html`<${tag} class=${cx("k-sheet", wide && "k-sheet--wide")} data-surface="paper" aria-label=${named ? label : undefined}>${children}<//>`;
}
