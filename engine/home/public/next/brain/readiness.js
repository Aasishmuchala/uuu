// The readiness of the company brain (CONTRACTS-V3 30 "Files", 32.4, 33.6): a ring with how many of the nine
// basics are filled, and one row per basic, `Filled` (the row opens the file) or `Fill it in` (its form).
// `brain` is the shape `brain` of GET /api/brain; the Files page reads it and passes it in.
import { html } from "../vendor/preact-htm.js";
import { fileToken } from "../lib/format.js";
import { Icon, Loading, Ring } from "../kit/index.js";

const FORM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TOTAL = 9;
const str = (v) => (typeof v === "string" ? v : "");
const whole = (n) => (Number.isInteger(n) && n >= 0 ? n : null);

// Pure. { filled, total, label, items: [{ form, title, state, filled, href, action }] } from the shape `brain`.
// The count is that of the rows when the rows are there, else the shape's own figure.
export function readinessOf(brain) {
  const basics = brain && typeof brain === "object" && brain.basics && typeof brain.basics === "object" ? brain.basics : {};
  const items = (Array.isArray(basics.items) ? basics.items : [])
    .filter((b) => b && typeof b === "object" && FORM_ID.test(str(b.form)))
    .slice(0, 20)
    .map((b) => {
      const filled = b.state === "filled";
      const token = str(b.token) || (str(b.file) ? fileToken(b.file) : "");
      return {
        form: b.form,
        title: str(b.title).slice(0, 80) || b.form,
        state: b.state === "filled" || b.state === "empty" ? b.state : "missing",
        filled,
        href: filled && token ? `#/files?file=${encodeURIComponent(token)}` : `#/files?new=form:${b.form}`,
        action: filled ? "Filled" : "Fill it in",
      };
    });
  const counted = items.length ? items.filter((i) => i.filled).length : whole(basics.filled) ?? 0;
  const total = whole(basics.total) || items.length || TOTAL;
  const filled = Math.min(counted, total);
  return { filled, total, label: `${filled} of ${total} basics filled`, items };
}

export function Readiness({ brain }) {
  if (!brain || typeof brain !== "object") {
    return html`<section class="p-brain p-brain--readiness"><${Loading} lines=${3} label="Reading the company brain" /></section>`;
  }
  const r = readinessOf(brain);
  const done = r.filled >= r.total;
  return html`<section class="p-brain p-brain--readiness" aria-label="The basics">
    <div class="p-brain__ready-head">
      <${Ring} value=${r.filled} total=${r.total} size=${48} label=${r.label} />
      <div class="p-brain__ready-words">
        <p class="p-brain__ready-count">${r.label}</p>
        <p class="p-brain__ready-lead">${done
          ? "Every basic is filled. Agents read them before they work."
          : "The facts every agent reads before it works. Only you can fill them in."}</p>
      </div>
    </div>
    ${r.items.length
      ? html`<ul class="p-brain__basics">
          ${r.items.map((i) => html`<li key=${i.form} class=${i.filled ? "p-brain__basic p-brain__basic--filled" : "p-brain__basic"}>
            <a class="p-brain__basic-link" href=${i.href} aria-label=${`${i.title}: ${i.filled ? "filled, open it" : "fill it in"}`}>
              <span class="p-brain__basic-mark" aria-hidden="true">${i.filled ? html`<${Icon} name="check" size=${14} />` : null}</span>
              <span class="p-brain__basic-title">${i.title}</span>
              <span class="p-brain__basic-action">${i.action}</span>
              ${i.filled ? null : html`<${Icon} name="chevron-right" size=${14} />`}
            </a>
          </li>`)}
        </ul>`
      : null}
  </section>`;
}
