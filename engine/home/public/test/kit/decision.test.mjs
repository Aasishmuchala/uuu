// The kit's DecisionCard (CONTRACTS-V2 13.2, V48, V60a, F1b, U1), and the tests that run over every composite at
// once (they read decision.js first): every module loads, and only DecisionCard reaches the server. Split out of
// kit-a, kit-b, kit-u1, kit-f1b and kit-v60a (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, render, installDom, elements, textOf, classOf, hasClass, settle, showTree, show, fire, buttonNamed, stubFetch } from "./_dom.mjs";
import { COMPOSITE_PINNED, shape } from "./_fixtures.mjs";
import { compositeSheetTests, css } from "./_rules.mjs";

const PINNED = COMPOSITE_PINNED;
const MODULES = Object.keys(PINNED);
const load = (name) => import(join(KIT, `${name}.js`));
const decision = await import(pathToFileURL(join(KIT, "decision.js")).href);

// ---- kit-b: the composites' names, the pure helpers, the one route ----

test("each composite module loads in Node and exports its pinned names", async () => {
  for (const name of MODULES) {
    const m = await load(name);
    for (const exp of PINNED[name]) assert.equal(typeof m[exp], "function", `${name}.js exports ${exp}`);
  }
});

test("splitActions: the first primary is primary; note actions and the rest are apart", async () => {
  const { splitActions } = await load("decision");
  const accept = { id: "acknowledge", label: "Accept", style: "primary", needsNote: false };
  const back = { id: "reopen", label: "Send back", style: "plain", needsNote: true };
  const stop = { id: "stop", label: "Stop this task", style: "danger", needsNote: false };
  const dismiss = { id: "dismiss", label: "Dismiss", style: "plain", needsNote: false };
  assert.deepEqual(splitActions([back, accept, stop]), { primary: accept, withNote: [back], rest: [stop] });
  assert.deepEqual(splitActions([dismiss, back]), { primary: dismiss, withNote: [back], rest: [] });
  const second = { ...accept, id: "other" };
  assert.deepEqual(splitActions([accept, second]), { primary: accept, withNote: [], rest: [second] });
  assert.deepEqual(splitActions([]), { primary: null, withNote: [], rest: [] });
  assert.deepEqual(splitActions(undefined), { primary: null, withNote: [], rest: [] });
  const item = shape("needs-you-item");
  assert.equal(splitActions(item.actions).primary.label, "Accept");
});

test("actBody: the version the owner saw goes with every action on an item that has one", async () => {
  const { actBody, isChangedSinceSeen, changedText, CHANGED_TEXT } = await load("decision");
  assert.deepEqual(actBody("goal:1", "acknowledge"), { id: "goal:1", action: "acknowledge" });
  assert.deepEqual(actBody("goal:1", "reopen", "More", "v7"), { id: "goal:1", action: "reopen", note: "More", version: "v7" });
  assert.deepEqual(actBody("goal:1", "acknowledge", "", "v7"), { id: "goal:1", action: "acknowledge", version: "v7" });
  assert.deepEqual(actBody("goal:1", "acknowledge", undefined, ""), { id: "goal:1", action: "acknowledge" });
  assert.deepEqual(actBody("goal:1", "acknowledge", undefined, null), { id: "goal:1", action: "acknowledge" });
  assert.equal(isChangedSinceSeen({ code: "changed_since_seen" }), true);
  assert.equal(isChangedSinceSeen({ code: "conflict" }), false);
  assert.equal(isChangedSinceSeen(null), false);
  assert.deepEqual(changedText({ message: "", next: "" }), CHANGED_TEXT);
  assert.equal(CHANGED_TEXT.message, "This changed after you looked at it. Nothing was done.");
  assert.deepEqual(changedText({ message: "Changed.", next: "Look again." }), { message: "Changed.", next: "Look again." });
});

