// The readiness of the company brain (CONTRACTS-V3 30 "Files", 32.4, 33.6; PLAN-COOK T68): how many of the nine
// basics are filled, then one row per basic in the kit's Rows panel: a glyph (a check when filled, an open ring
// when not), the name, one sentence of what it holds, and at the right `Open` (the file) or `Fill it in` (its form).
// The ones still missing come first.
// `brain` is the shape `brain` of GET /api/brain; the Files page reads it and passes it in.
import { html } from "../vendor/preact-htm.js";
import { fileToken } from "../lib/format.js";
import { Button, Group, Icon, Loading, Ring, Row, Rows } from "../kit/index.js";

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

// What each basic holds, in one sentence (the words of this panel; pinned by test/pages/brain.test.mjs).
export const BASIC_SAY = Object.freeze({
  about: "What the company does, for whom and where.",
  brand: "How the company looks and sounds.",
  "cant-say": "Words and claims agents must never use.",
  services: "What you sell, and at what price.",
  terms: "Payment, delivery and the other terms of a sale.",
  refunds: "When and how a customer gets money back.",
  "support-promise": "How quickly and how you answer customers.",
  team: "Who is who, and who to ask about what.",
  "ideal-customer": "Who you sell to, and what they care about.",
});
export const READINESS_WORDS = Object.freeze({
  title: "The basics",
  lead: "The facts every agent reads before it works. Only you can fill them in.",
  done: "Every basic is filled. Agents read them before they work.",
  open: "Open",
});

// The rows in the order they are shown: what is missing first, then what is filled, each in the shape's order.
export const shownOrder = (items) => [...items.filter((i) => !i.filled), ...items.filter((i) => i.filled)];

function Glyph({ filled }) {
  return filled
    ? html`<span class="p-brain__glyph p-brain__glyph--filled"><${Icon} name="check" size=${14} /></span>`
    : html`<span class="p-brain__glyph"></span>`;
}

export function Readiness({ brain }) {
  if (!brain || typeof brain !== "object") {
    return html`<section class="p-brain p-brain--readiness"><${Loading} lines=${3} label="Reading the company brain" /></section>`;
  }
  const r = readinessOf(brain);
  const done = r.filled >= r.total;
  return html`<section class="p-brain p-brain--readiness" aria-label=${READINESS_WORDS.title}>
    <${Group} title=${READINESS_WORDS.title}
      aside=${html`<span class="p-brain__ready-count"><${Ring} value=${r.filled} total=${r.total} size=${20} label=${r.label} /><span>${r.label}</span></span>`}
      say=${done ? READINESS_WORDS.done : READINESS_WORDS.lead}>
      ${r.items.length
        ? html`<${Rows}>
            ${shownOrder(r.items).map((i) => html`<${Row} key=${i.form} icon=${html`<${Glyph} filled=${i.filled} />`} title=${i.title}
              state=${i.filled ? { tone: "good", text: i.action } : null}
              say=${BASIC_SAY[i.form] || null}
              control=${html`<${Button} size="sm" variant=${i.filled ? "quiet" : "plain"} href=${i.href}
                aria-label=${`${i.title}: ${i.filled ? "filled, open it" : "fill it in"}`}>${i.filled ? READINESS_WORDS.open : i.action}<//>`} />`)}
          <//>`
        : null}
    <//>
  </section>`;
}
