// Named answers for the studio's tests and its gallery (PLAN-3D T3): each is the input of worldState(), in the shapes
// of GET /api/world (2.2) and GET /api/inbox, plus the two views a door's confirm reads (GET /api/web and
// GET /api/generation, as today's routes send them). The seed is the prototype's company (cook/proto/engine/js/data.js)
// in the server's shapes; `hostile` puts text an agent could write into every name, title and sentence.
// No imports, no page, no clock, no randomness.

const GENERATED = "2026-11-16T19:30:00.000Z";

const money = (spent, limit = 1000, month = 5740, monthLimit = 20000) => ({
  ok: true,
  today: { spent, limit }, month: { spent: month, limit: monthLimit },
  line: `$${(spent / 100).toFixed(2)} of $${(limit / 100).toFixed(2)} spent today.`,
});

const PLAIN = { free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval" };

// An agent card as agentCards() sends it, cut to what /api/world keeps.
const agent = (slug, name, state, extra = {}) => ({
  id: `agent-${slug}`, slug, name, state, plainState: PLAIN[state] || "Free", waitingForYou: false, doing: null,
  lastActiveAt: "2026-11-16T17:30:00.000Z", ...extra,
});
const doing = (title, n) => ({ title, taskId: `task-sth-${n}`, identifier: `STH-${n}` });
const room = (id, title, line, agents, counts = {}) => ({
  id, title, line, agents,
  counts: {
    working: agents.filter((a) => a.state === "working").length,
    needsYou: agents.filter((a) => a.waitingForYou || a.state === "waiting_for_you" || a.state === "problem").length,
    jobs: 6, ...counts,
  },
});

const DOOR_TITLES = { web: "Web door", generation: "Generation door", higgsfield: "Higgsfield door" };
const DOOR_ON = {
  web: "The web door is running.",
  generation: "The generation door is running.",
  higgsfield: "Signed in.",
};
const door = (id, on, extra = {}) => ({
  id, title: DOOR_TITLES[id], on, blocked: false, sentence: DOOR_ON[id], spends: id !== "web",
  agents: id === "web" ? ["researcher"] : ["artist"], ...extra,
});
const doors = (over = {}) => ["web", "generation", "higgsfield"].map((id) => door(id, true, over[id] || {}));

const STUDIO_ON = { state: "on", sentence: "App Studio is on." };
const NO_SPENDING = { open: false, words: "This app cannot spend anything right now." };
const makeApp = (slug, name, on, spending = NO_SPENDING) => ({ slug, name, state: on ? "on" : "off", on, sentence: on ? "On" : "Off", spending });

// ---- the seed: seven departments, twelve agents ----

function seedRooms() {
  return [
    room("operations", "Operations", "plans · documents · checks", [
      agent("chief-of-staff", "Chief of staff", "working", { doing: doing("Plan this week's posts with the Marketer", 15) }),
      agent("builder", "Builder", "problem", { waitingForYou: true, doing: doing("Write the price list", 1) }),
      agent("checker", "Checker", "working", { doing: doing("Check round 2 of the walk cycle", 11) }),
      agent("art-director", "Art director", "working", { doing: doing("Score three versions of the Sthyra site", 21) }),
    ]),
    room("sales", "Sales", "leads · calls · deals", [
      agent("sales", "Sales", "working", { doing: doing("Write up the call with Meera Iyer", 26) }),
    ]),
    room("marketing", "Marketing", "ideas · writing · design", [
      agent("marketer", "Marketer", "working", { doing: doing("Draft posts for the Lake House launch", 19) }),
      agent("researcher", "Researcher", "paused"),
    ]),
    room("studio", "Studio", "parts · pictures · motion", [
      agent("drafter", "Drafter", "free"),
      agent("artist", "Artist", "free", { waitingForYou: true }),
    ]),
    room("support", "Support", "requests · replies · answers", [
      agent("support", "Support", "working", { doing: doing("Reply to a request about walkthrough films", 28) }),
    ]),
    room("people", "People", "staff · leave · joining", [agent("people", "People", "free")]),
    room("books", "Books", "selling · buying · month end", [
      agent("bookkeeper", "Bookkeeper", "free", { waitingForYou: true }),
    ]),
  ];
}

const item = (id, title, slug, name, department, n) => ({
  id, title, kind: "approval", source: "board", agent: { slug, name }, department,
  taskId: `task-sth-${n}`, identifier: `STH-${n}`, link: { page: "tasks", id: `task-sth-${n}` },
});
const seedInbox = () => ({
  items: [
    item("n1", "Approve the shotlist for the Lake House film", "artist", "Artist", "studio", 24),
    item("n3", "Approve the quotation for Meera Iyer's villa", "bookkeeper", "Bookkeeper", "books", 27),
    item("n6", "The price list is stuck", "builder", "Builder", "operations", 1),
  ],
  counts: { total: 3 }, notConnected: [], generatedAt: GENERATED,
});

const world = (over = {}) => ({
  company: { name: "Sthyra" }, boardOff: null, rooms: seedRooms(), doors: doors(),
  studio: STUDIO_ON, apps: [makeApp("postcards", "Postcards", false)], money: money(340), generatedAt: GENERATED, ...over,
});

export const seed = { world: world(), inbox: seedInbox() };

// ---- no departments, the board off ----

export const empty = {
  world: {
    company: { name: "Sthyra" },
    boardOff: { reason: "The task board is not running.", next: "Run: engine start" },
    rooms: [], doors: [], studio: null, apps: [], money: money(0), generatedAt: GENERATED,
  },
  inbox: { items: [], counts: { total: 0 }, notConnected: [], generatedAt: GENERATED },
};

// ---- everything off: every agent paused or free, three doors shut, apps off ----

export const allOff = {
  world: world({
    rooms: seedRooms().map((r) => ({
      ...r,
      counts: { working: 0, needsYou: 0, jobs: r.counts.jobs },
      agents: r.agents.map((a, i) => ({ ...a, state: i % 2 ? "free" : "paused", plainState: i % 2 ? "Free" : "Paused", waitingForYou: false, doing: null })),
    })),
    doors: doors({
      web: { on: false, sentence: "The web door is off. Run: engine start" },
      generation: { on: false, sentence: "The generation door is off. Run: engine start" },
      higgsfield: { on: false, sentence: "Not signed in." },
    }),
    studio: { state: "off", sentence: "App Studio is off. Run: engine start" },
    apps: [makeApp("postcards", "Postcards", false), makeApp("lake-house-site", "Lake House site", false)],
    money: money(0, 1000, 0),
  }),
  inbox: { items: [], counts: { total: 0 }, notConnected: [], generatedAt: GENERATED },
};

// ---- big: twelve departments, one with thirteen agents, names of sixty characters ----

// A name of exactly sixty characters that does not end in a space.
const sixty = (word) => `${word}, keeper of the longest name the owner gave on day one`.padEnd(60, ".").slice(0, 60).replace(/ $/, ".");

function bigRooms() {
  const out = [];
  for (let d = 0; d < 12; d++) {
    const n = d === 0 ? 13 : 1 + (d % 4);
    const agents = [];
    for (let i = 0; i < n; i++) {
      const state = ["working", "free", "working", "paused", "problem", "waiting_for_you"][(d + i) % 6];
      agents.push(agent(`d${d}-agent-${i}`, sixty(`Agent ${d}.${i}`), state, state === "working" ? { doing: doing(sixty(`Task ${d}.${i}`), 100 + d * 20 + i) } : {}));
    }
    out.push(room(`dept-${d}`, sixty(`Department ${d}`), sixty(`Line ${d}`), agents));
  }
  return out;
}
export const big = { world: world({ rooms: bigRooms() }), inbox: { items: [], counts: { total: 0 }, notConnected: [], generatedAt: GENERATED } };

// ---- one department, one agent ----

export const one = {
  world: world({
    rooms: [room("operations", "Operations", "plans · documents · checks", [
      agent("chief-of-staff", "Chief of staff", "working", { doing: doing("Plan this week's posts", 15) }),
    ])],
    apps: [],
  }),
  inbox: { items: [], counts: { total: 0 }, notConnected: [], generatedAt: GENERATED },
};

// ---- one app on, with an open allowance ----

const appOne = makeApp("lake-house-site", "Lake House site", true, { open: true, words: "Allowed today: $5.00. Spent: $1.20." });
export const app = { world: world({ apps: [appOne] }), inbox: seedInbox() };

// ---- one door off; one door that Settings would refuse to open ----

export const doorOff = { world: world({ doors: doors({ web: { on: false, sentence: "The web door is off. Run: engine start" } }) }), inbox: seedInbox() };
export const doorBlocked = {
  world: world({ doors: doors({ generation: { on: false, blocked: true, sentence: "Paste your Runway key first." } }) }),
  inbox: seedInbox(),
};

// ---- hostile: text an agent could write in every name, title and sentence ----

export const HOSTILE = Object.freeze([
  "<img src=x onerror=alert(1)>",
  "\"><script>alert(1)</script>",
  "javascript:alert(1)",
  "\");background:url(//evil.example/x)",
  "${7*7}",
  "L".repeat(5000),
  "‮gnp.exe",
]);
export const HOSTILE_ID = "../../x";
const h = (i) => HOSTILE[i % HOSTILE.length];

function hostileRooms() {
  const rooms = [];
  for (let d = 0; d < 4; d++) {
    const agents = [];
    for (let i = 0; i < 3; i++) {
      const k = d * 3 + i;
      agents.push(agent(`h${d}-agent-${i}`, h(k), ["working", "problem", "free"][i], {
        plainState: h(k + 1), doing: { title: h(k + 2), taskId: h(k + 3), identifier: h(k + 4) }, lastActiveAt: h(k + 5),
      }));
    }
    rooms.push(room(`h-room-${d}`, h(d), h(d + 3), agents));
  }
  rooms.splice(1, 0, room(HOSTILE_ID, h(5), h(6), [agent("h-lost", h(0), "working")]));
  return rooms;
}
export const hostile = {
  world: {
    company: { name: h(1) },
    boardOff: null,
    rooms: hostileRooms(),
    doors: ["web", "generation", "higgsfield"].map((id, i) => ({ ...door(id, i !== 1), title: h(i), sentence: h(i + 2) })),
    studio: { state: h(4), sentence: h(5) },
    apps: [
      { slug: "h-app", name: h(0), state: h(1), on: true, sentence: h(2), spending: { open: true, words: h(3) } },
      { slug: HOSTILE_ID, name: h(4), state: "on", on: true, sentence: h(5), spending: { open: false, words: h(6) } },
    ],
    money: { ok: true, today: { spent: 340, limit: 1000 }, month: { spent: 5740, limit: 20000 }, line: h(0) },
    generatedAt: GENERATED,
  },
  inbox: {
    items: HOSTILE.map((t, i) => ({ id: `h${i}`, title: t, kind: "approval", source: "board", agent: { slug: "h0-agent-0", name: t }, department: HOSTILE_ID, taskId: t })),
    counts: { total: HOSTILE.length }, notConnected: [], generatedAt: GENERATED,
  },
};

// Every fixture by its name (the gallery's `?fixture=`).
export const fixtures = Object.freeze({ seed, empty, allOff, big, one, app, doorOff, doorBlocked, hostile });
export const FIXTURE_NAMES = Object.freeze(Object.keys(fixtures));

// ---- the views a door's confirm reads (GET /api/web, GET /api/generation) ----

const webBase = {
  on: true, door: { state: "on", sentence: "The web door is running." }, canSwitchOn: true, blockers: [], whyNot: null,
  search: "off", searchKeySaved: false, allow: [], block: [], watchHosts: [], caps: { perHour: 30, perDay: 200 },
  today: { fetches: 4, searches: 0, watches: 0, refused: 0, lastAt: "2026-11-16T18:10:00.000Z" },
  shared: [], sharedTotals: { files: 0, bytes: 0, maxFiles: 20, maxBytes: 20000000 },
  lastTest: null, changedAt: "2026-11-02T09:00:00.000Z", problem: null, problemSentence: null,
};
export const webView = Object.freeze({
  plain: webBase,
  refused: {
    ...webBase, on: false, door: { state: "off", sentence: "The web door is off. Run: engine start" },
    canSwitchOn: false, blockers: ["door_off"], whyNot: "The web door is off. Run: engine start",
  },
  hostile: {
    ...webBase, on: false, door: { state: "off", sentence: h(0) }, canSwitchOn: false, blockers: ["door_off"], whyNot: h(1),
    problem: "doors_state_unreadable", problemSentence: h(2),
  },
});

const genBase = {
  on: true, key: { saved: true }, door: { state: "on", sentence: "The generation door is running." },
  canSwitchOn: true, blockers: [], whyNot: null,
  higgsfield: { on: true, signedIn: true, refused: false, centsPerCredit: 2, sentence: "Signed in." },
  caps: { daily: 1000, monthly: 20000 },
  models: { video: "gen4_turbo", image: "gen4_image" }, choices: [],
  spent: { ok: true, day: 340, month: 5740, dayLeft: 660, monthLeft: 14260, running: 0 },
  paused: null,
  example: "A 30-second film of six clips costs about $1.50, up to $3.00 with one retake each.",
  ledger: "ledger.jsonl", batches: [], problem: null, problemSentence: null,
};
export const generationView = Object.freeze({
  plain: genBase,
  refused: {
    ...genBase, on: false, key: { saved: false }, canSwitchOn: false, blockers: ["no_key"], whyNot: "Paste your Runway key first.",
    higgsfield: { ...genBase.higgsfield, on: false, signedIn: false, sentence: "Not signed in." },
  },
  hostile: {
    ...genBase, on: false, door: { state: "off", sentence: h(0) }, canSwitchOn: false, blockers: ["door_off"], whyNot: h(1),
    higgsfield: { ...genBase.higgsfield, on: false, signedIn: false, sentence: h(2) },
    paused: { at: null, sentence: h(3) }, example: h(4), problemSentence: h(5),
  },
});
