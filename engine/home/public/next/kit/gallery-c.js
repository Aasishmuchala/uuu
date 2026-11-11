// The new parts' gallery: every new module of CONTRACTS-V3 28 in every state, on fixed sample data.
// The job, the question and the brain's figures are the examples of the shapes `job`, `ask` and `brain`;
// the form is the Brand form of 32.3. The job forms talk to a fake answer set up by gallery-c.boot.js.
import { html, useState } from "../vendor/preact-htm.js";
import {
  AnswerView, Card, FilePicker, FormFields, HandoffTag, JobChip, JobRow, JobStart, Ring, Section, Segmented,
  StageMark, WhyNot, checkForm, Creature,
} from "./index.js";

const row = "display:flex;flex-wrap:wrap;align-items:center;gap:12px";
const grid = "display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px";
const page = "max-width:var(--content-max);margin:0 auto;padding:var(--s-8) var(--s-4);display:flex;flex-direction:column;gap:var(--s-8)";

const CREATURE_IDS = "brain operations sales marketing studio support people books".split(" ");
const NAMES = { brain: "Company brain", operations: "Operations", sales: "Sales", marketing: "Marketing", studio: "Studio", support: "Support", people: "People", books: "Books" };

// Shape `job` (33.3), as pinned.
const JOB = {
  id: "sales/proposal-from-a-call", department: { id: "sales", title: "Sales" }, cluster: { id: "calls", title: "Calls" },
  title: "Proposal from a call write-up", summary: "A written proposal for one customer, from the call write-up and your price list.",
  handoff: "you-approve", stage: 4, size: "M", planFirst: false, who: [{ slug: "sales", name: "Sales" }],
  reads: [
    { file: "pricing/services.md", title: "Prices and services", need: "must", state: "filled", link: { page: "files", id: "cHJpY2luZy9zZXJ2aWNlcy5tZA" } },
    { file: "pricing/terms.md", title: "Terms", need: "must", state: "empty", link: { page: "files", id: "cHJpY2luZy90ZXJtcy5tZA" } },
    { file: "packs/proposal.md", title: "Proposal pack", need: "helps", state: "missing", link: null },
  ],
  asks: [
    { id: "earlier", label: "Which call write-up?", kind: "task", required: true, options: [{ value: "e0000000-0000-4000-8000-000000000020", label: "STH-20 · Call write-up: Asha Kitchens" }] },
    { id: "extra", label: "Anything to add?", kind: "text", required: false, options: null },
  ],
  takes: { from: ["sales/call-write-up"], label: "Write the proposal from this" },
  text: "Write a proposal for the customer of the call write-up in [earlier]. Say back what they told us, what we will do, what it costs from our price list, how long it takes and our terms. Use only prices and terms from the company's files. [extra]",
  ready: true, why: null,
  runs: { total: 3, accepted: 2, working: 1, needsYou: 0, last: { taskId: "e0000000-0000-4000-8000-000000000021", identifier: "STH-21", at: "2026-11-12T08:40:00.000Z", plainState: "Being worked on" } },
};

