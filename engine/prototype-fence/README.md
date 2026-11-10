# PROTOTYPE: fence trial

Throwaway code that answers one question for the ticket "Trial run: paperclip with two agents on this Mac": can an agent run under paperclip on this Mac without being able to reach the owner's files?

## Run it

- `./prove-fence.sh` runs the checks and prints PASS, FAIL or SKIP for each.
- `./login-wizard.sh` is for the owner to run in a terminal. It creates the agent's own Claude login, then runs the checks.

## What is here

- `fence-run`: runs any command inside the fence, using Anthropic's sandbox-runtime.
- `fenced-claude`: Claude Code inside the fence, with its own config folder and token. Meant to become the `command` of paperclip's `claude_local` adapter.
- `prove-fence.sh`: the proof.
- `login-wizard.sh`: the one step only the owner can do.

## Verdict (11 November 2026)

Yes. Paperclip ran a fenced agent on this Mac and one task went end to end: the Builder, inside the fence, wrote its file and marked the task done through paperclip's own tools. Twelve of twelve fence checks pass.

## What the trial forced

- **The wrapper must be a file named `claude`, first on paperclip's PATH.** Paperclip tests the `claude` on its own PATH and refuses to activate an agent whose command is anything else. Starting paperclip with `bin/` first on PATH also means every Claude agent is fenced by default.
- **The real Claude Code is called by its full path** from inside the wrapper, so the wrapper never calls itself.
- **Runner `legacy`, engine `cli`, command `claude`.** The default runner rejects a custom command.
- **Model `sonnet`, the alias.** Paperclip wants Claude Code 2.1.284 or newer for the newest model names, and this Mac has 2.1.268.
- **`--` before the command** when calling the sandbox tool, or it reads flags such as `--version` as its own.
- **A short TMPDIR for the sandbox tool.** Paperclip's per-run temp path makes its socket path longer than macOS allows. The command gets its own temp folder back inside the fence, and Claude Code is pointed at it with `CLAUDE_CODE_TMPDIR`.
- **`NO_PROXY` emptied inside the fence**, so calls to paperclip on `127.0.0.1:3100` go through the sandbox tool's proxy. That one local port is allowed; every other is refused.
- **The agent needs its own login.** `claude setup-token`, saved outside the fence. The token wraps onto two lines and is easy to paste twice, so the wizard joins lines and drops repeats.

## Measured

- Install: 2.9 GB under `engine/node_modules`.
- Memory: about 0.7 GB idle, about 1.2 GB at start-up.
- One dependency warns that it wants Node 24.15; this Mac has 24.13. Nothing failed.

## Not covered by this trial

- A second agent. Codex for the checker is unproven behind the fence.
- The run time limit (set to 15 minutes, never reached) and one-task-at-a-time (paperclip's CLI rejected that update).
- The Builder can still create agents and skills in paperclip's permissions; that update was rejected too.

## Findings so far (11 November 2026)

- Paperclip 2026.1106.0 installs and starts on this Mac with Node 24.13: health `ok`, local-only, about 1.2 GB of memory across the server and its database, with no agents.
- The fence holds for plain commands: nine of nine checks pass. An agent's command cannot read the SSH keys, the home folder, the owner's Claude settings, paperclip's secrets key or the agent login file; cannot write outside its task folder; and cannot reach the open internet. It can read and write its own task folder.
- Claude Code starts inside the fence with its own config folder and reports "Not logged in". It needs its own token, which is what the wizard creates.
- The decision "each tool's own sandbox first" does not survive: Codex's own sandbox allows reading every file, and Claude Code's covers only its shell commands. The outer fence is the real boundary; inside it the tools run with their own prompts off, which is what their documentation intends for an externally sandboxed run.
- Paperclip's `claude_local` adapter documents `command`, `engine: "cli"`, `env`, `extraArgs`, `timeoutSec` and `maxTurnsPerRun`, so the wrapper route looks open. Not yet exercised.

## Still to prove

- The agent answers from inside the fence (needs the login).
- Paperclip runs an agent through `fenced-claude` and the task completes.
- The same fence around Codex.