test("reloadInboxItem reads GET /api/inbox and finds the item, or null when it is gone", async () => {
  const { reloadInboxItem } = await load("decision");
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method });
    return { ok: true, status: 200, json: async () => ({ items: [{ id: "goal:1", version: "v8", title: "New" }] }) };
  };
  try {
    assert.deepEqual(await reloadInboxItem("goal:1"), { id: "goal:1", version: "v8", title: "New" });
    assert.equal(await reloadInboxItem("goal:2"), null);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/inbox", "GET /api/inbox"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("DecisionCard acts only through POST /api/inbox/act, through lib/api.js; no module touches the page at load", async () => {
  const src = readFileSync(join(KIT, "decision.js"), "utf8");
  const paths = [...src.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((m) => m[1]);
  // The one write is POST /api/inbox/act; the one read is GET /api/inbox, to show an item again after the server
  // said it changed since the owner looked (CONTRACTS 9.3a).
  assert.deepEqual([...new Set(paths)].sort(), ["/api/inbox", "/api/inbox/act"]);
  assert.ok(/api\.post\(\s*"\/api\/inbox\/act"/.test(src));
  assert.equal([...src.matchAll(/api\.post\(/g)].length, 1, "one place sends an action");
  assert.ok(/api\.get\(\s*"\/api\/inbox"\s*\)/.test(src));
  assert.ok(!/api\.(del|post)\(\s*"\/api\/inbox"\s*[,)]/.test(src));
  for (const name of MODULES) {
    const code = readFileSync(join(KIT, `${name}.js`), "utf8");
    assert.ok(!code.includes("fetch("), `${name}.js uses lib/api.js`);
    // Top-level statements only (lines that start at column 0): none may reach for the page.
    const top = code.split("\n").filter((l) => /^\S/.test(l) && !/^(export )?function |^\/\/|^}/.test(l));
    assert.ok(!top.some((l) => /\b(document|window)\b/.test(l)), `${name}.js touches nothing at load`);
  }
});

// ---- kit-a: DecisionCard, mounted (V48): the version the owner saw, "changed since you looked", and Esc. ----

const SEEN = {
  id: "goal:1", version: "v1", kind: "result", title: "Price list is ready", raisedBy: "Chief of staff",
  when: "2026-11-11T09:00:00.000Z", summary: "Three rows.", severity: "normal",
  details: [{ label: "Amount", value: "₹ 1,000.00" }],
  actions: [
    { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
    { id: "reopen", label: "Send back", style: "plain", needsNote: true },
  ],
};

test("DecisionCard shows what is approved before its button, and sends the version the owner saw", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Accepted." } }));
  try {
    const root = await showTree(decision.DecisionCard, { item: SEEN });
    const all = elements(root);
    const at = (pred) => all.findIndex(pred);
    const button = at((e) => e.localName === "button" && textOf(e).trim() === "Accept");
    for (const words of ["Price list is ready", "Chief of staff", "Amount", "₹ 1,000.00"]) {
      const i = at((e) => e.childNodes.some((c) => c.nodeType === 3 && c.data.includes(words)));
      assert.ok(i >= 0 && i < button, `"${words}" is shown before the button`);
    }
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    assert.deepEqual(f.calls.map((c) => [c.method, c.path, c.body]), [["POST", "/api/inbox/act", { id: "goal:1", action: "acknowledge", version: "v1" }]]);
    assert.match(textOf(root), /Accepted\./);
    render(null, root);
  } finally {
    f.restore();
  }
});

test("DecisionCard on 409 changed_since_seen: says so, shows the item again, never retries, then acts on the new version", async () => {
  installDom();
  const f = stubFetch((path, method, n) => {
    if (method === "GET") return { status: 200, body: { items: [{ ...SEEN, version: "v2", title: "Price list is ready, with Hindi" }] } };
    if (n === 1) return { status: 409, body: { error: { message: "This changed after you looked at it. Nothing was done.", next: "Read it again, then decide.", code: "changed_since_seen" } } };
    return { status: 200, body: { ok: true, message: "Accepted." } };
  });
  try {
    const root = await showTree(decision.DecisionCard, { item: SEEN });
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    await settle();
    const t = textOf(root);
    assert.match(t, /This changed after you looked at it\. Nothing was done\./);
    assert.match(t, /Read it again, then decide\./);
    assert.match(t, /Price list is ready, with Hindi/, "the new version is shown");
    assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), ["POST /api/inbox/act", "GET /api/inbox"], "no second action by itself");
    fire(buttonNamed(root, "Accept"), "click");
    await settle();
    assert.deepEqual(f.calls[2].body, { id: "goal:1", action: "acknowledge", version: "v2" });
    assert.match(textOf(root), /Accepted\./);
    render(null, root);
  } finally {
    f.restore();
  }
});

