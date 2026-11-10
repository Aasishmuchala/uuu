# Trial run: paperclip with two agents on this Mac

Label: wayfinder:prototype
Type: prototype
Status: resolved
Blocked by: 01, 04

## Question

Does paperclip hold up on this Mac with two agents? Stand it up, create one company, hire Claude Code and Codex, give them one small internal goal, and watch: does work get assigned, done and reviewed, how much memory does it take, and what breaks?

## Answer

Yes, for one agent. Trial run on 11 November 2026.

- Paperclip 2026.1106.0 installed (2.9 GB) and ran healthy on this Mac with Node 24.13: about 0.7 GB of memory idle.
- One task went end to end: the Builder, inside the fence, wrote its file and marked the task done through paperclip's own tools.
- The fence passes twelve of twelve checks: no SSH keys, no home folder, no owner Claude settings, no paperclip secrets, no other Claude sessions' temp files, no open internet, no other local ports; its own task folder works; the agent answers from inside.
- The fence is Anthropic's sandbox-runtime around a wrapper named `claude`, placed first on paperclip's PATH, so every Claude agent is fenced by default. The agent has its own Claude config folder and its own login token.
- The second agent was not run. Codex behind the fence is its own ticket: "The same fence around Codex".
- Not settled by the trial: enforcing one task at a time, the run time limit, and removing the Builder's right to create agents. Paperclip's CLI rejected those two updates.

Prototype and full findings: branch `prototype/fence-trial`, file `engine/prototype-fence/README.md`.
