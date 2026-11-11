# What an agent's own board rights still allow

Label: wayfinder:prototype
Type: prototype
Status: resolved
Blocked by: 13

## Question

Once the board can tell an agent from the owner, what can an agent still change with its own login? In the trial the Builder moved its own task to a different folder, and every agent still holds default grants such as "configure agents", "create skills" and "manage tools". Test with a real agent login: can it switch its runner (which could bypass the fenced wrapper), point a task at a folder of its choosing, or change another agent? Remove the grants the three roles do not need, and add the tests to the proof.

## What is known

- Paperclip's code refuses agents these settings on local adapters: `command`, `cwd`, `env`, `args`, `extraArgs`, and it refuses agents the `process` adapter.
- The fence refuses to start in any folder outside the engine's and paperclip's task-folder trees, so a wrong folder cannot expose the owner's home.
- Untested: the runner switch, and which of the default grants can be removed without breaking the heartbeat routine.

## Answer

Found: the board gives every agent default grants (configure agents, create skills, manage tool connections and more), and the owner cannot remove them over the board's interface. They cannot be trimmed, so they are blocked at the gate instead.

The gate now refuses every change an agent asks for, except a short list of what the work needs (13 rows: create a task, update it, comment, check out, release, documents, ask for an approval and the like). It also reads request bodies: a task change that carries launch settings, a workspace or a project is refused, and so is an approval to hire an agent. The company files no longer pretend to trim grants.

Proof lines that show it, each passing: "the gate refuses an agent PATCH /api/agents/... (agents-write)", "... POST /api/companies/.../agents (agents-create)", "... PUT /api/issues/x/workspace (task-folder)", "... POST /mcp/runtime-tools (tools-endpoint)", "... POST /api/companies/.../skills (not-allowed)", "... PATCH /api/issues/x (task-launch-settings)" and "... POST /api/companies/.../approvals (approval-type)". Last result: 101 passed, 0 failed. See `docs/adr/0001-the-gate-in-front-of-the-board.md`.