test("DecisionCard: Esc in an open note or confirm cancels and sends nothing", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Done." } }));
  try {
    let root = await showTree(decision.DecisionCard, { item: SEEN });
    fire(buttonNamed(root, "Send back"), "click");
    await settle();
    assert.ok(elements(root).some((e) => e.localName === "textarea"), "the note field is open");
    fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
    await settle();
    assert.ok(!elements(root).some((e) => e.localName === "textarea"), "Esc closed it");
    assert.ok(buttonNamed(root, "Accept"), "the actions are back");
    render(null, root);

    const risky = { ...SEEN, actions: [{ id: "stop", label: "Stop", style: "danger", needsNote: false }] };
    root = await showTree(decision.DecisionCard, { item: risky });
    fire(buttonNamed(root, "Stop"), "click");
    await settle();
    assert.ok(buttonNamed(root, "Yes, stop"), "it asks once");
    fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
    await settle();
    assert.ok(!buttonNamed(root, "Yes, stop"), "Esc cancelled the confirm");
    assert.equal(f.calls.length, 0, "nothing was sent");
    render(null, root);
  } finally {
    f.restore();
  }
});

// ---- kit-u1 ----

test("DecisionCard: an item the board raised shows a plain mark; a leading danger action looks like one", async () => {
  const item = {
    id: "board:hold:x", source: "board", kind: "problem", title: "A task stopped", raisedBy: "The board", when: "2026-11-11T08:20:00.000Z",
    summary: "This task stopped and the board will not start it again by itself.", severity: "high",
    details: [{ label: "Task", value: "Reconcile the October bills" }, { label: "What you can do", value: "Stop the task, or reply." }],
    actions: [{ id: "stop", label: "Stop this task", style: "danger", needsNote: false }, { id: "answer", label: "Reply", style: "plain", needsNote: true }],
  };
  const root = await show(decision.DecisionCard, { item });
  assert.ok(hasClass(root, "k-decision__source"));
  assert.ok(!hasClass(root, "k-avatar"), "no initials made up from \"The board\"");
  assert.ok(!textOf(root).includes("TB"));
  const stop = elements(root).find((e) => e.localName === "button" && textOf(e).trim() === "Stop this task");
  assert.ok(classOf(stop).includes("k-btn--danger"));
  const withAgent = await show(decision.DecisionCard, { item: { ...item, agent: { slug: "builder", name: "Builder" }, raisedBy: "Builder" } });
  assert.ok(hasClass(withAgent, "k-avatar"));
  assert.ok(!hasClass(withAgent, "k-decision__source"));
});

