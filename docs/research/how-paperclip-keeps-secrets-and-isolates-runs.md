# How paperclip keeps secrets and isolates agent runs on macOS

Sources read 2026-11-11 from the paperclip repository `paperclipai/paperclip` (default branch head, via `gh api`), the page docs.paperclip.ing/connectors, and `anthropics/sandbox-runtime`. Paths below are paperclip repo paths unless stated. "Inferred" marks anything not stated in a source.

## Short answer

- Secrets are encrypted at rest (AES-256-GCM) with a master key file on the host. They are decrypted server-side and injected as plain environment variables into the agent process, so the agent can read them (`docs/deploy/secrets.md`).
- Isolation on a Mac without Docker is weak by default. Local Claude Code and Codex runs are unsandboxed host processes in a working directory, and both adapters default to their "skip all permission prompts" modes (`docs/agents-runtime.md`, `packages/adapters/claude-local/src/server/permissions.ts`, `packages/adapters/codex-local/src/index.ts`).
- Git worktrees isolate code and branches, not credentials or the home folder. Every bundled sandbox provider is a hosted service or Kubernetes; none is a local macOS option. Paperclip's own local sandbox (filesystem and network scopes) is Linux-only (`bwrap`).
- Allowed / Ask first / Off and approval gates govern calls through paperclip's tool gateway and board decisions. They do not restrict what a Claude Code or Codex process does with its own shell and file tools.
- `local_trusted` means loopback-only and no login. Strict secret-reference enforcement is on by default only in `authenticated` mode.
- Anthropic's `srt` (macOS `sandbox-exec`) could plausibly wrap the Claude or Codex command. The adapters expose a configurable `command` (inferred workable via a wrapper script), but paperclip has no `srt` support and this is untested.

## 1. Built-in secret storage