const LEAD = {
  ...JOB, id: "sales/first-message-to-a-lead", title: "Write a first message to a lead", handoff: "you-lead", stage: 3,
  summary: "A first message to one lead, in your voice. You send it yourself.",
  reads: [{ file: "customers/ideal-customer.md", title: "Who you sell to", need: "helps", state: "filled", link: { page: "files", id: "Y3VzdG9tZXJzL2lkZWFsLWN1c3RvbWVyLm1k" } }],
  asks: [
    { id: "lead", label: "Who is the lead?", kind: "line", required: true, options: null },
    { id: "when", label: "When did you meet?", kind: "date", required: false, options: null },
    { id: "count", label: "How many versions?", kind: "number", required: false, options: null },
    { id: "tone", label: "How should it sound?", kind: "choice", required: false, options: ["warm", "short", "formal"] },
    { id: "about", label: "What do they need?", kind: "text", required: true, options: null },
  ],
  takes: null,
  text: "Write a first message to [lead], who we met on [when]. They need: [about]. Write [count] versions, [tone].",
};
const QUIET = { asks: [], text: "Write a short first message to the lead we met at the trade fair last week." };
const demo = (id, extra = {}) => ({ ...LEAD, id: `sales/${id}`, ...extra });
const DIM = demo("find-companies-to-approach", {
  title: "Find companies to approach", handoff: "on-its-own", stage: 2, ready: false, asks: [], reads: [],
  why: { name: "internet", text: "Agents have no internet, and this job needs it.", link: null },
});
const BOOKS = {
  ...DIM, id: "books/draft-a-quotation", department: { id: "books", title: "Books" }, title: "Draft a quotation", handoff: "you-approve", stage: 3,
  why: { name: "quotations", text: "The books do not let the Bookkeeper draft quotations yet.", link: { page: "health" } },
};
const FILES = { ...DIM, id: "marketing/carousel-from-a-concept", department: { id: "marketing", title: "Marketing" }, title: "A carousel from one concept", handoff: "you-approve", stage: 4,
  why: { name: "reads", text: "Fill in \"Brand\" first.", link: { page: "files", id: "YnJhbmQvYnJhbmQubWQ" } } };
const STUDIO = { ...LEAD, id: "studio/an-animated-title-card", department: { id: "studio", title: "Studio" }, title: "An animated title card", handoff: "on-its-own", stage: 3 };

// Shape `ask` (33.5), as pinned, and its other states.
const ASK = {
  id: "e0000000-0000-4000-8000-000000000019", identifier: "STH-19", question: "What is our returns policy, and when did it last change?",
  state: "answered", plainState: "Answered", askedAt: "2026-11-12T08:00:00.000Z",
  answer: {
    text: "Customers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].",
    sources: [
      { n: 1, path: "returns-policy.md", note: "Returns", found: true, link: { page: "files", id: "cmV0dXJucy1wb2xpY3kubWQ" } },
      { n: 2, path: "policies/custom-orders.md", note: "", found: false, link: null },
    ],
    notInFiles: ["When the policy last changed."], checked: false, at: "2026-11-12T08:02:00.000Z",
  },
  needsYou: { inboxId: "goal:e0000000-0000-4000-8000-000000000019", action: "acknowledge", label: "Got it", version: "3f2a9c1b" },
  taskId: "e0000000-0000-4000-8000-000000000019",
};
const ASKS = [
  ["Reading", { ...ASK, state: "reading", plainState: "Reading your files", answer: null, question: "Do we deliver outside the city?" }],
  ["Answered, with a source not found and a line the files do not hold", ASK],
  ["Answered from one file", { ...ASK, question: "How long does a quotation hold?", answer: { ...ASK.answer, text: "A quotation holds for 30 days [1].", sources: [ASK.answer.sources[0]], notInFiles: [] } }],
  ["Became a task", { ...ASK, state: "became_task", plainState: "Became a task", answer: null, question: "Make me a price list for the new range." }],
  ["The sources could not be read", { ...ASK, answer: { ...ASK.answer, wellFormed: false, text: "Returns are allowed within 14 days [1].\nSources: see the policy." } }],
  ["Needs you", { ...ASK, state: "needs_you", plainState: "Needs you", answer: null, question: "Which of our two refund rules is right?" }],
];

// Shape `brain` (33.6): the readiness figures.
const BASICS = { filled: 4, total: 9 };

