# The same fence around Codex

Label: wayfinder:prototype
Type: prototype
Status: resolved

## Question

Does the same fence hold around Codex, so it can be the checker? Codex's own sandbox lets it read every file, so it has to run inside the outer fence with its own sandbox off. Find out what Codex needs to reach (its login file, its config folder, which hosts), put a wrapper named `codex` beside the `claude` one, and run the same proof plus one task under paperclip.

## Answer

Yes. Trial run on 11 November 2026.

- The Checker runs on Codex inside the same fence as the Claude agents. Under paperclip it read the Builder's file, wrote PASS with the reason, posted it on the board and marked its task done, in about 30 seconds.
- All three roles finished one goal together: the owner gave the Chief of staff a goal, it created a task for the Builder and then one for the Checker, reported the result and the verdict to the owner, and closed the goal. 5 runs, under 8 minutes, all fenced.
- The proof now runs for both tools: 14 of 15 checks pass for each. The one failure is not in the fence. It is the board, and it has its own ticket: "Who counts as the owner on the board".
- What Codex needed: certificates pointed at the system bundle; three OpenAI hosts and the board; the home folder paperclip generates per agent; the chain of links to its login file; the skill folders paperclip links in; pipes of its own (it crashed twice on a pipe shared with the programs above it); and the fence's proxy settings passed to its shell tool.
- Paperclip ties a folder to the task, not to the agent. A child task starts in its parent's folder, so everyone on one goal shares one folder. Task text must say "your current working folder" and never name a path.
- Settled along the way: no agent may create agents or skills; only the Chief of staff may assign tasks; one run at a time and a 15-minute limit for each agent; Builder and Checker report to the Chief of staff. Paperclip accepts these through its permissions command and at agent creation.
- Paperclip is started with no usage reports to its makers and with Codex's shared home set to the engine's own, never the owner's.
- Not done: the Checker still uses the owner's own Codex login file through a link. Ticket: "A Codex login of its own for the Checker".

Prototype and full findings: branch `prototype/fence-trial`, file `engine/prototype-fence/README.md`.
