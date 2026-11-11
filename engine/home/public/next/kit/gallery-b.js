// The composites' gallery: every component of CONTRACTS-V2 13.2 in its states, restyled by CONTRACTS-V3 28, on the
// canvas, on fixed sample data copied from engine/home/server/test/shapes/ (the browser cannot import from outside
// public/). Honours ?theme=, ?accent=, ?backdrop= and ?motion= (lib/theme-boot.js).
// Nothing here acts on the server: the sample items have ids no source knows.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import {
  AgentCard, AgentChip, BoardColumn, BriefCard, CheckList, Composer, Conversation, DataTable, DecisionCard,
  DecisionDone, DocView, Evidence, FileCard, Figures, PageHeader, Section, TaskCard, TaskRow, Timeline,
} from "./index.js";

const NOW = "2026-11-11T09:00:00.000Z";
const at = (min) => new Date(Date.parse("2026-11-11T08:00:00.000Z") + min * 60000).toISOString();

const artist = { slug: "artist", name: "Artist" };
const chief = { slug: "chief-of-staff", name: "Chief of staff" };
const marketer = { slug: "marketer", name: "Marketer" };
const checker = { slug: "checker", name: "Checker" };
const bookkeeper = { slug: "bookkeeper", name: "Bookkeeper" };
const you = { slug: "you", name: "You" };

const sheet = { name: "art/walker/walker-sheet.png", size: 412, kind: "image", url: "/assets/avatars/artist.png", viewUrl: "/assets/avatars/artist.png" };
const dataFile = { name: "art/walker/walker.json", size: 1830, kind: "text", url: "/api/files/gallery-sample", viewUrl: null };

const accept = { id: "acknowledge", label: "Accept", style: "primary", needsNote: false };
const sendBack = { id: "reopen", label: "Send back", style: "plain", needsNote: true };

const result = {
  id: "gallery:result", source: "goal", kind: "result", title: "Finished: Make a walking sprite for the mascot",
  raisedBy: "Chief of staff", when: NOW, severity: "normal",
  summary: "The walk cycle is ready: four frames, a sheet, a data file and a GIF.",
  details: [{ label: "Checked", value: "Passed in round 2" }, { label: "Files", value: "4 files" }],
  actions: [accept, sendBack], link: { page: "tasks", id: "e0000000-0000-4000-8000-000000000008" },
  taskId: "e0000000-0000-4000-8000-000000000008", identifier: "STH-8", agent: artist,
};
const plan = {
  ...result, id: "gallery:plan", kind: "approval", title: "Plan ready: Write the November newsletter and a launch post for the new price list",
  summary: "Two drafts, one for email and one for the blog, written from the price list.",
  details: [
    { label: "Approach", value: "Start from the price list, then write one draft per channel." },
    { label: "Step 1", value: "Write the newsletter (Marketer)" },
    { label: "Step 2", value: "Write the launch post (Marketer)" },
  ],
  actions: [{ id: "accept", label: "Accept the plan", style: "primary", needsNote: false }, { ...sendBack, id: "send_back" }],
  identifier: "STH-2", agent: marketer,
};
const stopped = {
  ...result, id: "gallery:stopped", kind: "problem", severity: "high", title: "Stopped: Draft an invoice for Asha Traders",
  summary: "The Checker sent it back five times.",
  details: [{ label: "Why", value: "The GST rate does not match the customer's state." }, { label: "Rounds", value: "5 of 5" }],
  actions: [
    { id: "answer", label: "Try again with a note", style: "primary", needsNote: true },
    { id: "stop", label: "Stop this task", style: "danger", needsNote: false },
  ],
  identifier: "STH-3", agent: bookkeeper,
};