// The Brand form of 32.3, with the two extra fields its row names, and the Prices form's table.
const BRAND = {
  id: "brand", folder: "brand", file: "brand.md", title: "Brand",
  lead: "How your company looks and sounds. Agents read this before they write or design anything.",
  fields: [
    { id: "tone", label: "Three to five words for how you sound", kind: "list", required: true, max: 5, hint: "Such as: warm, plain, exact." },
    { id: "colours", label: "Your colours", kind: "colour", required: true, max: 5 },
    { id: "fonts", label: "Your typeface", kind: "choice", required: false, options: ["Helvetica Neue", "Avenir Next", "Futura", "Gill Sans", "Georgia", "Baskerville", "Didot"] },
    { id: "signoff", label: "How you sign off", kind: "line", required: false, hint: "Such as: With thanks, the team." },
    { id: "logo", label: "The logo's file in Brand", kind: "line", required: false },
  ],
};
const SERVICES = {
  id: "services", folder: "pricing", file: "services.md", title: "Prices and services", lead: "What you sell, at what price.",
  fields: [{ id: "items", label: "What you sell", kind: "rows", required: true, columns: [
    { id: "name", label: "Name" }, { id: "unit", label: "Unit" }, { id: "price", label: "Price" }, { id: "rate", label: "Tax rate" }, { id: "code", label: "Tax code" },
  ] }],
};

function Forms() {
  const [brand, setBrand] = useState({ tone: ["warm", "plain", "exact"], colours: ["#2f6f5e", "#f1e9dc"], fonts: "Avenir Next" });
  const [services, setServices] = useState({ items: [{ name: "Kitchen survey", unit: "visit", price: "2500", rate: "18%", code: "998719" }] });
  const [empty, setEmpty] = useState({ tone: ["one", "two", "three", "four", "five", "six"], colours: ["teal"] });
  return html`<div style=${grid}>
    <${Card}>
      <p class="u-over">Brand · filled in</p>
      <${FormFields} form=${BRAND} values=${brand} onChange=${setBrand} errors=${checkForm(BRAND, brand).errors} />
    <//>
    <${Card}>
      <p class="u-over">Brand · with problems</p>
      <${FormFields} form=${BRAND} values=${empty} onChange=${setEmpty} errors=${checkForm(BRAND, empty).errors} />
    <//>
    <${Card}>
      <p class="u-over">Prices and services · rows</p>
      <${FormFields} form=${SERVICES} values=${services} onChange=${setServices} errors=${checkForm(SERVICES, services).errors} />
    <//>
  </div>`;
}

function Pickers() {
  const [picked, setPicked] = useState(null);
  return html`<div style=${grid}>
    <div class="u-stack">
      <${FilePicker} accept=${[".md", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]} maxBytes=${10485760}
        onPick=${(f) => setPicked(`${f.name}, ${f.size} bytes, ready to send.`)} />
      ${picked ? html`<p class="u-caption">${picked}</p>` : null}
    </div>
    <${FilePicker} accept=".md,.txt" maxBytes=${2097152} busy onPick=${() => {}} />
    <${FilePicker} accept=".png" maxBytes=${2097152} error="That file is not what its name says." onPick=${() => {}} />
  </div>`;
}

