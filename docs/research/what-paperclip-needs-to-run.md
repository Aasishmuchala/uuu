# What paperclip needs to run on this Mac

Sources read on 2026-11-11 from `paperclipai/paperclip` at commit `24661683db5c1fe4220ae7ca3ddad6c3e08ab477` (default branch HEAD) and docs.paperclip.ing. Nothing was cloned, installed or run. Items marked **(inferred)** are my conclusions, not text in the sources.

## Short answer

- Paperclip needs **Node.js 24.11.0 or newer**. The Mac has Node 22.22.3, so Node must be upgraded first **(inferred from the Mac facts you gave)**. On Node 22 `npx` only warns, and the managed install refuses to run.
- No Docker, no Postgres and no other service is needed. With no `DATABASE_URL` set it starts its own embedded PostgreSQL.
- The fitting mode is `local_trusted`: the default, loopback only, no login.
- Start: `npx paperclipai onboard --yes`, then later `npx paperclipai run`. The UI and API are at `http://localhost:3100`.
- All data lives under `~/.paperclip/instances/default/`.
- Claude Code and Codex are the `claude_local` and `codex_local` adapters. They run the installed `claude` and `codex` CLIs and can use their existing sign-in.
- No source states memory or disk figures for the server.

## 1. Node version and other runtime requirements

- Node `>=24.11.0` is set in `engines` of the root `package.json`, `cli/package.json` and `server/package.json`. `.nvmrc` contains `24`.
- README "Quickstart": "With **Node.js 24.11 or newer** installed". It also gives "Requirements: Node.js 24.11+, pnpm 9.15+" for the from-source route. The root `package.json` pins `packageManager: pnpm@9.15.4`.
- Installation page, https://docs.paperclip.ing/reference/cli/installation/ (section Prerequisites): a managed install "refuses to run on an older Node"; an `npx` install or a directly started server on Node 22 or 23 "prints an unsupported-version warning and continues, but a warning is not support".
- pnpm is needed only for the clone-and-develop route (`pnpm install`, `pnpm dev`). The `npx` route needs no pnpm (`docs/start/quickstart.md`). The Mac's pnpm 11 is newer than the stated "9+"; the sources do not say whether that matters **(inferred risk, untested)**.
- Python 3 is needed only for signing in to Claude or Codex subscriptions from inside Paperclip's UI. README: "Local Claude and Codex subscription sign-in also needs Python 3 and the corresponding provider CLI on the Paperclip host." `doc/DOCKER.md` says Python 3 is "used to run local subscription sign-in in a pseudo-terminal". If the CLIs are already signed in on the Mac, whether Python is needed at all is not stated (see "Not found").
- The server and UI listen on port `3100` by default (`docs/deploy/environment-variables.md`, `PORT`).
- Licence: MIT (README badge).

## 2. Database and separate services

- Paperclip uses PostgreSQL through Drizzle ORM (`docs/deploy/database.md`).
- Default is embedded PostgreSQL: "Zero config. If you don't set `DATABASE_URL`, the server starts an embedded PostgreSQL instance automatically." On first start it creates `~/.paperclip/instances/default/db/`, ensures a `paperclip` database exists, runs migrations, and serves (`docs/deploy/database.md`).
- `server/package.json` depends on `embedded-postgres` `^18.1.0-beta.16`. The docs page title says "PGlite", but its text and the dependency both point to embedded PostgreSQL, not PGlite. **(inferred from the package, not stated)**
- Docker is optional: `docker compose up -d` only provides an alternative local PostgreSQL 17 on port 5432. A hosted Postgres (Supabase) is a third option. `docs/start/quickstart.md` and `docs/deploy/local-development.md` both say no Docker or external database is required.
- README FAQ: "Locally, a single Node.js process manages an embedded Postgres and local file storage."
- Local file storage is the default and needs no setup; S3-compatible storage is an option (`docs/deploy/storage.md`).
- The onboarding "Quickstart" path gives: embedded database, no LLM provider, local-disk storage, default (local encrypted) secrets (`docs/cli/setup-commands.md`).

## 3. Memory and disk

Not found in the sources. No document I read states a RAM or disk requirement for the server, the embedded database, or a managed install. The only figures near this are the on-disk layout in section 5 (paths, no sizes). The compose quickstart file was checked for memory limits and has none.

## 4. Install and start, and the deployment mode

Deployment mode: **`local_trusted`**. `docs/deploy/deployment-modes.md`: "The default mode. Optimized for single-operator local use." It binds to loopback only, needs no login, and creates a local board user automatically. `docs/deploy/overview.md`: "Just trying Paperclip? Use `local_trusted` (the default)". The other modes (`authenticated` with `private` or `public`) are for LAN/Tailscale and internet use.

