// The kit's agent chip and card (CONTRACTS-V2 13.2): the stylesheet's rules. Their root classes are pinned in
// brief.test.mjs, beside the brief card's. Split out of kit-b (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, textOf, withClass, showNow as show } from "./_dom.mjs";
import { shape } from "./_fixtures.mjs";
import { css, compositeSheetTests } from "./_rules.mjs";

const agent = await import(pathToFileURL(join(KIT, "agent.js")).href);

// PLAN-COOK T37: an avatar, the name at 15 px, the state as a state line (St); no department colour (O7); the card
// is the kit's card (the raised step, a hairline, the soft shadow in light), not glass.
test("AgentState is a state line in words; AgentCard is the kit's card with the name at 15 px", () => {
  const card = shape("agent-card");
  const cases = [
    [{ ...card, state: "working" }, "k-st--good", "Working"],
    [{ ...card, waitingForYou: true }, "k-st--warn", "Waiting for you"],
    [{ ...card, state: "problem", plainState: "Stuck" }, "k-st--bad", "Stuck"],
    [{ ...card, state: "paused", plainState: "Paused" }, "k-st--neutral", "Paused"],
    [{ ...card, state: "free", plainState: "" }, "k-st--neutral", "Free"],
  ];
  for (const [a, cls, words] of cases) {
    const root = show(agent.AgentState, { agent: a });
    assert.equal(withClass(root, cls).length, 1, `${words}: ${cls}`);
    assert.equal(textOf(root).trim(), words);
    assert.equal(withClass(root, "k-dot").length, 0, "no dot: a glyph and words");
  }
  const root = show(agent.AgentCard, { agent: card });
  assert.match(textOf(root), new RegExp(card.summary.replace(/[.]/g, "\\.")));
  assert.match(textOf(root), /Now: Draw the walk cycle/);
  const c = css("kit/agent.css");
  assert.match(c, /\.k-agent__title\s*\{[^}]*font-size: var\(--fs-fact\);[^}]*font-weight: var\(--fw-medium\);/);
  assert.match(c, /\.k-agent--card\s*\{[^}]*border: 1px solid var\(--line\);[^}]*background: var\(--card\);[^}]*box-shadow: var\(--shadow-card\);/);
  assert.doesNotMatch(c, /--glass|--highlight|--r-pill|var\(--dept|translateY/);
});

// PLAN-COOK TB4: a header carries the state as the kit's chip, in the state's tone.
test("AgentState as a chip: the kit's Tag in the state's tone, the same words", () => {
  const card = shape("agent-card");
  const cases = [
    [{ ...card, state: "working" }, "k-tag--good", "Working"],
    [{ ...card, waitingForYou: true }, "k-tag--warn", "Waiting for you"],
    [{ ...card, state: "problem", plainState: "Stuck" }, "k-tag--bad", "Stuck"],
    [{ ...card, state: "paused", plainState: "Paused" }, "k-tag--neutral", "Paused"],
    [{ ...card, state: "free", plainState: "" }, "k-tag--neutral", "Free"],
  ];
  for (const [a, cls, words] of cases) {
    const root = show(agent.AgentState, { agent: a, chip: true });
    assert.equal(withClass(root, cls).length, 1, `${words}: ${cls}`);
    assert.equal(textOf(root).trim(), words);
    assert.deepEqual(agent.agentStateOf(a).words, words);
  }
  assert.equal(agent.agentStateOf(null), null);
});

compositeSheetTests("agent");