// ---- kit-f1b: question ids that are an object's own machinery; suggested tasks. ----
{
  const TRICKY = ["constructor", "__proto__", "toString"];
  const QUESTIONS = [
    { id: "constructor", prompt: "Which stage is the lead at?", help: null, mode: "single", required: true, options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }], allowText: false },
    { id: "__proto__", prompt: "Where should we follow up?", help: null, mode: "multi", required: true, options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }], allowText: false },
    { id: "toString", prompt: "Anything to add?", help: null, mode: "text", required: true, options: [], allowText: true },
  ];
  const ITEM = {
    id: "board:q1", kind: "question", title: "Three questions", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
    summary: "The Sales asked you a question.", severity: "normal", version: "abcd",
    details: [{ label: "Question 1", value: "Which stage is the lead at?" }],
    actions: [{ id: "answer", label: "Answer", style: "primary", needsNote: true }, { id: "dismiss", label: "Hide", style: "plain", needsNote: false }],
    questions: QUESTIONS,
  };

  test("picks: question ids constructor, __proto__ and toString are plain keys", () => {
    const none = decision.noPicks();
    for (const id of TRICKY) assert.equal(decision.pickOf(none, id), null, id);
    for (const id of TRICKY) assert.equal(decision.pickOf({}, id), null, `${id} on a plain object`);
    assert.equal(decision.canSendAnswers(QUESTIONS, none), false);
    assert.equal(decision.canSendAnswers(QUESTIONS, {}), false);
    let p = decision.pickOption(none, QUESTIONS[0], "qualified");
    p = decision.pickOption(p, QUESTIONS[1], "phone");
    p = decision.pickOption(p, QUESTIONS[1], "email");
    assert.equal(decision.canSendAnswers(QUESTIONS, p), false, "the text question is still required");
    p = decision.pickText(p, QUESTIONS[2], " Call after 5. ");
    assert.equal(decision.canSendAnswers(QUESTIONS, p), true);
    assert.equal(Object.getPrototypeOf(p), null, "the picks have no prototype to reach");
    assert.deepEqual(decision.pickOf(p, "__proto__").optionIds, ["phone", "email"]);
    const note = JSON.parse(decision.answersNote(QUESTIONS, p));
    assert.ok(Object.hasOwn(note.answers, "__proto__"), "__proto__ is an answer of its own");
    assert.deepEqual(note.answers.constructor, { optionIds: ["qualified"], text: "" });
    assert.deepEqual(note.answers.__proto__, { optionIds: ["phone", "email"], text: "" });
    assert.deepEqual(note.answers.toString, { optionIds: [], text: "Call after 5." });
  });

  test("DecisionCard answers questions named constructor, __proto__ and toString, and sends each answer", async () => {
    installDom();
    const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Your answer was passed on." } }));
    try {
      const root = await showTree(decision.DecisionCard, { item: ITEM });
      fire(buttonNamed(root, "Answer"), "click");
      await settle();
      assert.equal(elements(root).filter((e) => e.localName === "fieldset").length, 3, "the form shows all three questions");
      fire(buttonNamed(root, "Qualified"), "click");
      await settle();
      fire(buttonNamed(root, "Phone"), "click");
      await settle();
      const words = elements(root).find((e) => e.localName === "textarea");
      fire(words, "input", { currentTarget: { value: "Call after 5." } });
      await settle();
      fire(buttonNamed(root, "Send"), "click");
      await settle();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].body.version, "abcd");
      const sent = JSON.parse(f.calls[0].body.note).answers;
      assert.deepEqual(Object.keys(sent).sort(), [...TRICKY].sort());
      assert.deepEqual(sent.__proto__, { optionIds: ["phone"], text: "" });
      render(null, root);
    } finally {
      f.restore();
    }
  });

  test("a card that offers only Answer and Hide still offers Hide, outside the answer form", () => {
    const { primary, rest } = decision.splitActions(ITEM.actions);
    assert.equal(primary.id, "answer");
    assert.deepEqual(rest.map((a) => a.id), ["dismiss"]);
  });

  test("DecisionCard lists every suggested task and who it is for, as text", async () => {
    installDom();
    const item = {
      id: "board:s1", kind: "question", title: "Follow-ups", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
      summary: "The Sales asked you a question.", severity: "normal", version: "v1",
      details: [{ label: "If you accept", value: "2 new tasks are made, as if you made them:" }],
      suggested: [{ title: "Call <b>Asha</b>", who: "Sales" }, { title: "Send the price list", who: "Nobody yet" }],
      actions: [{ id: "accept", label: "Accept", style: "primary" }, { id: "reject", label: "Decline", style: "plain" }, { id: "dismiss", label: "Hide", style: "plain" }],
    };
    const root = await showTree(decision.DecisionCard, { item });
    const list = elements(root).find((e) => e.localName === "ol");
    assert.ok(list, "an ordered list of the tasks");
    assert.equal(list.getAttribute("aria-label"), "Tasks it would make");
    assert.equal(elements(list).filter((e) => e.localName === "li").length, 2);
    const t = textOf(list);
    for (const words of ["Call <b>Asha</b>", "For: Sales", "Send the price list", "For: Nobody yet"]) assert.ok(t.includes(words), words);
    assert.ok(!elements(list).some((e) => e.localName === "b"), "a title is text, never markup");
    assert.ok(buttonNamed(root, "Accept"));
    assert.deepEqual(decision.suggestedOf({ suggested: [null, { title: "" }, { title: "x", who: "y" }] }), [{ title: "x", who: "y" }]);
    render(null, root);
  });
}

