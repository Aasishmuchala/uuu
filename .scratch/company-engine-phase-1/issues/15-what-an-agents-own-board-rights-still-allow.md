# What an agent's own board rights still allow

Label: wayfinder:prototype
Type: prototype
Status: open
Blocked by: 13

## Question

Once the board can tell an agent from the owner, what can an agent still change with its own login? In the trial the Builder moved its own task to a different folder, and every agent still holds default grants such as "configure agents", "create skills" and "manage tools". Test with a real agent login: can it switch its runner (which could bypass the fenced wrapper), point a task at a folder of its choosing, or change another agent? Remove the grants the three roles do not need, and add the tests to the proof.

## What is known

- Paperclip's code refuses agents these settings on local adapters: `command`, `cwd`, `env`, `args`, `extraArgs`, and it refuses agents the `process` adapter.
- The fence refuses to start in any folder outside the engine's and paperclip's task-folder trees, so a wrong folder cannot expose the owner's home.
- Untested: the runner switch, and which of the default grants can be removed without breaking the heartbeat routine.
