# 0008: The map, jobs and the company brain

## Context

The owner chose a reference video for the look of the interface and for four ideas in it: a company brain in the middle, work grouped as named jobs, a tag on each job for what is left to the owner, and a build order. They asked for every page to be redone in that style, using what the engine already has.

The look follows that video. Our code, names, icons, creatures and words are our own, and nothing is copied (the same rule as 0006). The new interface was built beside the old one and moved into place at the same address on 12 November 2026.

## Decision

- **The map is the home page.** The company brain sits in the middle and the seven departments around it, each with its jobs. Needs you is reachable from everywhere as a drawer and shows its count on the map. On a phone the map is a small crown over a plain list.
- **Jobs replace ready-made goals.** A job is one small file in `engine/company/` with a title, a department, a stage, a hand-off tag and the words the agent is given. There are 60, in seven departments. Starting a job makes a task through the same path as any task. A job that cannot start says why in one sentence.
- **Hand-off tags and stages.** Each job is "You lead", "You approve" or "On its own". The stages are Foundations, Take in, Make and Hand on.
- **The company brain is Files.** Nine basics filled through forms, ten folders, paste and upload. Every agent reads it before it works. **Only the owner writes it.** The one exception is the recipe log, which the home server writes from the Marketing scores, with numbers and neutral labels only, never words an agent wrote.
- **Handing work on is the owner's click.** A finished job offers the next job (call write-up, then proposal or quotation, then invoice draft). The chain moves only when the owner presses the button. Nothing is copied by hand and nothing moves by itself.
- **Answers from the brain are not checked.** The Chief of staff may answer a question from the files itself. It takes a minute or two, names the files it used, lists what the files do not say, and is labelled "Not checked". Work still goes through the Checker.
- **The Bookkeeper may draft quotations.** Drafts only, under the same guard as invoices. The owner said yes on 12 November 2026.

## Consequences

- Agent text must never reach the company brain. The recipe log, the answer card's version and the job markers each have a test that fails if it does (the security review of this phase found and closed these).
- Until the nine basics are filled, nine jobs wait. Three more stay dim for reasons that do not depend on the owner: agents have no internet, and sending needs a connected account.
- The old pages and words (Home, Docs, ready-made goals) are gone from the interface.
- An answer that sounds sure can still be wrong. The label says so, and "a checked answer from our files" remains a job for when it matters.

## Rejected

- Letting agents write to the company brain: a sentence an agent plants would be read by every other agent (see 0007).
- Running the Checker on every answer: it turns one minute into six to ten.
- Chaining jobs automatically: it removes the owner's yes.
- Keeping the old interface beside the new one: two sets of words for one thing.