Steps for a single-user Mac (README Quickstart; https://docs.paperclip.ing/reference/cli/installation/; `docs/start/quickstart.md`):

1. Get Node 24.11.0 or newer on `PATH`; check with `node --version`. **(inferred: this step is needed because the Mac has 22.22.3.)**
2. `npx paperclipai@latest onboard --yes` (README). It takes the Quickstart defaults, forces trusted-local loopback, and starts Paperclip. Without `--bind`, it ignores any reachability env vars (installation page). In an interactive terminal it opens the onboarding page in the browser once; `PAPERCLIP_NO_BROWSER=1` suppresses that (`docs/cli/setup-commands.md`).
3. Start again later: `npx paperclipai run`. It auto-onboards if config is missing, runs `doctor` with repair, and starts the server when checks pass (`docs/cli/setup-commands.md`). Use `npx paperclipai`, not `pnpm paperclipai`, unless inside a clone (`docs/start/quickstart.md`).
4. Check: `curl http://localhost:3100/api/health` returns `{"status":"ok"}` (`docs/deploy/local-development.md`).
5. In the web UI: create a company, set a goal, create a CEO agent and configure its adapter (`docs/start/quickstart.md`).

Optional, for a persistent install: `npx paperclipai install` puts a managed `paperclipai` command at `~/.local/bin/paperclipai` and its store under `~/.paperclip/cli`. It enables `update`, `--rollback` and running as a background service, needs Node 24+, and uses no `sudo` (installation page).

From-source alternative: `git clone https://github.com/paperclipai/paperclip.git`, `pnpm install`, `pnpm dev` (README).

## 5. Where data is stored

Default root `~/.paperclip`, instance `default` (`docs/deploy/local-development.md`, `docs/cli/setup-commands.md`):

| Data | Path |
|---|---|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Uploaded files and attachments | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |
| Logs (including run logs) | `~/.paperclip/instances/default/logs` |
| Managed CLI store (only if `install` is used) | `~/.paperclip/cli` |

Overrides: `PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID`, or `--data-dir` on any command. Reset the database with `rm -rf ~/.paperclip/instances/default/db` (`docs/deploy/database.md`).

Per-agent Codex state is kept under `<instance>/companies/<companyId>/agents/<agentId>/codex-home` (`docs/adapters/codex-local.md`).

## 6. Claude Code and Codex as agents

Both are local adapters that run the CLI already installed on the host. `docs/agents-runtime.md`: "`claude_local`: runs your local `claude` CLI", "`codex_local`: runs your local `codex` CLI", and "Paperclip assumes the CLI is already installed and authenticated on the host machine." Agents run in heartbeats: each wake starts the adapter, passes the prompt and context, and stores results (`docs/agents-runtime.md`). You choose the adapter when creating or editing an agent in the UI, and the UI has a "Test environment" button.

**Claude Code** (`docs/adapters/claude-local.md`):
- Needs the `claude` command available.
- Auth is any one of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or "a Claude Code subscription login available to the execution target". So the existing sign-in is usable for a local run.
- Fields: `cwd` (required, absolute path), `model` (default `claude-opus-5`), `promptTemplate`, `env`, `timeoutSec`, `graceSec`, `maxTurnsPerRun` (default 300), `dangerouslySkipPermissions` (default `true`; "required for headless runs where interactive approval is impossible").
- It resumes Claude Code sessions between heartbeats and injects Paperclip skills through a temporary `--add-dir` directory.
- The environment test runs a live `claude --print` probe with "Respond with hello."

**Codex** (`docs/adapters/codex-local.md`):
- Needs the `codex` command available.
- Auth is either a host login with `~/.codex/auth.json` or a per-agent `OPENAI_API_KEY` in adapter env.
- When Paperclip owns the effective `CODEX_HOME` (the default per-agent home), it symlinks `auth.json` from the host Codex home into it when no per-agent key is set. So the host's ChatGPT-subscription login is reused. If an agent has an `OPENAI_API_KEY`, Paperclip writes an API-key `auth.json` instead, which overwrites the symlink. If the managed home ends up with no credentials, the run fails with `adapter_failed`.
- Server isolation sets `OPENAI_API_KEY=""` for `codex_local` agents so they cannot spend the host API key.
- Skills are symlinked into `~/.codex/skills`; existing skills are not overwritten. The adapter keeps session continuity with `previous_response_id`.
- The environment test runs a live `codex exec --json -` probe.

Billing note from the Codex adapter page: API-key mode is metered per token; ChatGPT-subscription auth uses the subscription's plan and quota. Pick deliberately.

## Not found

- Memory (RAM) and disk-space requirements or sizes for the server, the embedded PostgreSQL, or a managed install. No source states them.
- Whether pnpm 11 works. Sources state "pnpm 9+" and pin 9.15.4; only matters for the clone route, not for `npx`.
- Whether Python 3 is needed when `claude` and `codex` are already signed in on the host. Sources link Python 3 only to the in-app subscription sign-in flow.
- Whether macOS 27 or Apple Silicon is tested or supported, and whether the embedded PostgreSQL binary is available for it. No platform list was found for the non-Docker install.
- The exact minimum Claude Code or Codex CLI versions the adapters support. The Codex page says only "versions that Paperclip supports" without naming them.
