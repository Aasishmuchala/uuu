# 0005: A staged way of working

## Context

Without a fixed way of working, each agent invents its own. Small jobs get heavy paperwork, big jobs get none, and the owner cannot tell what was checked. The owner also wants to see a plan before big work starts, and to accept work by seeing evidence.

## Decision

Every role works the same way. One shared text, folded into every role's instructions by `apply`, teaches it.

- **Sizes.** The Chief of staff's first comment gives the size, XS to XL. XS and S go to one agent, then the Checker, with no documents. M and L get a brief, a plan, the steps, a summary and a check. XL is too big: the owner is asked whether to split it.
- **Documents.** Fixed names and headings in the task's folder: `00-brief.md`, `01-plan.md`, `04-summary.md`. Brief and plan end with "Anything unclear". If it is not empty, the work waits and the question appears under Needs you.
- **The check is a comment, not a file.** The Checker's folder is read-only, so it cannot write a file. Its comment answers six numbered yes or no questions and starts with `VERDICT: PASS` or `VERDICT: FAIL`. The Chief of staff cannot change it, because it never copies it.
- **Rounds.** Each check comment is one round. A fail goes back to the agent that did the work. After the fifth fail the task stops and asks the owner.
- **Plan first.** A task ending `PLAN FIRST` stops after the brief and the plan, until the owner accepts.
- **`FOR:`.** A task starting `FOR: <name>` is one step for that agent, then the Checker. It is not handed straight to the agent, because only the Chief of staff may hand out tasks and nothing else would check the work.

From MetaGPT we took the idea: fixed documents, sizing, "anything unclear", six yes or no questions, a one-word verdict and caps on rounds. We took no code and did not run it. We did not take its full chain of documents for every job.

## Consequences

- The home server reads these documents and comments to show stages, rounds and the timeline.
- Agents are held to the format by text, not by code. A badly formed comment shows as a gap in the acceptance view.
- Changing the format means changing the shared text and the parser together.

## Rejected

- Ten copies of the procedure, one per role. They would drift apart.
- A writable folder for the Checker, or a copied check file.
- Assigning a task straight to one agent.