const card = (o) => ({
  id: "e0000000-0000-4000-8000-000000000008", identifier: "STH-8", title: "Make a walking sprite for the mascot",
  column: "pending_review", state: "done", plainState: "Finished", who: artist, size: "M",
  stage: { id: "check", label: "Check" }, round: 2, schedule: null, waitingForYou: true, live: false,
  stepsDone: 4, stepsTotal: 4, createdAt: at(0), updatedAt: NOW, ...o,
});
const cards = [
  card({}),
  card({ id: "g14", identifier: "STH-14", title: "Daily brief", column: "pending_review", who: chief, size: "S",
    stage: { id: "summary", label: "Summary" }, round: 0, schedule: { label: "Daily at 09:00", routineId: "daily-brief" }, waitingForYou: false }),
  card({ id: "g7", identifier: "STH-7", title: "Reply to the three support tickets from Monday", who: { slug: "support", name: "Support" },
    size: "S", stage: { id: "plan", label: "Plan" }, round: 0, waitingForYou: true }),
];
const running = [
  { taskId: "g1", identifier: "STH-1", title: "Write the price list", who: { slug: "builder", name: "Builder" }, live: true, plainState: "Being worked on", since: at(55) },
  { taskId: "g15", identifier: "STH-15", title: "Plan this week's posts", who: marketer, live: true, plainState: "Being worked on", since: at(40) },
  card({ id: "g9", identifier: "STH-9", title: "Check the walk cycle", who: checker, column: "in_progress", live: false, waitingForYou: false }),
];

const brief = [
  { id: "b1", title: "Two drafts are waiting in Marketing", text: "A launch post and the November newsletter are ready to read.", who: marketer,
    about: { label: "STH-2", link: { page: "tasks", id: "e0000000-0000-4000-8000-000000000002" } }, at: at(-270) },
  { id: "b2", title: "Who is working", text: "2 of 10 agents are working right now.", who: chief, about: { label: "Company", link: null }, at: NOW },
];

const checks = [
  { n: 1, question: "Does the work do what the brief asked?", answer: "yes", reason: "four frames of a walk cycle", evidence: [sheet] },
  { n: 2, question: "Is every must-have met?", answer: "no", reason: "the tag \"walk\" runs to frame 4 but the sheet has frames 0 to 3", evidence: [dataFile, sheet] },
  { n: 3, question: "Is everything the plan said would be produced there?", answer: "yes", reason: "sheet, data file, GIF, manifest", evidence: [] },
  { n: 4, question: "Do the exported frames equal the tagged frame ranges?", answer: "no", reason: "four frames exported, five tagged", evidence: [dataFile] },
];

const timeline = [
  { id: "t1", identifier: "STH-9", title: "Write the brief and the plan", who: chief, kind: "work", state: "done", plainState: "Finished", startedAt: at(0), endedAt: at(6), durationMs: 360000 },
  { id: "t2", identifier: "STH-10", title: "Draw the walk cycle", who: artist, kind: "work", state: "done", plainState: "Finished", startedAt: at(6), endedAt: at(15), durationMs: 540000 },
  { id: "t3", identifier: "STH-11", title: "Check round 1", who: checker, kind: "check", state: "done", plainState: "Finished", startedAt: at(15), endedAt: at(20), durationMs: 300000 },
  { id: "t4", identifier: "STH-12", title: "Repair the walk tag", who: artist, kind: "work", state: "working", plainState: "Being worked on", startedAt: at(25), endedAt: null, durationMs: 2100000 },
];

const messages = [
  { who: you, kind: "note", text: "Make a walking sprite for the mascot, four frames, 16 by 16.", at: at(0) },
  { who: chief, kind: "comment", text: "I have split this into two steps: the Artist draws it, then the Checker looks at every frame.", at: at(1) },
  { who: artist, kind: "result", text: "The walk cycle is ready: four frames, a sheet, a data file and a GIF. <b>Tags</b> are in the data file.", at: at(15), files: [sheet, dataFile] },
  { who: you, kind: "note", text: "Looks good. Please make the feet a little darker.", at: at(30) },
];

