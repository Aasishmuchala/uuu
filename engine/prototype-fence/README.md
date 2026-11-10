# PROTOTYPE: fence trial

Throwaway code that answers two questions for the phase 1 map:

1. Can an agent run under paperclip on this Mac without being able to reach the owner's files? (ticket "Trial run: paperclip with two agents on this Mac")
2. Does the same fence hold around Codex, so it can be the Checker? (ticket "The same fence around Codex")

## Run it

- `./start-paperclip.sh` starts paperclip the only way the engine may start it: fenced wrappers first on its PATH, no model API keys, no usage reports.
- `./prove-fence.sh` runs the checks for both tools and prints PASS, FAIL, SKIP or NOTE for each.
- `./login-wizard.sh` is for the owner to run in a terminal. It creates the Claude agents' own login, then runs the checks.

## What is here

- `fence-run`: runs any command inside the fence, using Anthropic's sandbox-runtime. Refuses to start in a folder that is not an agent task folder.
- `fenced-claude`, `fenced-codex`: each tool inside the fence, with its own home folder and login.
- `bin/claude`, `bin/codex`: the same wrappers under the names paperclip looks for.
- `blocking-exec.py`: puts the pipes back into blocking mode before Codex starts.
- `prove-fence.sh`: the proof. `login-wizard.sh`: the one step only the owner can do.

## Verdict (11 November 2026)

- **Claude Code: yes.** A fenced Builder finished a task under paperclip.
- **Codex: yes.** A fenced Checker read the Builder's file (read-only), wrote PASS with the reason, posted it on the board and marked its task done.
- **All three roles: THREE_ROLE_RESULT**
- **One gap is open, and it is not in the fence: the board.** In paperclip's default local mode, a request with no login counts as the owner. An agent inside the fence can reach the board, so it could act as the owner there, and an owner can create an agent that runs any command. The proof shows this as its one FAIL per tool. See "The gap in the board" below.

Proof today: 14 of 15 checks pass for each tool; the one failure is the board gap.

## What the trial forced: Claude Code

- **The wrapper must be a file named `claude`, first on paperclip's PATH.** Paperclip tests the `claude` on its own PATH and refuses to activate an agent whose command is anything else. This also means every Claude agent is fenced by default.
- **The real Claude Code is called by its full path** from inside the wrapper, so the wrapper never calls itself.
- **Runner `legacy`, engine `cli`, command `claude`.** The default runner rejects a custom command.
- **Model aliases (`sonnet`, `opus`), not full model names.** Paperclip wants Claude Code 2.1.284 or newer for the newest names, and this Mac has 2.1.268.
- **`--` before the command** when calling the sandbox tool, or it reads flags such as `--version` as its own.
- **A short TMPDIR for the sandbox tool.** Paperclip's per-run temp path makes its socket path longer than macOS allows. The command gets its own temp folder back inside the fence, and Claude Code is pointed at it with `CLAUDE_CODE_TMPDIR`.
- **`NO_PROXY` emptied inside the fence**, so calls to paperclip on `127.0.0.1:3100` go through the sandbox tool's proxy. That one local port is allowed; every other is refused.
- **The agent needs its own login.** `claude setup-token`, saved outside the fence. The token wraps onto two lines and is easy to paste twice, so the wizard joins lines and drops repeats.

## What the trial forced: Codex

- **Certificates.** Inside the fence Codex cannot ask macOS for its trusted certificates, and every HTTPS call fails with "error sending request". Fixed by `SSL_CERT_FILE=/etc/ssl/cert.pem` (and `CODEX_CA_CERTIFICATE`).
- **Hosts.** `chatgpt.com`, `api.openai.com`, `auth.openai.com` and the board. Nothing else was needed.
- **Paperclip picks the Codex home, a new generated folder per agent,** under `~/.paperclip/instances/default/companies/<company>/codex-home/skill-runtimes/`. The wrapper accepts only homes under that tree or the engine's own, and fences that one folder.
- **The login file is a chain of links** ending at the shared login. The wrapper follows the chain and allows each link to be read and the last file to be written, so token refresh works.
- **Skills are links pointing outside the home.** The wrapper allows reading what they point at.
- **Paperclip's start-up check uses the server's own `CODEX_HOME`,** so `start-paperclip.sh` sets it to the engine's Codex home, never the owner's `~/.codex`.
- **Engine `cli` is required.** The default engine launches a different program and would bypass the wrapper.
- **Blocking pipes.** The Node programs above Codex leave the shared pipes in non-blocking mode. On a large write Codex crashed with "Resource temporarily unavailable (os error 35)". Fixed by `blocking-exec.py`, which also lets the wrapper start the native Codex program directly.
- **Proxy settings for Codex's shell tool.** Paperclip tells Codex to hand its shell tool only a fixed list of variables. The fence's proxy settings are not on it, so every call from the shell tool to the board was refused. The wrapper adds them to the list.
- **The Checker reads the Builder's folder through a `<task folder>.reads` file** that sits beside its task folder, where no agent can write. Read-only: a write there is refused.
- **Bundled Codex is 0.156.1.** Fine for the default model; paperclip notes its extra tracing wants 0.160.0.

## The gap in the board

- Paperclip's code (`server/dist/middleware/auth.js`): in `local_trusted` mode every request without a login token is the owner, with full rights.
- When a request does carry an agent's token, paperclip itself refuses agents the dangerous changes: `command`, `cwd`, `env`, `args`, and the `process` adapter. So the gap is only the missing login.
- Two ways to close it. Built in: switch paperclip to its `authenticated` mode, where the owner signs in to the board and a request with no login is nobody; paperclip has a one-time "claim" link that hands the existing company to the signed-in owner. Or custom: a small gate in front of the board that refuses requests without a token. The map has this as an open decision.
- Until it is closed, agents should run only on small, watched tasks.

## Rights and limits set in the trial

- All three agents: cannot create agents or skills; one run at a time; 15-minute run limit. Only the Chief of staff may assign tasks.
- Builder and Checker report to the Chief of staff.
- Not yet removed: default grants such as "configure agents" that paperclip gives every agent. Paperclip blocks the dangerous settings anyway, but the grants should go.

## Measured

- Install: 2.9 GB under `engine/node_modules`.
- Memory: about 0.7 GB idle, about 1.2 GB at start-up.
- A Checker task takes about 30 seconds end to end.
- One dependency warns that it wants Node 24.15; this Mac has 24.13. Nothing failed.

## Not covered

- The Codex agent still uses the owner's own Codex login file, through a link. A login of its own (as the Claude agents have) is still to do; the proof prints a NOTE until then.
- Whether an agent holding its own token can switch its runner and so bypass the wrapper. Needs a test with a real agent key.
- Role instructions for each agent. The trial put the process in the task text.
- Fence rules come from `fence-run` reading environment variables set by the wrappers. The wrappers clear anything inherited first, but the real build should take rules from files only.
- A model host on the allow-list (such as `api.openai.com`) is also a way out for data, to someone else's account on that host. No allow-list can stop that.
