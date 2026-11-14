// The kit tests' shared tables and data: the pinned names of each group of modules, the shapes of the home
// server's tests, and the forms and job kit-c's tests fill in. Moved here word for word from kit-a, kit-b and
// kit-c (T01 of PLAN-COOK), so that the part files that share them read one copy.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TREE } from "./_dom.mjs";

// ---- kit-a: the primitives (CONTRACTS-V2 13.1) ----
export const PRIMITIVES = {
  button: ["Button"],
  icon: ["Icon", "StateIcon", "ICON_NAMES"],
  avatar: ["Avatar", "initials"],
  status: ["StatusDot", "Waiting", "Live"],
  tag: ["Tag", "Chip"],
  card: ["Card"],
  tabs: ["Tabs"],
  fields: ["Field", "TextInput", "TextArea", "Select", "Switch"],
  states: ["Notice", "ErrorNotice", "NotConnected", "Empty", "Loading", "BeingBuilt", "NextStep"],
  overlays: ["Menu", "Dialog", "Drawer"],
  text: ["Time", "Mono", "Kbd"],
  page: ["PageHeader", "Section"],
};
export const COMPOSITE_MODULES = ["decision", "task-card", "brief", "composer", "conversation", "table", "timeline", "checks", "doc", "agent"];
export const PINNED_ICONS =
  "search home tasks docs team routines health settings plus check cross clock chevron-right chevron-down file download external play pause loop send menu panel sun moon alert image layers".split(" ");
// CONTRACTS-V3 28: the icon names added for the map style.
export const V3_ICONS =
  "map dashboards files jobs needs brain upload folder form spark arrow-left arrow-right list grid tag stage link lock book filter reply video".split(" ");

// ---- kit-b: the composites (CONTRACTS-V2 13.2) ----
export const COMPOSITE_PINNED = {
  decision: ["DecisionCard", "useInboxAct", "splitActions"],
  "task-card": ["TaskRow", "TaskCard", "BoardColumn"],
  brief: ["BriefCard"],
  composer: ["Composer", "trigger"],
  conversation: ["Conversation", "FileCard"],
  table: ["DataTable", "Figures"],
  timeline: ["Timeline", "layout"],
  checks: ["CheckList", "Evidence"],
  doc: ["DocView"],
  agent: ["AgentChip", "AgentCard"],
};
export const UNTRUSTED = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

// ---- kit-c: the new parts (CONTRACTS-V3 28, M12) ----
export const NEW = ["segmented", "job", "answer", "ring", "forms", "upload"];
export const NEW_PINNED = {
  segmented: ["Segmented"],
  job: ["HandoffTag", "StageMark", "WhyNot", "JobRow", "JobChip", "JobStart", "fillPreview"],
  answer: ["AnswerView", "splitMarks"],
  ring: ["Ring"],
  forms: ["FormFields", "checkForm"],
  upload: ["FilePicker"],
};

export const HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)>';

// The shapes of the home server's tests, found by walking up from this tree (null when there are none).
function shapesDir() {
  for (let d = TREE; d !== dirname(d); d = dirname(d)) {
    const s = join(d, "server", "test", "shapes");
    if (existsSync(join(s, "job.json"))) return s;
  }
  return null;
}
export const SHAPES = shapesDir();
export const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));

export const BRAND = {
  id: "brand", folder: "brand", file: "brand.md", title: "Brand", lead: "How your company looks and sounds.",
  fields: [
    { id: "tone", label: "Three to five words for how you sound", kind: "list", required: true, max: 5, hint: "Such as: warm, plain, exact." },
    { id: "colours", label: "Your colours", kind: "colour", required: true, max: 5 },
    { id: "fonts", label: "Your typeface", kind: "choice", required: false, options: ["Helvetica Neue", "Avenir Next", "Didot"] },
    { id: "signoff", label: "How you sign off", kind: "line", required: false },
    { id: "story", label: "Your story", kind: "text", required: true },
  ],
};
export const SERVICES = {
  id: "services", folder: "pricing", file: "services.md", title: "Prices and services",
  fields: [{ id: "items", label: "What you sell", kind: "rows", required: true, columns: [{ id: "name", label: "Name" }, { id: "price", label: "Price" }] }],
};
export const LEAD = {
  id: "sales/first-message-to-a-lead", department: { id: "sales", title: "Sales" }, cluster: { id: "leads", title: "Leads" },
  title: "Write a first message to a lead", summary: "A first message.", handoff: "you-lead", stage: 3, size: "S", planFirst: false,
  who: [{ slug: "sales", name: "Sales" }], reads: [], takes: null, ready: true, why: null, runs: null,
  asks: [
    { id: "lead", label: "Who is the lead?", kind: "line", required: true, options: null },
    { id: "when", label: "When did you meet?", kind: "date", required: false, options: null },
    { id: "count", label: "How many?", kind: "number", required: false, options: null },
    { id: "tone", label: "How should it sound?", kind: "choice", required: false, options: ["warm", "short"] },
    { id: "doc", label: "Which file?", kind: "file", required: false, options: [{ value: "calls/asha.md", label: "asha.md" }] },
    { id: "clip", label: "Which clip?", kind: "media", required: false, options: [{ value: "talk.mp4", label: "talk.mp4" }] },
    { id: "about", label: "What do they need?", kind: "text", required: false, options: null },
  ],
  text: "Write to [lead], met on [when]. Use [doc] and [clip]. Write [count] versions, [tone]. [about]",
};