// ---- kit-v60a: an agent's questions answered one by one. ----
{
  const QUESTIONS = [
    { id: "stage", prompt: "Which stage is the lead at?", help: null, mode: "single", required: true, options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }], allowText: true },
    { id: "channels", prompt: "Where should we follow up?", help: null, mode: "multi", required: false, options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }], allowText: false },
    { id: "notes", prompt: "Anything to add?", help: null, mode: "text", required: true, options: [], allowText: true },
  ];
  const ITEM = {
    id: "board:q1", kind: "question", title: "Two choices and a note", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
    summary: "The Sales asked you a question.", severity: "normal",
    details: [{ label: "Question 1", value: "Which stage is the lead at?" }],
    actions: [{ id: "answer", label: "Answer", style: "primary", needsNote: true }],
    questions: QUESTIONS,
  };

  test("pickOption and pickText: one choice replaces the other and the words; several choices toggle", () => {
    const [single, multi] = QUESTIONS;
    let p = decision.pickText({}, single, "Something else");
    p = decision.pickOption(p, single, "new");
    assert.deepEqual(p.stage, { optionIds: ["new"], text: "" });
    p = decision.pickOption(p, single, "qualified");
    assert.deepEqual(p.stage.optionIds, ["qualified"]);
    p = decision.pickText(p, single, "Warm, not yet qualified");
    assert.deepEqual(p.stage, { optionIds: [], text: "Warm, not yet qualified" });
    p = decision.pickOption(p, multi, "phone");
    p = decision.pickOption(p, multi, "email");
    p = decision.pickOption(p, multi, "phone");
    assert.deepEqual(p.channels.optionIds, ["email"]);
  });

  test("canSendAnswers and answersNote: every required question first; the note is what the server reads", () => {
    assert.equal(decision.canSendAnswers(QUESTIONS, {}), false);
    const p = { stage: { optionIds: ["qualified"], text: "" }, notes: { optionIds: [], text: " Call after 5. " } };
    assert.equal(decision.canSendAnswers(QUESTIONS, { stage: p.stage }), false);
    assert.equal(decision.canSendAnswers(QUESTIONS, p), true);
    assert.deepEqual(JSON.parse(decision.answersNote(QUESTIONS, p)), {
      answers: { stage: { optionIds: ["qualified"], text: "" }, notes: { optionIds: [], text: "Call after 5." } },
    });
    assert.deepEqual(decision.questionsOf({}), []);
  });

  test("DecisionCard with questions: each question, its choices and a text field; Send only when answered", async () => {
    installDom();
    const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Your answer was passed on." } }));
    try {
      const root = await showTree(decision.DecisionCard, { item: ITEM });
      assert.ok(!buttonNamed(root, "Accept"), "no Accept for a question");
      fire(buttonNamed(root, "Answer"), "click");
      await settle();
      const t = textOf(root);
      for (const words of ["1. Which stage is the lead at?", "2. Where should we follow up? (you may leave this one)", "3. Anything to add?", "Or write your own answer", "Your answer"]) {
        assert.ok(t.includes(words), words);
      }
      assert.equal(elements(root).filter((e) => e.localName === "fieldset").length, 3);
      assert.equal(elements(root).filter((e) => e.localName === "textarea").length, 2, "words only where they are taken");
      const send = () => buttonNamed(root, "Send");
      const off = (el) => el.disabled === true || (el.getAttribute("disabled") !== null && el.getAttribute("disabled") !== "false");
      assert.equal(off(send()), true);
      assert.equal(globalThis.document.activeElement, buttonNamed(root, "New"), "the first choice has the focus");
      fire(buttonNamed(root, "Qualified"), "click");
      await settle();
      assert.equal(buttonNamed(root, "Qualified").getAttribute("aria-checked"), "true", "the chosen radio row is checked");
      assert.equal(buttonNamed(root, "New").getAttribute("aria-checked"), "false");
      fire(buttonNamed(root, "Email"), "click");
      await settle();
      const notes = elements(root).filter((e) => e.localName === "textarea")[1];
      fire(notes, "input", { currentTarget: { value: "Call after 5." } });
      await settle();
      assert.equal(off(send()), false);
      fire(send(), "click");
      await settle();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].path, "/api/inbox/act");
      assert.equal(f.calls[0].body.action, "answer");
      assert.deepEqual(JSON.parse(f.calls[0].body.note), {
        answers: { stage: { optionIds: ["qualified"], text: "" }, channels: { optionIds: ["email"], text: "" }, notes: { optionIds: [], text: "Call after 5." } },
      });
      assert.match(textOf(root), /Your answer was passed on\./);
      render(null, root);
    } finally {
      f.restore();
    }
  });

  test("DecisionCard with questions: Esc cancels and nothing is sent", async () => {
    installDom();
    const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Done." } }));
    try {
      const root = await showTree(decision.DecisionCard, { item: ITEM });
      fire(buttonNamed(root, "Answer"), "click");
      await settle();
      fire(buttonNamed(root, "New"), "click");
      await settle();
      fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
      await settle();
      assert.ok(!elements(root).some((e) => e.localName === "fieldset"), "the questions closed");
      assert.ok(buttonNamed(root, "Answer"), "the action is back");
      assert.equal(f.calls.length, 0);
      render(null, root);
    } finally {
      f.restore();
    }
  });
}