const doc = {
  name: "01-plan.md", file: null,
  sections: [
    { heading: "Approach", text: "Draw four frames on a 16 by 16 grid, then export a sheet, a data file and a GIF." },
    { heading: "What will be produced", text: "art/walker/walker-sheet.png\nart/walker/walker.json\nart/walker/walker.gif" },
    { heading: "Steps", text: "1. Draw the walk cycle (Artist)\n2. Check every frame (Checker)" },
    { heading: "Anything unclear", text: "Should the mascot face left or right?" },
  ],
};
const briefDoc = { name: "00-brief.md", file: null, sections: [{ heading: "The goal in the owner's words", text: "Make a walking sprite for the mascot." }, { heading: "Anything unclear", text: "None." }] };

const agentCard = {
  id: "a10", slug: "artist", name: "Artist", title: "Artist", summary: "Draws sprites, animations and simple images by script.",
  department: "studio", reportsTo: chief, state: "working", plainState: "Working",
  doingNow: { title: "Draw the walk cycle", taskId: "e0000000-0000-4000-8000-000000000008" }, waitingForYou: false, lastActiveAt: at(30), applied: true,
};
const agentCards = [
  agentCard,
  { ...agentCard, id: "a2", slug: "bookkeeper", name: "Bookkeeper", summary: "Keeps the books: invoices, bills and payments, as drafts for you to approve.", state: "waiting_for_you", plainState: "Waiting for you", waitingForYou: true, doingNow: null },
  { ...agentCard, id: "a3", slug: "checker", name: "Checker", summary: "Checks finished work against the brief before it reaches you.", state: "free", plainState: "Free", doingNow: null },
];

const team = [chief, { slug: "builder", name: "Builder" }, checker, bookkeeper, marketer, artist];
const templates = [
  { id: "books/draft-an-invoice", title: "Draft an invoice", summary: "An invoice for one customer, with GST, ready for you to approve.", text: "Draft an invoice for [customer] for [what was sold] at [amount] plus GST.", to: "bookkeeper", planFirst: false },
  { id: "studio/draw-a-sprite", title: "Draw a sprite", summary: "A small animated character with a sheet and a GIF.", text: "Draw a [size] sprite of [what] that [does what].", to: "artist", planFirst: true },
  { id: "marketing/write-a-post", title: "Write a post", summary: "One post for one channel, as a draft.", text: "Write a post for [channel] about [what].", to: "marketer", planFirst: false },
];

// Version 3: a task row with the keys of CONTRACTS-V3 33.2, and without them.
const rows3 = [
  card({ id: "g21", identifier: "STH-21", title: "Proposal from a call write-up: Asha Kitchens", who: { slug: "sales", name: "Sales" },
    column: "done", plainState: "Accepted", waitingForYou: false, stage: { id: "check", label: "Check" }, round: 1, updatedAt: at(-90),
    outcome: "A three-page proposal for Asha Kitchens, with the price list's two packages.",
    job: { id: "sales/proposal-from-a-call", title: "Proposal from a call write-up" }, department: "sales" }),
  card({ id: "g22", identifier: "STH-22", title: "A carousel from a concept", who: marketer, column: "in_progress", live: true,
    plainState: "Being worked on", waitingForYou: false, stage: { id: "work", label: "Work" }, round: 0, updatedAt: at(50),
    outcome: null, job: { id: "marketing/carousel-from-a-concept", title: "A carousel from a concept" }, department: "marketing" }),
  card({ id: "g23", identifier: "STH-23", title: "Reconcile the October bills", who: bookkeeper, column: "pending_review",
    plainState: "Waiting for you", waitingForYou: true, stage: { id: "check", label: "Check" }, round: 2, updatedAt: at(10),
    outcome: null, job: null, department: "books" }),
  card({ id: "g24", identifier: "STH-24", title: "Tidy the shared folder names, a long title that has to be cut before the time at the right", who: chief,
    column: "backlog", plainState: "Not started", waitingForYou: false, stage: null, round: 0, updatedAt: at(-2000) }),
];

