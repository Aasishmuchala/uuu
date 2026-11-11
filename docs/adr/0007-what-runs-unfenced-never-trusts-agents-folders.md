# 0007: What runs unfenced never trusts what agents can write

## Context

The fence holds an agent inside its task folder. But three things run outside the fence, with the owner's rights, and look at folders agents can write to: the board (it runs git in task folders), the helpers that work out an agent's fence before each run (they read the agent's own home), and the home screen (it reads agents' files and acts on the board as the owner).

The final review on 11 November 2026 found two ways through, and a live trial found a third problem of the same family:

- An agent could lay out a git repository in its task folder whose settings name a program. The board's next git command there would run it as the owner.
- A Codex agent could plant a link in its own skills folder. The helper shared the link's target on the next run, so the agent could read the board's private files.
- The board put a task on hold after one of its own repair runs was cancelled in a race. Nothing in the board clears such a hold, so a finished task never reached the owner.

## Decision

Anything that runs unfenced treats what agents can write as hostile, and each such place has one narrow rule.

- **Git.** The first `git` on the board's PATH is the engine's wrapper. It refuses to run at all under the state folder and paperclip's workspace trees. The board starts with its own empty git settings and refuses to start without the wrapper.
- **Fence helpers.** A Codex skill link must end inside paperclip's skills folder for the company. The login file may only chain through four known places. The planner itself keeps a short list of allowed places for the agent home, the temp folder and every extra path, so a mistake in a helper cannot widen a fence.
- **Holds.** The home screen checks every open task once a minute. When the board holds a task and the run behind the hold provably never started (no process, no output, no log), the home screen hands the task back as the owner. Every other hold is shown in Needs you as "A task stopped", with only the actions the board accepts.
- **Paths are compared as the disk sees them.** This Mac's disk ignores letter case and has a second name for every folder. The git wrapper resolves each folder to its true path first, and the planner compares without regard to case and allows only two folders inside the state folder as an agent's home.
- **One Claude home per agent.** Agents with different rights no longer share a Claude Code home, so a settings or instruction file one agent writes cannot load in another agent's run.
- **Agent text is capped and never trusted as a record.** Text an agent wrote is cut to a fixed length before the home screen cleans or summarises it. A task is treated as a fix task, a check or a question only from records agents cannot write (who wrote the comment, what the home screen itself created).
- **The Checker never blocks.** It finishes every check with a verdict and puts questions for the owner in the check, because a blocked check step is what set off the hold.

## Consequences

- Agents cannot use git inside their task folders, and paperclip's git workspaces, restore points and skills from GitHub are off. The engine uses none of them.
- The home screen now takes one action on the board without the owner pressing anything. It is limited to the one case where nothing can be repeated, tried at most three times, and written to the home log.
- Each rule has a proof check or a test that fails on the old code, and the orchestrator's own hidden checks cover the planner.

## Rejected

- Trusting git's own safety settings alone: a `.git` file in a subfolder with a filter still ran a program.
- A regular wake-up for the Chief of staff to recover held tasks: wake-ups hit the same hold, and each one costs a model run.
- Letting the owner clear every hold by hand: the common case is safe to clear and would otherwise leave finished work unseen.