// ---- PLAN-COOK T36: the card in R04's manner on C3's parts ----

test("a single-choice question is a radio group of rows; several choices are check rows; one Tab stop a group", async () => {
  installDom();
  const item = {
    id: "board:q2", kind: "question", title: "Pick", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z", severity: "normal",
    actions: [{ id: "answer", label: "Answer", style: "primary", needsNote: true }],
    questions: [
      { id: "stage", prompt: "Which stage?", mode: "single", required: true, options: [{ id: "new", label: "New" }, { id: "won", label: "Won" }], allowText: false },
      { id: "how", prompt: "How?", mode: "multi", required: false, options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }], allowText: false },
    ],
  };
  const root = await showTree(decision.DecisionCard, { item });
  fire(buttonNamed(root, "Answer"), "click");
  await settle();
  const groups = elements(root).filter((e) => e.getAttribute && (e.getAttribute("role") === "radiogroup" || e.getAttribute("role") === "group"));
  assert.ok(groups.some((g) => g.getAttribute("role") === "radiogroup" && g.getAttribute("aria-label") === "Pick one"));
  assert.equal(buttonNamed(root, "New").getAttribute("role"), "radio");
  assert.equal(buttonNamed(root, "Phone").getAttribute("role"), "checkbox");
  assert.deepEqual(["New", "Won"].map((w) => buttonNamed(root, w).getAttribute("tabindex")), ["0", "-1"], "one stop: the first row");
  fire(buttonNamed(root, "Won"), "click");
  await settle();
  assert.deepEqual(["New", "Won"].map((w) => buttonNamed(root, w).getAttribute("tabindex")), ["-1", "0"], "the stop follows the choice");
  fire(buttonNamed(root, "Won"), "click");
  await settle();
  assert.equal(buttonNamed(root, "Won").getAttribute("aria-checked"), "true", "pressing a chosen radio keeps it chosen");
  render(null, root);
});

