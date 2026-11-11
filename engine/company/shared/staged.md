Every agent works this way. The Chief of staff runs it; you follow your part below.

**How work is sized.** The Chief of staff's first comment on a task starts `SIZE: <XS|S|M|L|XL> - <why>`.

- XS is a few minutes and one file. S is one agent, under an hour.
- M is several steps or two agents. L is several agents and about a day.
- XL is too big for one task: the owner is asked first whether to split it.
- XS and S get one step for one agent, then one Checker step. No documents.
- M, L and XL get the brief, then the plan, then the plan's steps one at a time, then the summary, then the Checker.

**The documents and where they go.** They live in the goal's folder inside your current working folder, named after the goal's identifier. Use these names and headings exactly; `{title}` is the task's title.

- `00-brief.md`: `# Brief: {title}`, then `## The goal in the owner's words`, `## What done looks like`, `## Must-haves`, `## Nice-to-haves`, `## Anything unclear`.
- `01-plan.md`: `# Plan: {title}`, then `## Approach`, `## What will be produced`, `## Steps`, `## Anything unclear`.
- Each step of the plan is one line, `1. <what the step does> - <Agent name>`, and under it `   needs: <what it needs from the step before, or "nothing">`.
- `04-summary.md`, written by the Chief of staff from the agents' reports before the check: `# Summary: {title}`, then `## What was done`, `## Files`, `## What is left`.
- Under `## Files`, one line per file: `- <path inside the goal's folder>: <what it is>`.

**When something is unclear.** Never guess.

- Write each question under `## Anything unclear`, one per line. Write `None.` when there is nothing.
- If a document has a question, the task is set to blocked and work stops.
- The owner answers in a comment starting `ANSWER:`. The document is then rewritten with the answer folded in and `## Anything unclear` set to `None.`, and work carries on.

**Plan first.** When the task's text ends with `PLAN FIRST`:

- Write the brief and the plan, comment `PLAN READY:` and one line, set the task to blocked and stop.
- Carry on only after a comment `PLAN ACCEPTED`.
- A note from the owner instead means: change the plan, then comment `PLAN READY:` again.

**The check and its rounds.** The Checker answers six questions in one comment that starts `VERDICT: PASS - <reason>` or `VERDICT: FAIL - <reason>`. Each such comment is one round.

- A FAIL goes back to the agent that did the work, with the Checker's actions. That agent does exactly those, and the Checker checks again.
- After the fifth FAIL the Chief of staff comments `STOPPED: five check rounds did not pass` with one plain paragraph, sets the task to blocked and stops.
- On a PASS the Chief of staff comments `RESULT:` and sets the task to done. The owner then accepts it or sends it back.

**A task that starts `FOR:`.** A task whose text starts `FOR: <Agent name>` is the owner speaking to that agent.

- It is one step for that agent, then the Checker. The Chief of staff does not split it.
- A task whose text ends `ROUTINE: <id>` came from a routine. Treat it like any other task.

**What never changes.**

- Drafts only. Nothing is made final without the owner.
- Nothing is sent, posted or published outside the company.
- One folder: the goal's folder inside your current working folder. Never name, ask for or try another one.
- Every file you name in a comment is a path inside the goal's folder.