// Jobs for the "/" list, of shape `job` (cut to what the list reads).
const jobs = [
  { id: "sales/proposal-from-a-call", department: { id: "sales", title: "Sales" }, title: "Proposal from a call write-up",
    summary: "A written proposal for one customer, from the call write-up and your price list.", ready: true },
  { id: "books/quotation-from-a-call", department: { id: "books", title: "Books" }, title: "Quotation from a call write-up",
    summary: "A draft quotation in the books, from the call write-up.", ready: false },
  { id: "marketing/carousel-from-a-concept", department: { id: "marketing", title: "Marketing" }, title: "A carousel from a concept",
    summary: "Five slides for one concept, in your brand's colours.", ready: true },
  { id: "studio/title-card", department: { id: "studio", title: "Studio" }, title: "A title card",
    summary: "A short moving title for the start of a video.", ready: true },
];

// A task as a conversation, with the quiet markers of its stages.
const chat = [
  { who: { slug: "you", name: "Asha Rao" }, kind: "note", text: "Write a proposal for Asha Kitchens from yesterday's call.", at: at(0) },
  { marker: { label: "Brief written", tone: "neutral" } },
  { who: { slug: "sales", name: "Sales" }, kind: "comment", text: "I read the call write-up and the price list. Two packages fit what they asked for: the basic fit-out and the full kitchen.", at: at(4),
    marker: { label: "Round 1 · Working", tone: "neutral" } },
  { marker: { label: "Round 1 · Repairing", tone: "warn" } },
  { who: checker, kind: "verdict", text: "The totals on page 3 do not add up to the price list's figures. Sent back.", at: at(12) },
  { marker: { label: "Round 2 · Passed", tone: "ok" } },
  { who: { slug: "sales", name: "Sales" }, kind: "result", text: "The proposal is ready: three pages, both packages, totals from the price list.", at: at(20), files: [dataFile] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeSend = async () => { await sleep(600); };

// Opens the note field of the card inside `ref` by pressing its "Send back" button, as the owner would.
function OpenNote({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const btn = ref.current && [...ref.current.querySelectorAll(".k-decision__actions button")].find((b) => b.textContent.trim() === "Send back");
    if (btn) btn.click();
  }, []);
  return html`<div ref=${ref}>${children}</div>`;
}

const pickJob = () => {};
const grid = "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s-3);align-items:start";

export default function Gallery() {
  return html`<main style="position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:var(--s-8) var(--s-6) var(--s-12)" class="u-stack">
    <${PageHeader} title="Kit: composites" lead="Every composite of the kit, in its states, on sample data." />

    <${Section} title="Needs you" hint="DecisionCard">
      <div class="u-stack">
        <${DecisionCard} item=${result} />
        <${OpenNote}><${DecisionCard} item=${plan} /><//>
        <${DecisionCard} item=${stopped} />
        <${DecisionDone} message="Accepted." />
        <${DecisionCard} item=${result} compact />
      </div>
    <//>

    <${Section} title="Running now" hint="TaskRow">
      <div>${running.map((t) => html`<${TaskRow} task=${t} />`)}${html`<${TaskRow} task=${cards[0]} />`}</div>
    <//>

    <${Section} title="Tasks with an outcome, a job and a department" hint="TaskRow, version 3">
      <div class="u-glass" style="padding:var(--s-1)">${rows3.map((t) => html`<${TaskRow} task=${t} />`)}</div>
    <//>

    <${Section} title="Daily brief" hint="BriefCard">
      <div style=${grid}>${brief.map((b) => html`<${BriefCard} item=${b} />`)}</div>
    <//>

    <${Section} title="Board" hint="BoardColumn and TaskCard">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s-3);align-items:start">
        <${BoardColumn} column=${{ id: "in_progress", label: "In progress", count: 1 }}>
          ${[html`<${TaskCard} task=${card({ id: "g15", identifier: "STH-15", title: "Plan this week's posts", column: "in_progress", who: marketer, live: true, waitingForYou: false, size: "L", stage: { id: "work", label: "Work" }, round: 0, stepsDone: 1, stepsTotal: 3, updatedAt: at(40) })} />`]}
        <//>
        <${BoardColumn} column=${{ id: "pending_review", label: "Pending review", count: 3 }}>
          ${cards.map((c) => html`<${TaskCard} task=${c} />`)}
        <//>
        <${BoardColumn} column=${{ id: "failed", label: "Failed", count: 0 }}>${[]}<//>
      </div>
    <//>

    <${Section} title="Checks" hint="CheckList and Evidence">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--s-4);align-items:start">
        <${CheckList} checks=${checks} selected=${1} onSelect=${() => {}} />
        <${Evidence} file=${sheet} />
      </div>
      <${Evidence} file=${dataFile} />
    <//>

    <${Section} title="Timeline" hint="Timeline">
      <${Timeline} items=${timeline} now=${new Date(Date.parse(at(60)))} />
    <//>

    <${Section} title="Documents" hint="DocView">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--s-6);align-items:start">
        <${DocView} doc=${doc} unclear=${["Should the mascot face left or right?"]} />
        <${DocView} doc=${briefDoc} unclear=${[]} />
      </div>
    <//>

    <${Section} title="Conversation" hint="Conversation and FileCard">
      <${Conversation} messages=${messages} />
      <${FileCard} file=${sheet} onOpen=${() => {}} />
    <//>

    <${Section} title="A task as a conversation" hint="Conversation with markers">
      <div style="max-width:var(--column);width:100%;margin:0 auto">
        <${Conversation} messages=${chat} />
      </div>
      <${Conversation} messages=${[]} />
    <//>

    <${Section} title="Team" hint="AgentCard and AgentChip">
      <div style=${grid}>${agentCards.map((a) => html`<${AgentCard} agent=${a} />`)}</div>
      <div class="u-row" style="flex-wrap:wrap">${team.map((a) => html`<${AgentChip} agent=${a} />`)}</div>
    <//>

    <${Section} title="Figures and a table" hint="Figures and DataTable">
      <${Figures} figures=${[
        { id: "open", label: "Open invoices", value: "₹ 1,18,000.00", hint: "4 invoices" },
        { id: "due", label: "Due this week", value: "₹ 23,600.00" },
        { id: "late", label: "Late", value: "1", hint: "Asha Traders" },
      ]} />
      <${DataTable} columns=${[{ key: "name", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "amount", label: "Amount" }, { key: "state", label: "State" }]}
        rows=${[
          { id: 1, name: "ACC-SINV-0001", customer: "Asha Traders", amount: "₹ 11,800.00", state: "Draft" },
          { id: 2, name: "ACC-SINV-0002", customer: "Ravi & Sons", amount: "₹ 23,600.00", state: "Paid" },
        ]} />
      <${DataTable} columns=${[{ key: "name", label: "Invoice" }]} rows=${[]} emptyText="No invoices yet." />
    <//>

    <${Section} title="Composer" hint="Composer, the jobs list open; a picked job fills the line">
      <div style="position:relative;min-height:360px;display:flex;flex-direction:column;justify-content:flex-end">
        <${Composer} agents=${team} templates=${templates} onSend=${fakeSend} initialText="/" />
      </div>
      <${Composer} agents=${team} templates=${templates} onSend=${fakeSend} to="artist" />
    <//>

    <${Section} title="Composer with jobs" hint="Composer, the jobs list open; picking a job opens it">
      <div style="position:relative;min-height:320px;display:flex;flex-direction:column;justify-content:flex-end">
        <${Composer} agents=${team} templates=${jobs} onPickJob=${pickJob} onSend=${fakeSend} initialText="/" hint="Takes a few minutes. It is checked before it reaches you." />
      </div>
    <//>

    <${Section} title="The map's box" hint="Composer, ask mode: empty, typed, sending">
      <div class="u-stack" style="max-width:640px;width:100%;margin:0 auto;gap:var(--s-6)">
        <${Composer} mode="ask" onSend=${fakeSend} />
        <${Composer} mode="ask" onSend=${fakeSend} initialText="What is our returns policy?" />
        <${Composer} mode="ask" onSend=${fakeSend} initialText="Draft a proposal for Asha Kitchens." busy />
      </div>
    <//>
  </main>`;
}
