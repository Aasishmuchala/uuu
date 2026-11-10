# The fence

Every agent runs inside the fence. It can read and write its task folder and its own home, reach its model's hosts and the gate, and nothing else, unless its fence policy adds a little. The board's port is never reachable from inside.

## Commands

- `engine/fence/fence-run --self-check`: is the fence in place? The board is never started unless this says yes.
- `engine/fence/prove.sh` (or `engine prove`): the proof. PASS, FAIL, SKIP or NOTE per check, then RESULT. Exit 0 holds, 1 failed, 2 holds with something still to do. Writes `state/proof/last.json`.
- `engine/fence/login-wizard.sh`: the Claude agents' own login (only the owner can do it). `login-wizard.sh codex`: the Checker's own Codex login. `login-wizard.sh --status`: one line for each.

## What is here

- `bin/claude`, `bin/codex`: the wrappers. This folder goes first on the board's PATH.
- `fence-run`: runs one command inside the fence (Anthropic's sandbox-runtime). Interface in `.router/CONTRACTS.md` section 4.
- `fence_inputs.py`: gathers the planner's inputs: config, the agent's policy file, the wrappers' paths.
- `fence_plan.py`: the planner, a pure function (`plan`, `Refused`), and the script that writes `state/fences/<hash>.json`.
- `codex_home.py`: what the fence must allow around one Codex home.
- `steady-pipes.py`: gives Codex output pipes of its own.
- `prove.sh` and `proof_record.py`: the proof and its record.
- `tests/`: `/usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'`.

## Where the rules come from

- Never from environment variables. `fence-run`, both wrappers and the proof first unset every inherited `FENCE_*`, `UUU_*` and `ENGINE_CONFIG`.
- Ports, hosts and folders come from `engine/config.json`. The home folder is the one macOS has on record for the user, not `$HOME`.
- Per agent: `state/policy/<agent id>.json`, written by `engine setup`. `PAPERCLIP_AGENT_ID` is only the key to find it. The file must be a plain file of the owner's that nobody else can change, and its `agentId` must match, or the run is refused (exit 78). A policy may add local services (only ports on `fence.policyPortsAllowed`), folders to read (only under `fence.readRootsAllowed`), one lessons file to append to, one key file whose `UUU_*` lines are exported, and a read-only task folder.
- Paths the wrappers compute (paperclip's skills, instructions and tool config, the Codex login chain) are passed with `--read` and `--write`, and must lie inside paperclip's own company or skills folders or the Codex home. None may open the home folder, the state folder, `secrets/`, `policy/` or `fences/`.

## What the trial forced: Claude Code

- **The wrapper must be a file named `claude`, first on paperclip's PATH.** Paperclip tests the `claude` on its own PATH and refuses to activate an agent whose command is anything else. So every Claude agent is fenced by default.
- **The real Claude Code is called by its full path** (`fence.realClaude`), so the wrapper never calls itself.
- **Runner `legacy`, engine `cli`, command `claude`.** The default runner rejects a custom command.
- **Model aliases (`sonnet`, `opus`), not full model names.** Paperclip wants Claude Code 2.1.284 or newer for the newest names; this Mac has 2.1.268.
- **`--` before the command** when calling the sandbox tool, or it reads flags such as `--version` as its own.
- **A short TMPDIR for the sandbox tool** (`/tmp/uuu-fence-<uid>`). Paperclip's per-run temp path makes its socket path longer than macOS allows. The command gets its own temp folder back inside the fence (paperclip's `paperclip-run-*` folder, else `<agent home>/tmp`), and Claude Code is pointed at it with `CLAUDE_CODE_TMPDIR`.
- **`NO_PROXY` emptied inside the fence**, after the sandbox tool sets its own, so calls to `127.0.0.1` go through the fence's proxy, which allows only the listed local ports.
- **The agents need their own login.** `claude setup-token`, saved in `state/agent.env` outside the fence. The token wraps onto two lines and is easy to paste twice, so the wizard joins lines and drops repeats. The wrapper refuses (exit 78) when the file is missing, and refuses a file others can change, because it is sourced.

## What the trial forced: Codex

- **Certificates.** Inside the fence Codex cannot ask macOS for its trusted certificates and every HTTPS call fails ("error sending request"). Fixed by `SSL_CERT_FILE=/etc/ssl/cert.pem` (and `CODEX_CA_CERTIFICATE`).
- **Hosts.** `chatgpt.com`, `api.openai.com`, `auth.openai.com`, and the gate. Nothing else was needed.
- **Paperclip picks the Codex home, a new generated folder per agent,** under `<instance>/companies/<company>/codex-home/skill-runtimes/`. The wrapper accepts only homes under that tree or the engine's own, and fences that one folder.
- **The login file is a chain of links** ending at the shared login. The wrapper allows each link to be read (the links themselves, not resolved) and the last file to be written, so token refresh works.
- **Skills are links pointing outside the home**, into paperclip's skills tree. The wrapper allows reading what they point at, and refuses a skill that points anywhere else.
- **Paperclip's start-up check uses the server's own `CODEX_HOME`,** so the board is started with `CODEX_HOME=state/codex-home`, never the owner's `~/.codex`.
- **Engine `cli` is required.** The default engine launches a different program and would bypass the wrapper.
- **Pipes of its own.** The Node programs above Codex share its output pipe and can switch it to non-blocking mode at any moment; on a large write Codex then crashed with "Resource temporarily unavailable (os error 35)". Resetting the mode at start-up was not enough, so `steady-pipes.py` gives Codex its own pipes and copies the output across. Tested against a deliberately slow reader: 5,000,000 of 5,000,000 bytes arrive through the relay. The wrapper also starts the native Codex program directly.
- **Variables for Codex's shell tool.** Paperclip tells Codex to hand its shell tool only a fixed list of variables (`shell_environment_policy.include_only`). Without the fence's proxy settings on it, every call from the shell tool to the board was refused. The wrapper adds them, plus `UUU_*` (as a pattern and by name).
- **The quota check** (`codex ... app-server`) starts from the server's own folder; the wrapper moves it to `state/tasks/_quota`.
- **Bundled Codex is 0.156.1.** Fine for the default model; paperclip notes its extra tracing wants 0.160.0.

## Task folders

- Paperclip ties a folder to the task, not to the agent. A child task starts in its parent's folder, whichever agent runs it. So everyone on one goal shares one folder.
- Task text names no folder, only "your current working folder". An agent told to use a folder the fence refuses will try to move its task to another folder (the gate now refuses that move).
- The fence starts only strictly inside `state/tasks`, `<instance>/workspaces` or `<instance>/isolated-workspaces`, after resolving links, inside the home folder or out of it. `POST /board/chat/stream` makes the board start `claude` in its own folder; that run is refused, and must stay so.
- The trial's `<task folder>.reads` files are gone. The Checker gets a read-only task folder through its policy instead.

## Still open

- The Checker uses the owner's own Codex login through a link until the owner runs `login-wizard.sh codex`. The proof prints a NOTE until then.
- A model host on the allow-list (such as `api.openai.com`) is also a way out for data, to someone else's account on that host. No allow-list can stop that.