test("the actions are one line: the menu and the note actions first, the one primary last", async () => {
  installDom();
  const item = { ...SEEN, actions: [
    { id: "reopen", label: "Send back", style: "plain", needsNote: true },
    { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
    { id: "dismiss", label: "Hide", style: "plain", needsNote: false },
  ] };
  const root = await showTree(decision.DecisionCard, { item });
  const row = elements(root).find((e) => hasClass(e, "k-decision__actions") && classOf(e).includes("k-decision__actions"));
  const buttons = elements(row).filter((e) => e.localName === "button");
  assert.equal(textOf(buttons.at(-1)).trim(), "Accept", "the primary is last");
  assert.equal(buttons.filter((b) => classOf(b).includes("k-btn--primary")).length, 1, "one filled primary");
  assert.ok(classOf(buttonNamed(root, "Send back")).includes("k-btn--quiet"), "Send back is quiet words");
  assert.ok(buttons.some((b) => b.getAttribute("aria-label") === "More actions"), "the rest are in the menu");
  render(null, root);
});

test("DecisionCard: who and when on one line, the title, details each a label over its value; level makes it the page's title", async () => {
  installDom();
  const item = { ...SEEN, identifier: "STH-8", details: [
    { label: "Amount", value: "₹ 1,000.00" },
    { label: "What you can do", value: "Stop the task, or reply. The board will not start it again by itself until you say so." },
  ] };
  let root = await showTree(decision.DecisionCard, { item });
  const context = elements(root).find((e) => classOf(e).includes("k-decision__context"));
  assert.match(textOf(context), /Chief of staff · .+ · STH-8/);
  assert.equal(elements(root).find((e) => classOf(e).includes("k-decision__title")).localName, "h3");
  const rows = elements(root).filter((e) => /\bk-decision__detail\b/.test(classOf(e)));
  assert.equal(rows.length, 2);
  assert.ok(classOf(rows[0]).includes("k-decision__detail--figure"), "an amount is a figure");
  assert.ok(classOf(rows[1]).includes("k-decision__detail--long"), "a long sentence sits under its label");
  render(null, root);
  root = await showTree(decision.DecisionCard, { item, level: true });
  assert.ok(classOf(elements(root).find((e) => e.localName === "article")).includes("k-decision--level"));
  assert.equal(elements(root).find((e) => classOf(e).includes("k-decision__title")).localName, "h2");
  render(null, root);
  assert.equal(decision.isFigure("$1.85"), true);
  assert.equal(decision.isFigure("3 of 70"), true);
  assert.equal(decision.isFigure("Passed in round 2"), false);
  assert.equal(decision.isFigure(""), false);
  assert.equal(decision.isLongDetail("short"), false);
  assert.equal(decision.isLongDetail("x".repeat(49)), true);
});

test("an urgent card says so once, with the bad chip, and is not tinted", async () => {
  const urgent = await show(decision.DecisionCard, { item: { ...SEEN, severity: "high" } });
  const marks = elements(urgent).filter((e) => classOf(e).includes("k-tag--bad"));
  assert.equal(marks.length, 1, "one bad chip");
  assert.equal(textOf(marks[0]).trim(), "Urgent");
  assert.ok(classOf(marks[0]).includes("k-tag--quiet"), "the quiet bad tag: its words and a dot, no fill (R6-D)");
  assert.ok(!textOf(elements(urgent).find((e) => classOf(e).includes("k-decision__title"))).includes("Urgent"), "said once, not in the title");
  const calm = await show(decision.DecisionCard, { item: SEEN });
  assert.ok(!elements(calm).some((e) => classOf(e).includes("k-tag--bad")));
  const d = css("kit/decision.css");
  assert.doesNotMatch(d, /linear-gradient|--bg-warm|--border-warm|--warn-bg\)\s*,\s*var\(--glass|--glass|--highlight|--r-pill/, "no warm tint, glass or pill");
  assert.match(d, /\.k-decision \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: var\(--r-3\);[^}]*background: var\(--card\);[^}]*box-shadow: var\(--shadow-card\)/, "the card on the raised step");
  assert.doesNotMatch(d, /\.k-decision--high\s*\{/, "urgent changes no edge and no fill");
  assert.match(d, /\.k-card \.k-decision \{[^}]*border-color: transparent;[^}]*background: transparent;/, "no frame inside a frame");
  assert.match(d, /\.k-decision__actions \{[^}]*border-top: 1px solid var\(--line\)/, "the actions sit under a divider");
  assert.match(d, /\.k-decision__changed \{[^}]*border-left: 2px solid var\(--warn\)/, "a change is a thin amber rule");
});

test("drawer cards line up: a compact card puts each label over its value; a detail still starts with a capital (M18-12)", () => {
  const d = css("kit/decision.css");
  assert.match(d, /\.k-decision--compact \.k-decision__detail\s*\{\s*flex-direction: column;/);
  assert.match(d, /dd::first-letter\s*\{\s*text-transform: capitalize;/, "a detail still starts with a capital, without the banned uppercase rule");
});

// PLAN-COOK T104 (critics of round A1 on S09: "a lone outlined Reject and an orphan ... row"; "a debug table").
// T116 (round A2: "the footer strip is a plain grey block", "a 28px headline over 11-12px body text", "a form dump").
test("an opened item's actions are the card's footer: on the card's own surface under a rule, the primary at the right", () => {
  const d = css("kit/decision.css");
  assert.match(d, /\.k-decision--level \{[^}]*gap: var\(--s-4\);/, "the opened card's parts are 16 px apart");
  const rule = /\.k-decision--level \.k-decision__actions \{([^}]*)\}/.exec(d);
  assert.ok(rule, "the opened card places its actions");
  assert.match(rule[1], /margin: var\(--s-2\) calc\(-1 \* var\(--s-6\)\) calc\(-1 \* var\(--s-6\)\);/, "across the card's foot, edge to edge");
  assert.match(rule[1], /background: transparent;/, "on the card's own surface, not a grey block");
  assert.match(d, /\.k-decision__actions \{[^}]*border-top: 1px solid var\(--line\)/, "under a rule");
  assert.match(d, /\.k-decision__gap \{\s*flex: 1 1 0;/, "the primary pushed to the right");
  const title = /\.k-decision--level \.k-decision__title \{([^}]*)\}/.exec(d)[1];
  assert.match(title, /font-size: var\(--fs-stat\);/, "the headline 22 px");
  assert.match(title, /font-weight: var\(--fw-bold\);/, "at 600");
  assert.match(d, /\.k-decision__title \{[^}]*text-wrap: balance;/, "balanced lines");
  assert.match(d, /\.k-decision--level \.k-decision__details \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: var\(--s-4\) var\(--s-6\);/, "two columns, 16 px between rows");
  assert.match(d, /\.k-decision--level \.k-decision__detail \{\s*gap: var\(--s-1\);/, "a label 4 px over its value");
});

test("details: a label (12 px, third ink) over its value (14 px), never a label at one edge and its value at the other", () => {
  const d = css("kit/decision.css");
  const dt = /\.k-decision__detail dt \{([^}]*)\}/.exec(d)[1];
  const dd = /\.k-decision__detail dd \{([^}]*)\}/.exec(d)[1];
  assert.match(dt, /font-size: var\(--fs-label\);/);
  assert.match(dt, /color: var\(--ink-3\);/);
  assert.match(dd, /font-size: var\(--fs-ui\);/);
  assert.doesNotMatch(dd, /text-align: right/);
  assert.match(d, /\.k-decision__detail \{[^}]*flex-direction: column;/);
  assert.doesNotMatch(d, /\.k-decision__detail \{[^}]*justify-content: space-between/);
});