- Default provider is `local_encrypted`. Values are encrypted with a master key at `~/.paperclip/instances/default/secrets/master.key`, auto-created at onboarding; the doc says the key "never leaves your machine" and `0600` permissions are enforced best-effort (`docs/deploy/secrets.md`).
- Cipher: `aes-256-gcm` with per-value IV and auth tag, stored as scheme `local_encrypted_v1`; key is 32 random bytes, written `0600`; may be overridden by `PAPERCLIP_SECRETS_MASTER_KEY` or `PAPERCLIP_SECRETS_MASTER_KEY_FILE` (`server/src/secrets/local-encrypted-provider.ts`).
- Encrypted material lives in the paperclip database (`company_secrets`, `company_secret_versions`); a database backup without the key file cannot be decrypted (`docs/deploy/secrets.md`).
- Other providers: AWS Secrets Manager works; GCP Secret Manager and HashiCorp Vault are "coming soon" (draft config only) (`docs/deploy/secrets.md`).
- Delivery to a run: a secret is used only when bound into an agent, project, environment or plugin field as `{"type":"secret_ref", secretId, version}`. At run time the server resolves it and injects the value as an environment variable into the agent process (or SSH env, or sandbox driver). Project env wins over agent env on key clashes (`docs/deploy/secrets.md`).
- Audit: each resolution records a non-sensitive access event (secret id, version, provider, consumer, outcome), no value (`docs/deploy/secrets.md`).
- Limits, stated by the docs: once injected, "Treat any secret you bind to an agent as exposed to that agent"; it can log it or pass it on (`docs/deploy/secrets.md`). Agent-authenticated callers cannot set arbitrary env, host command or working directory on local adapters (`doc/agent-permission-defaults.md`).
- Strict mode (`PAPERCLIP_SECRETS_STRICT_MODE=true`) forces `*_API_KEY`, `*_TOKEN`, `*_SECRET` env keys to be secret refs; authenticated deployments default it on (`docs/deploy/secrets.md`).
- Separate: the server itself reads a company secret named `GITHUB_TOKEN`/`GH_TOKEN`/`PAPERCLIP_GITHUB_TOKEN` for server-side git clone and fetch; agents pushing still need their own binding (`docs/guides/board-operator/execution-workspaces-and-runtime-services.md`).
- Agent auth to paperclip itself: agent API keys and short-lived run JWTs (`README.md`, Identity & Access).
- Claude/Codex model credentials are separate from company secrets: `claude_local` uses `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or the host subscription login; `codex_local` symlinks the host `~/.codex/auth.json` into a per-agent managed `CODEX_HOME` (`docs/adapters/claude-local.md`, `docs/adapters/codex-local.md`).

## 2. Workspaces, worktrees, sandbox providers

- Project workspace: a checkout (or repo URL) a project runs in. Execution workspace: an optional isolated copy with its own checkout path, branch and runtime services; issues can create or reuse one (`docs/guides/board-operator/execution-workspaces-and-runtime-services.md`). `git_worktree` is the strategy that creates a git worktree for a run (same doc).
- What this isolates: code and runtime state. The docs describe it as isolating "code and runtime state", not credentials, network or home access. That worktrees are not a security boundary is inferred.
- Execution targets: local host, SSH, or a sandbox provider (`docs/agents-runtime.md` mentions local/SSH/sandbox targets; `packages/adapter-utils/src/execution-target.ts`).
- Sandbox providers shipped in `packages/plugins/sandbox-providers/`: boxd (KVM microVMs), cloudflare, createos, daytona, e2b, exe-dev, kubernetes (alpha; needs a k8s 1.27+ cluster), modal, novita, plus a fake test provider. README lists e2b, Cloudflare, Daytona, Modal, Novita, boxd and self-hosted Kubernetes (`README.md`, FAQ).
- macOS without Docker: none of those is a local sandbox. All are remote services or need a cluster; the read provider READMEs name no local or Docker-on-Mac provider. Not found: any bundled local-VM provider.
- Sandbox contract: a sandbox is treated as untrusted; paperclip only protects host file writes (via sync) and the paperclip API (via an HTTP bridge). It "does not enforce" provider isolation rules and does not control general internet access (`packages/plugins/sandbox-providers/SANDBOX-REQUIREMENTS.md`).
- Built-in local confinement: `claude_local` and `codex_local` accept `filesystemScope: "workspace"`, `networkScope: "deny"|"allowlist"` and `filesystemExtraPaths`, run through `bwrap`. The code throws "currently supported only on Linux" on other platforms (`packages/adapter-utils/src/local-process-sandbox.ts`, line ~347; used from `packages/adapters/claude-local/src/server/execute.ts`). So it does not work on macOS.

## 3. What a local Claude Code or Codex run can reach by default

- "Local CLI adapters run unsandboxed on the host machine" (`docs/agents-runtime.md`, section 9).
- Environment: the Claude adapter spawns with `{ ...process.env, ...env }`, i.e. the paperclip server's own environment plus injected values (`packages/adapters/claude-local/src/server/execute.ts`, ~line 504). Inferred consequence: any secret in the server's shell environment reaches the agent.
- Permissions: `dangerouslySkipPermissions` defaults to `true` and adds `--dangerously-skip-permissions` (`docs/adapters/claude-local.md`; `packages/adapters/claude-local/src/server/permissions.ts`). Codex defaults to `--dangerously-bypass-approvals-and-sandbox` unless extra args or settings choose a sandbox or restrict network (`packages/adapters/codex-local/src/index.ts`, `DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX = true`; `codex-args.ts`). Codex docs call the flag "dev only" (`docs/adapters/codex-local.md`).
- Files: `cwd` is the working directory, not a jail; with the options above off, the process runs as the owner's user, so the home folder (including `~/.ssh`) is reachable (inferred from "unsandboxed" plus the flags above).
- Network: no restriction by default (inferred; restrictions exist only via the Linux-only `networkScope` and Codex's `network_access` setting).
- Credentials: Claude config dir and Codex home are used or seeded from the host; agents get per-agent Codex homes and `OPENAI_API_KEY=""` so one agent does not use the host key (`docs/adapters/codex-local.md`). Host `~/.claude` is shared by default via `resolveSharedClaudeConfigDir` (execute.ts).
- Skills are injected through `--add-dir` for Claude and symlinked into `~/.codex/skills` for Codex, which writes outside the workspace (`docs/adapters/*.md`).
- Default engine: both adapter schemas default `engine` to ACP ("Default (ACP)"), CLI only when chosen (`config-schema.ts` in both adapters). The docs pages still describe the CLI path; how ACP differs for isolation was not read.
- Default agent powers inside paperclip: standard agents can change their own unprotected configuration and read same-company data; board-only items are host command, args, cwd and arbitrary env (`doc/agent-permission-defaults.md`).

## 4. Connection permissions and approval gates

- Each action of a connected service (GitHub, Notion, a custom MCP server and so on) can be set to Allowed, Ask first or Off on the connector's Permissions tab. Ask-first actions wait for the owner's approve or decline; Off blocks the action; "connecting is not a permission" (docs.paperclip.ing/connectors; the page does not define Allowed precisely, it implies no prompt). README: "connection action approvals govern calls through the tool gateway".
- Approvals: board approvals for hiring and CEO strategy; execution policies add review or approval stages for task completion; budgets hard-stop; agents can be paused or terminated (`docs/guides/board-operator/approvals.md`, `README.md` Governance). Tool approvals bind action, task, company, destination and arguments and execute once (`doc/plans/2026-11-09-durable-tool-approvals.md`).
- Not covered: nothing in these sources says Ask/Off or approvals gate a Claude Code or Codex process's shell, file writes or network calls. They apply to calls routed through paperclip (gateway, API), so a process with `--dangerously-skip-permissions` is outside them (inference from the layering above). Secret values bound to an agent are also outside any prompt once injected.
- With one human owner, every approval goes to that owner; "agents cannot approve their own governed action requests" (`doc/agent-permission-defaults.md`).

## 5. Deployment modes

- `local_trusted` (default): loopback-only bind, no login, an auto-created local board admin, optimized for single-operator local use (`docs/deploy/deployment-modes.md`, `doc/DEPLOYMENT-MODES.md`).
- `authenticated`: login via Better Auth, `private` (LAN/Tailscale) or `public` (needs explicit public URL, stricter doctor checks, rate limiting on, local stdio MCP slots fail closed) (`doc/DEPLOYMENT-MODES.md`).
- What `local_trusted` turns off: human login, and by implication default strict secret-ref enforcement (strict defaults on only for authenticated; `docs/deploy/secrets.md` says strict mode is "recommended for any deployment beyond local trusted"). It does not change agent sandboxing; the same adapters run in both modes (inferred; no doc ties agent confinement to mode).

## 6. Could Anthropic sandbox-runtime wrap paperclip's agent runs?

What `srt` is (README, `anthropics/sandbox-runtime`): a process wrapper, "without requiring a container"; on macOS uses `sandbox-exec` with generated Seatbelt profiles, on Linux `bubblewrap`. Install `npm install -g @anthropic-ai/sandbox-runtime`. Invoke as `srt <command>` (e.g. `srt "curl anthropic.com"`), with `--settings <file>` or default `~/.srt-settings.json`; a library API exists too. Defaults with no settings file: no network, no writes outside default paths, reads unrestricted. Config: `filesystem.denyRead/allowRead/allowWrite/denyWrite`, `network.allowedDomains/deniedDomains`. It is labelled a "Beta Research Preview" and lists limits: domain-fronting and broad allowed domains permit exfiltration; broad write paths permit escalation; install it outside writable paths; `allowAppleEvents` removes code-execution isolation; Docker/unix-socket allows can bypass.

What paperclip's adapter design allows (read from source, wrapping not verified):
- Both adapters read `config.command` (defaults `claude`, `codex`) and pass it with args to `runAdapterExecutionTargetProcess` (`execute.ts` lines ~182 and ~605/975). Inferred: pointing `command` at a wrapper script that runs `srt --settings ... claude "$@"` would sandbox a CLI-engine run, with the prompt still on stdin. Not tested.
- The ACP engine (the default) has an `agentCommand` override for the ACP server (`config-schema.ts`); the same wrapper idea is inferred, unverified.
- Setting `command` is host-command configuration, which only the board (the owner) can change, not agents (`doc/agent-permission-defaults.md`).
- Paperclip has no `srt` integration. Its own `filesystemSandboxCommand` option feeds `bwrap`-style arguments and is not an `srt` hook (`local-process-sandbox.ts`).
- Things to prove on the box: paperclip's server URL on localhost must be reachable (network allowlist), the Claude/Codex config dirs and worktree must be writable, the version probe and "Test environment" hello probe must still pass, and nested sandboxes (Codex's own sandbox inside Seatbelt) may conflict. None of these was checked.

## Not found

- Any bundled sandbox provider that runs locally on macOS without Docker or a cloud account.
- Official docs definition of Allowed vs Ask first vs Off beyond the connectors page summary; the "action permissions guide" it links was not read.
- How the default ACP engine confines (or not) the Claude and Codex processes, versus the CLI engine described in the adapter docs.
- Whether the run token (`PAPERCLIP_API_KEY`) lifetime and scope limit damage if an agent leaks it (only the README's "short-lived run JWTs" line was read).
- Evidence that `srt` has been run with paperclip, or that a wrapper `command` works with the ACP or version-probe paths.
- What a worktree prevents beyond branch separation (no document claims it as a security control).
