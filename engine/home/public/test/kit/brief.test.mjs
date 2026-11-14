// The kit's brief card (CONTRACTS-V2 13.2), and two tests over several composites that read brief.js first: the
// pinned root classes, and agents' words kept as text. Split out of kit-b (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT, walkVNode as walk } from "./_dom.mjs";
import { COMPOSITE_PINNED, UNTRUSTED, shape } from "./_fixtures.mjs";
import { compositeSheetTests } from "./_rules.mjs";

const MODULES = Object.keys(COMPOSITE_PINNED);
const load = (name) => import(join(KIT, `${name}.js`));

test("BriefCard, AgentCard, AgentChip, DocView, Figures, DataTable: pinned root classes", async () => {
  const { BriefCard } = await load("brief");
  const { AgentCard, AgentChip } = await load("agent");
  const { DocView } = await load("doc");
  const { DataTable, Figures } = await load("table");
  const item = shape("home").brief.items[0];
  const b = walk(BriefCard({ item }));
  assert.ok(b.classes.includes("k-brief"));
  assert.ok(b.text.includes("FYI"));
  assert.ok(b.text.includes(item.about.label));
  assert.ok(walk(AgentCard({ agent: shape("agent-card") })).classes.includes("k-agent"));
  const chip = walk(AgentChip({ agent: shape("who") }));
  assert.ok(chip.classes.includes("k-agent"));
  assert.ok(chip.props.some((p) => p.href === "#/team/artist"));
  const stage = shape("task").stages[0];
  assert.ok(walk(DocView({ doc: stage.doc, unclear: [] })).classes.includes("k-doc"));
  const unclear = walk(DocView({ doc: { name: "01-plan.md", sections: [{ heading: "Anything unclear", text: "Which colour?" }] }, unclear: ["Which colour?"] }));
  assert.ok(unclear.classes.includes("k-doc__unclear"));
  assert.ok(walk(Figures({ figures: [{ id: "a", label: "Open", value: "3" }] })).classes.includes("k-figures"));
  const t = walk(DataTable({ columns: [{ key: "a", label: "A" }], rows: [{ id: 1, a: "x" }] }));
  assert.ok(t.classes.includes("k-table"));
  assert.ok(walk(DataTable({ columns: [], rows: [], emptyText: "None yet." })).text.includes("None yet."));
});

test("agents' words are rendered as text, never as HTML", async () => {
  const { BriefCard } = await load("brief");
  const { Conversation } = await load("conversation");
  const { DocView } = await load("doc");
  const { TaskCard } = await load("task-card");
  const outs = [
    walk(BriefCard({ item: { ...shape("home").brief.items[0], title: UNTRUSTED, text: UNTRUSTED } })),
    walk(Conversation({ messages: [{ who: shape("who"), kind: "comment", text: UNTRUSTED, at: null }] })),
    walk(DocView({ doc: { name: "x.md", sections: [{ heading: UNTRUSTED, text: UNTRUSTED }] } })),
    walk(TaskCard({ task: { ...shape("task-card"), title: UNTRUSTED } })),
  ];
  for (const o of outs) {
    assert.ok(o.text.includes(UNTRUSTED), "shown as a text node");
    assert.ok(!o.props.some((p) => "dangerouslySetInnerHTML" in p));
  }
  for (const name of MODULES) {
    const src = readFileSync(join(KIT, `${name}.js`), "utf8");
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src), `${name}.js sets no HTML`);
  }
});

compositeSheetTests("brief");