test("a refusal with one other action: Hide is a ghost, Reject stands at the right with its reason; nothing is a menu of one", async () => {
  installDom();
  assert.equal(decision.loneRest({ withNote: [], rest: [{ id: "dismiss" }] }), true);
  assert.equal(decision.loneRest({ withNote: [{ id: "answer" }], rest: [{ id: "dismiss" }] }), false);
  assert.equal(decision.loneRest({ withNote: [], rest: [{ id: "a" }, { id: "b" }] }), false);
  assert.equal(decision.loneRest({ withNote: [], rest: [] }), false);
  assert.equal(decision.DECISION_WORDS.asksOnce("Reject"), "Reject asks you once before anything is done.");
  const item = { ...SEEN, kind: "approval", actions: [
    { id: "reject", label: "Reject", style: "danger", needsNote: false },
    { id: "dismiss", label: "Hide", style: "plain", needsNote: false },
  ] };
  const root = await showTree(decision.DecisionCard, { item, level: true });
  const row = elements(root).find((e) => hasClass(e, "k-decision__actions"));
  const buttons = elements(row).filter((e) => e.localName === "button");
  assert.deepEqual(buttons.map((b) => textOf(b).trim()), ["Hide", "Reject"], "Hide first, Reject last at the right");
  assert.ok(classOf(buttons[0]).includes("k-btn--ghost"), "on the opened item a lone other action is a ghost");
  assert.ok(classOf(buttons[1]).split(/\s+/).includes("k-btn--danger-quiet"), "on the opened item Reject is the quiet danger: the danger ink, no fill (R6-D)");
  assert.ok(classOf(buttons[1]).includes("k-btn--md"), "the action at the default height");
  assert.ok(!buttons.some((b) => b.getAttribute("aria-label") === "More actions"), "no menu of one");
  assert.match(textOf(row), /Reject asks you once before anything is done\./);
  // Reject still asks once and sends nothing until the owner says yes.
  const net = stubFetch(() => ({ status: 200, body: { ok: true, message: "Rejected." } }));
  fire(buttons[1], "click");
  await settle();
  assert.equal(net.calls.length, 0, "nothing sent before the confirm");
  assert.match(textOf(root), /Reject\? This cannot be undone here\./);
  net.restore();
  render(null, root);
});

test("T97: a choice that cannot be taken is plainly inert: the third ink, the inert fill, the pointer says no, the radio flat", () => {
  const c = css("kit/decision.css");
  const off = /\.k-decision__choice:disabled,\s*\.k-decision__choice\[aria-disabled="true"\],[^{]*\{([^}]*)\}/.exec(c);
  assert.ok(off, "a disabled look for the choice row");
  assert.match(off[1], /background: color-mix\(in srgb, var\(--ink\) 5%, var\(--raise\)\);/);
  assert.match(off[1], /color: var\(--ink-3\);/);
  assert.match(off[1], /cursor: not-allowed;/);
  assert.match(off[1], /border-color: var\(--line\);/);
  const mark = /\.k-decision__choice:disabled \.k-decision__radio,[^{]*\{([^}]*)\}/.exec(c);
  assert.ok(mark);
  assert.match(mark[1], /border: 0;/);
  assert.match(mark[1], /background: var\(--line\);/);
});