export default function Gallery() {
  const [seg, setSeg] = useState("list");
  return html`<main style=${page}>
    <header class="u-stack">
      <p class="u-over">Kit gallery · C</p>
      <h1>The new parts</h1>
      <p class="u-muted">Creatures, the pill control, jobs, answers, rings, forms and the file picker.</p>
    </header>

    <${Section} title="Creatures">
      <div style=${row}>
        ${CREATURE_IDS.map((id) => html`<span key=${id} class="u-stack" style="align-items:center;gap:4px">
          <${Creature} id=${id} size=${48} label=${NAMES[id]} /><span class="u-caption">${NAMES[id]}</span></span>`)}
        <${Creature} id="sales" size=${96} still label="Sales, still" />
      </div>
    <//>

    <${Section} title="The pill control">
      <div class="u-stack">
        <${Segmented} label="Sections" current="map" items=${[
          { id: "map", label: "Map", icon: "map", href: "#/map" },
          { id: "tasks", label: "Tasks", icon: "tasks", href: "#/tasks" },
          { id: "dashboards", label: "Dashboards", icon: "dashboards", href: "#/dashboards" },
          { id: "files", label: "Files", icon: "files", href: "#/files" },
        ]} />
        <${Segmented} label="Show as" current=${seg} onChange=${setSeg} items=${[
          { id: "list", label: "List", icon: "list" }, { id: "board", label: "Board", icon: "grid" }, { id: "waiting", label: "Waiting", count: 3 },
        ]} />
        <${Segmented} size="sm" label="Look of the map" current="aurora" onChange=${() => {}} items=${[
          { id: "aurora", label: "Aurora" }, { id: "stars", label: "Stars" }, { id: "plain", label: "Plain" },
        ]} />
      </div>
    <//>

    <${Section} title="Rings">
      <div style=${row}>
        <${Ring} value=${0} total=${9} label="None of the nine basics filled in" />
        <${Ring} value=${BASICS.filled} total=${BASICS.total} label="4 of the 9 basics filled in" />
        <${Ring} value=${9} total=${9} size=${56} label="All nine basics filled in" />
        <${Ring} value=${12} total=${60} size=${32} />
      </div>
    <//>

    <${Section} title="Hand-offs, stages, and why a job cannot start">
      <div class="u-stack">
        <div style=${row}><${HandoffTag} id="you-lead" /><${HandoffTag} id="you-approve" /><${HandoffTag} id="on-its-own" /></div>
        <div style=${row}><${StageMark} n=${1} /><${StageMark} n=${2} /><${StageMark} n=${3} /><${StageMark} n=${4} /></div>
        <${WhyNot} why=${BOOKS.why} />
        <${WhyNot} why=${FILES.why} />
        <${WhyNot} why="Agents have no internet, and this job needs it." />
      </div>
    <//>

    <${Section} title="Jobs as lines and chips">
      <${Card} padding="sm">
        <${JobRow} job=${JOB} />
        <${JobRow} job=${LEAD} />
        <${JobRow} job=${STUDIO} />
        <${JobRow} job=${BOOKS} />
        <${JobRow} job=${DIM} />
        <${JobRow} job=${FILES} />
      <//>
      <div style=${`${row};margin-top:12px`}>
        <${JobChip} job=${JOB} /><${JobChip} job=${LEAD} /><${JobChip} job=${STUDIO} /><${JobChip} job=${BOOKS} />
      </div>
    <//>

    <${Section} title="Starting a job" hint="Add ?press=1 to the address to press Start on the last four at once.">
      <div style=${grid}>
        <${Card}><p class="u-over">Ready</p><${JobStart} job=${LEAD} /><//>
        <${Card}><p class="u-over">From an earlier task</p><${JobStart} job=${JOB} from="e0000000-0000-4000-8000-000000000020" /><//>
        <${Card}><p class="u-over">Cannot start</p><${JobStart} job=${BOOKS} /><//>
        <${Card}><div data-press><p class="u-over">A required answer missing</p><${JobStart} job=${demo("demo-missing")} /></div><//>
        <${Card}><div data-press><p class="u-over">Sending</p><${JobStart} job=${demo("demo-sending", QUIET)} /></div><//>
        <${Card}><div data-press><p class="u-over">Started</p><${JobStart} job=${demo("demo-started", QUIET)} /></div><//>
        <${Card}><div data-press><p class="u-over">Refused by the server</p><${JobStart} job=${demo("demo-refused", QUIET)} /></div><//>
        <${Card}><div data-press><p class="u-over">The board is off</p><${JobStart} job=${demo("demo-off", QUIET)} /></div><//>
      </div>
    <//>

    <${Section} title="Answers from the company brain">
      <div style=${grid}>
        ${ASKS.map(([title, ask]) => html`<${Card} key=${title}><p class="u-over">${title}</p><${AnswerView} ask=${ask} /><//>`)}
      </div>
    <//>

    <${Section} title="Brain forms">
      <${Forms} />
    <//>

    <${Section} title="Adding a file">
      <${Pickers} />
    <//>
  </main>`;
}
