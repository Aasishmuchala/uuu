# Company engine: phase 1, the minimum company

Label: wayfinder:map

## Destination

A buildable spec for phase 1 of the engine: paperclip as the company plane, running two or three agents on this Mac, with secrets, sandboxing, budgets and approvals decided, and a test that proves it worked. Reached when nothing is left to decide before `/to-spec`.

## Notes

- Domain: the company engine. Read `company-engine-blueprint.md` for the design and `GLOSSARY.md` for the vocabulary.
- The first company on the engine is the owner's own. The owner is the only person on the org chart, so every approval goes to them.
- Money rule: free software only. The only paid things are the Claude and Codex plans already in place.
- Phase 1 runs on this Mac: M1 Pro, 16 GB memory, about 21 GB free disk, no Docker, Node 22 (paperclip needs 24.11 or later).
- Built-in first: use what paperclip ships. Add a separate memory tool, sign-in server, model gateway or tracing only when a research ticket shows a real gap.
- Research findings live on `research/<name>` branches, one file each under `docs/research/`.
- Skills to consult: grilling and domain-modeling for grilling tickets; research for research tickets; prototype for the trial run.

## Decisions so far

<!-- the index: one line per closed ticket, with a link to the ticket that holds the detail -->

## Not yet specified

- How the company definition (org chart, agents, skills) is kept under version control in this repo. Waits on what paperclip can export.
- Which skills each agent loads, and how they are tested before use. Waits on the first agents being chosen.
- What the check-before-done step looks like in practice. Waits on the trial run showing paperclip's review stages.
- Backups of paperclip's data. Waits on knowing where it stores things.

## Out of scope

- Phases 2 to 8 of the blueprint: the books, customers, memory, marketing and PR, creative studio, HR and CAD, home screen. Each is a later map.
- Selling the engine to others.
- Any work that leaves the building in phase 1: customer messages, posts, emails.
- Phone and remote access. Opening the engine to the network needs its own decision later.
