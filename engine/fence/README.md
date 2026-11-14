# The fence

Every agent runs inside the fence. It can read and write its task folder and its own home, reach its model's hosts and the gate, and nothing else, unless its fence policy adds a little. The board's port is never reachable from inside.

## Commands

- `engine/fence/fence-run --self-check`: is the fence in place? The board is never started unless this says yes.
- `engine/fence/prove.sh` (or `engine prove`): the proof. PASS, FAIL, SKIP or NOTE per check, then RESULT. Exit 0 holds, 1 failed, 2 holds with something still to do. Writes `state/proof/last.json`.
- `engine/fence/login-wizard.sh`: the Claude agents' own login (only the owner can do it). `login-wizard.sh codex`: the Checker's own Codex login. `login-wizard.sh --status`: one line for each.

## What is here

- `bin/claude`, `bin/codex`: the wrappers. This folder goes first on the board's PATH.
- `bin/git`: the board's git (see "The board's git" below).
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
- The planner also checks where each kind may lie, as given and after resolving links, so a mistake in a wrapper cannot hand over more: the agent home only in the state folder or a paperclip company folder; the temp folder only in the agent home, the state folder, or paperclip's `paperclip-run-*` folder outside the home folder; extra writes only in the state folder, a company folder, or exactly `~/.codex/auth.json`.
- Extra reads inside the home folder only from the state folder, paperclip's `skills/` and `companies/`, `~/.codex/auth.json`, `engine/node_modules/@openai` and `engine/fence/steady-pipes.py` (the engine folder is the planner's own, never an input).

## What the trial forced: Claude Code

