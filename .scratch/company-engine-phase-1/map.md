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

- [What paperclip needs to run on this Mac](issues/01-what-paperclip-needs-to-run.md): only a Node upgrade to 24.11 or later; no Docker or separate database; data under `~/.paperclip`.
- [How paperclip keeps secrets and isolates agent runs on macOS](issues/02-how-paperclip-keeps-secrets-and-isolates-runs.md): secrets are encrypted at rest but reach agents as plain environment variables; on a Mac, agent runs are unsandboxed and skip permission prompts by default; its built-in confinement is Linux-only.
- [How paperclip budgets work on subscription plans](issues/03-how-paperclip-budgets-work-on-subscription-plans.md): budgets are money-only and subscription runs record 0 cents, so budgets cannot limit them; plan quota running out reschedules the task and asks no one.
- [Install Node 24 beside Node 22](issues/04-install-node-24-beside-node-22.md): Node 24.13 is already installed under nvm; the engine uses it by PATH and nothing else changes.
- [The first agents and their jobs](issues/06-the-first-agents-and-their-jobs.md): Chief of staff and Builder on Claude Code, Checker on Codex; both report to the chief of staff, who reports to the owner.
- [The real work for the two-week proof](issues/07-the-real-work-for-the-two-week-proof.md): prepare phase 2 (the books), ending in a written spec; nothing leaves the building.
- [What needs approval](issues/08-what-needs-approval.md): free inside the task folder, everything else blocked, only finished work reaches the owner.
- [Secrets and sandboxing in phase 1](issues/09-secrets-and-sandboxing-in-phase-1.md): each tool's own sandbox with skip-permissions off, sandbox-runtime as a fallback wrapper, no secrets for agents, proven by a failed read of the SSH keys.
- [Each agent's budget](issues/10-each-agents-budget.md): one task at a time, a time limit per run, and agents run only while the engine is switched on.
- [What proves phase 1 worked](issues/11-what-proves-phase-1-worked.md): 20 checked tasks, fence test passing at both ends, plan never exhausted, 15 minutes a day or less, phase 2 spec delivered.
- [Trial run: paperclip with two agents on this Mac](issues/05-trial-run-paperclip-with-two-agents.md): yes for one agent; a fenced Builder finished a task under paperclip and the fence passes twelve of twelve checks. Prototype on branch `prototype/fence-trial`.

## Not yet specified

- How the company definition (org chart, agents, skills) is kept under version control in this repo. Paperclip has `company export` to a portable markdown package; untried.
- Which skills each agent loads, and how they are tested before use. Waits on the first agents being chosen.
- What the check-before-done step looks like in practice. Waits on the trial run showing paperclip's review stages.
- Backups of paperclip's data. Paperclip backs its database up hourly and keeps 30 days under `~/.paperclip/instances/default/data/backups`; a copy off this Mac is undecided.
- How to enforce one task at a time, the run time limit, and no right for the Builder to create agents. Paperclip's CLI rejected those updates in the trial.

## Out of scope

- Phases 2 to 8 of the blueprint: the books, customers, memory, marketing and PR, creative studio, HR and CAD, home screen. Each is a later map.
- Selling the engine to others.
- Any work that leaves the building in phase 1: customer messages, posts, emails.
- Phone and remote access. Opening the engine to the network needs its own decision later.
