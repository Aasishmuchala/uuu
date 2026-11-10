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