- **The wrapper must be a file named `claude`, first on paperclip's PATH.** Paperclip tests the `claude` on its own PATH and refuses to activate an agent whose command is anything else. So every Claude agent is fenced by default.
- **The real Claude Code is called by its full path** (`fence.realClaude`), so the wrapper never calls itself.
- **Runner `legacy`, engine `cli`, command `claude`.** The default runner rejects a custom command.
- **Model aliases (`sonnet`, `opus`), not full model names.** Paperclip wants Claude Code 2.1.284 or newer for the newest names; this Mac has 2.1.268.
- **`--` before the command** when calling the sandbox tool, or it reads flags such as `--version` as its own.
- **A short TMPDIR for the sandbox tool** (`/tmp/uuu-fence-<uid>`). Paperclip's per-run temp path makes its socket path longer than macOS allows. The command gets its own temp folder back inside the fence (paperclip's `paperclip-run-*` folder, else `<agent home>/tmp`), and Claude Code is pointed at it with `CLAUDE_CODE_TMPDIR`.
- **`NO_PROXY` emptied inside the fence**, after the sandbox tool sets its own, so calls to `127.0.0.1` go through the fence's proxy, which allows only the listed local ports.
- **Each agent has its own Claude Code home,** `state/claude-home/<agent id>` (`CLAUDE_CONFIG_DIR` and the fence's agent home), so a `settings.json`, `CLAUDE.md`, command, hook or MCP entry one agent writes there never loads in another agent's run, whose rights differ. Until 11 November 2026 they all shared `state/claude-home` (found by the final review). The wrapper picks the folder by `PAPERCLIP_AGENT_ID` (it must look like an id, or the run is refused), makes it 0700, and refuses one that is a link, not the owner's, or changeable by others (exit 78). A run without an agent id (the proof, the quota check) uses `claude-home/_none`; `fence-run` refuses the parent folder itself as an agent home. Old sessions are not carried over: paperclip retries a resume it cannot find with a fresh session. The old shared files in `state/claude-home/` (`projects`, `sessions`, `backups`, `file-history`, `shell-snapshots`, `session-env`) are no longer opened by any fence; the owner may delete them. The proof checks that one agent can neither read nor write another's home.
- **The agents need their own login.** `claude setup-token`, saved in `state/agent.env` outside the fence. The token wraps onto two lines and is easy to paste twice, so the wizard joins lines and drops repeats. The wrapper refuses (exit 78) when the file is missing, and refuses a file others can change, because it is sourced.

## What the trial forced: Codex

- **Certificates.** Inside the fence Codex cannot ask macOS for its trusted certificates and every HTTPS call fails ("error sending request"). Fixed by `SSL_CERT_FILE=/etc/ssl/cert.pem` (and `CODEX_CA_CERTIFICATE`).
- **Hosts.** `chatgpt.com`, `api.openai.com`, `auth.openai.com`, and the gate. Nothing else was needed.
- **Paperclip picks the Codex home, a new generated folder per agent,** under `<instance>/companies/<company>/codex-home/skill-runtimes/`. The wrapper accepts only homes under that tree or the engine's own, and fences that one folder.
- **The login file is a chain of links** ending at the shared login. The wrapper allows each link to be read (the links themselves, not resolved) and the last file to be written, so token refresh works.
- **Skills are links pointing outside the home**, into paperclip's skills tree. The wrapper allows reading what they point at, and refuses a skill that points anywhere else.
- **Nothing in the Codex home is trusted.** The agent can write in its home, and `codex_home.py` reads it outside the fence before the next run. A skill link planted to `<instance>/.env` or `<instance>/db` would have opened them to the agent the run after (found by the final review, 11 November 2026, and reproduced). Now a skill must lie strictly inside `<instance>/skills/<company>/`, and every link of the login chain and its last file must be a file named `auth.json` directly in the Codex home, a `<instance>/companies/<company>/codex-home/`, `state/codex-home/`, or be exactly `~/.codex/auth.json` (the home folder macOS has on record). Anything else refuses the run (exit 78). As a backstop the planner refuses any shared path inside paperclip's folder that is not strictly inside its `skills/` or `companies/`. The proof checks a planted link.
- **Paperclip's start-up check uses the server's own `CODEX_HOME`,** so the board is started with `CODEX_HOME=state/codex-home`, never the owner's `~/.codex`.
- **Engine `cli` is required.** The default engine launches a different program and would bypass the wrapper.
- **Pipes of its own.** The Node programs above Codex share its output pipe and can switch it to non-blocking mode at any moment; on a large write Codex then crashed with "Resource temporarily unavailable (os error 35)". Resetting the mode at start-up was not enough, so `steady-pipes.py` gives Codex its own pipes and copies the output across. Tested against a deliberately slow reader: 5,000,000 of 5,000,000 bytes arrive through the relay. The wrapper also starts the native Codex program directly.
- **Variables for Codex's shell tool.** Paperclip tells Codex to hand its shell tool only a fixed list of variables (`shell_environment_policy.include_only`). Without the fence's proxy settings on it, every call from the shell tool to the board was refused. The wrapper adds them, plus `UUU_*` (as a pattern and by name).
- **The quota check** (`codex ... app-server`) starts from the server's own folder; the wrapper moves it to `state/tasks/_quota`.
- **Bundled Codex is 0.156.1.** Fine for the default model; paperclip notes its extra tracing wants 0.160.0.

## Provider mode

When the owner switches Omega Plus on (see `docs/adr/0010-an-outside-model-provider-behind-a-relay.md`), an agent's allowed addresses are the gate and the model relay (`127.0.0.1:3110`, `localhost:3110`, `127.0.0.1:3120`, `localhost:3120`) and then the policy's local services, for both tools. No model host is listed at all. In plans mode the lists are exactly as above.

The key and the relay's secret are never given to the fence or to a program. The mode is read from `<state>/models/state.json` outside the fence, and that folder is on the planner's guarded list. A damaged file refuses the run (exit 78).

## Task folders

- Paperclip ties a folder to the task, not to the agent. A child task starts in its parent's folder, whichever agent runs it. So everyone on one goal shares one folder.
- Task text names no folder, only "your current working folder". An agent told to use a folder the fence refuses will try to move its task to another folder (the gate now refuses that move).
- The fence starts only strictly inside `state/tasks`, `<instance>/workspaces` or `<instance>/isolated-workspaces`, after resolving links, inside the home folder or out of it. `POST /board/chat/stream` makes the board start `claude` in its own folder; that run is refused, and must stay so.
- The trial's `<task folder>.reads` files are gone. The Checker gets a read-only task folder through its policy instead.

## The deny list

The fence refuses writes to eight names (`.claude`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`, `AGENTS.md`, `AGENTS.override.md`, `.codex`, `.agents`) at any depth, in any letter case, in the task folder, the agent's own home and the run's temp folder, so no agent can leave settings, skills or hooks for another agent's program to load (`docs/adr/0012-no-program-settings-in-a-task-folder.md`). All three folders are needed because a folder built in one and moved whole into another keeps what it holds. The Claude wrapper also passes `--disallowedTools WebSearch WebFetch` and the Codex wrapper `-c project_doc_max_bytes=0 -c web_search="disabled"`, as a second layer.

**The agent's own home** (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) is also where each program loads its user's settings and instructions from, in every run of that agent. Since 13 November 2026 (the second look at the review of step 2) the fence also refuses, at the top of the agent home and in the same spellings, every name the program loads from there and never writes there itself in a run (`HOME_CONFIG_NAMES` in `fence_plan.py`). Claude Code 2.1.268: `settings.json`, `settings.local.json`, `.config.json` (read instead of `.claude.json` when there), `remote-settings.json` (the cache of managed settings), `skills`, `agents`, `commands`, `output-styles`, `rules`, `workflows`, `routines`, `hooks`, `plugins`, `cowork_plugins`, `mcp-skill-archives`, `agent-memory`, `projects/*/memory` (auto memory), `scheduled_tasks.json`, `launch.json`, `loop.md`, `daemon.json`, `daemon`, `jobs`, `local`, `ide` (the list its own sandbox keeps its commands from writing, less what it writes itself). Codex 0.156.1: `config.toml` and paperclip's `config.toml.paperclip-backup` (put back as `config.toml` after a cut-short run), `config.json`, `managed_config.toml`, `requirements.toml`, `instructions.md`, `prompts`, `skills`, `plugins`, `hooks`, `hooks.json`, `rules`, `memories`, `agents`. What the programs write in a run stays open, as a real run showed: Claude's `.claude.json`, `projects/` (sessions), `sessions/`, `session-env/`, `shell-snapshots/`, `file-history/`, `backups/`, `policy-limits.json`; Codex's `sessions/`, its `.sqlite` files, `cache/`, `models_cache.json`, `installation_id`, `shell_snapshots/`. Deeper down such names write as ever (a git `hooks` folder in the temp folder). Two second layers in the Claude wrapper: `--strict-mcp-config` (only the MCP servers paperclip names start, never those the writable `.claude.json` could list) and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Two things change: Claude Code no longer rewrites its managed-settings cache (it fetches them anyway), and Codex can no longer install its own bundled skills (`skills/.system`) into a new home; it says so and runs on. The proof plants each kind in a home of its own and checks a real answer still keeps its session.

## A walled agent and the doors

An agent whose policy says `walled` (only the Researcher, `docs/adr/0013-one-walled-agent-may-read-the-web.md`) works in its goal's own folder `state/tasks/research/<goal>/` and nowhere else, keeps a Claude home of its own for each goal (`state/claude-home/<agent id>/<goal>`, made by `fence-run` as a plain 0700 folder, so a session or anything else one goal's run leaves in its home is never read by another goal's run; paperclip resumes a session per task, which lives in the home of that task's goal, so a run resumes its own goal's session; one it cannot find there, as after a task is moved under another goal, paperclip retries as a fresh session), runs only on the Claude program, may read no company folder, has no lessons file or key file, and reaches the board only through the narrow gate (port 3111), which shows it its own task and no other. It also reads `knowledge/shared/` (the files the owner shared) and the playbooks, read-only. A door's port is added to a run's lists only for an agent named in `config.json` and only while the owner's switch in `state/doors/state.json` is on, read outside the fence on every run. With every switch off, the lists are exactly as they were before the web door. The proof checks that the Researcher cannot read other agents' work, cannot reach the ordinary gate, and cannot reach the web door while it is switched off.

## The board's git

- **The attack.** The board runs `git status` and other git commands in the agents' task folders, outside the fence, as the owner (every 40 seconds or so). An agent can write a made-up repository there: `HEAD`, `objects/`, `refs/` and a `config` laid out directly in the folder, or, in a subfolder, a `.git` file pointing at one. Its settings can name a program (`core.fsmonitor`, a `filter` in `.gitattributes`) or point git at files outside the folder (`core.worktree`). Plain git runs that program as the owner. Found by the final security review, 11 November 2026, and reproduced.
- **What stops it.** `bin/git`, first on the board's PATH, refuses to run when git would work in a folder an agent can write to (anything under the state folder, `<instance>/workspaces`, `<instance>/isolated-workspaces`: the folder it starts in, every `-C`, `--git-dir`, `--work-tree`, `GIT_DIR` and the like, after resolving links). So no setting an agent writes is ever read. Everywhere else it runs the real git with `safe.bareRepository=explicit`, no file-watcher and no hooks, and never above the home folder. The folders come from `engine/config.json`; if that cannot be read, git is refused.
- **Second guard.** The board starts with `GIT_CONFIG_GLOBAL=state/git/config` (written by `parts/20-board.sh`: the same three settings), `GIT_CONFIG_NOSYSTEM=1`, `GIT_CEILING_DIRECTORIES` at the home folder, and no other git variable. A git called by its full path still refuses a repository laid out directly in a folder. It does not stop a `.git` file in a subfolder; only `bin/git` does.
- The board part refuses to start unless `bin/git` is the first `git` on the board's PATH. The proof checks both layouts.
- What this turns off: paperclip's features that keep a git repository in a task folder (git worktree workspaces, restore points) and that keep bare repositories of their own (skills from GitHub, repository caches). The engine uses none of them.

## Still open

- The Checker uses the owner's own Codex login through a link until the owner runs `login-wizard.sh codex`. The proof prints a NOTE until then.
- A model host on the allow-list (such as `api.openai.com`) is also a way out for data, to someone else's account on that host. No allow-list can stop that.
