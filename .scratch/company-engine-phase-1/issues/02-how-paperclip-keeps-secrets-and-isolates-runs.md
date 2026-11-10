# How paperclip keeps secrets and isolates agent runs on macOS

Label: wayfinder:research
Type: research
Status: resolved

## Question

How does paperclip store secrets, and how does it isolate what an agent run can touch on macOS? Cover its built-in secret storage and how secrets reach a run, its workspaces, worktrees and sandbox providers, what an agent can reach on the host by default, its connection permissions (Allowed, Ask, Off) and approval gates, and whether Anthropic's sandbox-runtime could wrap its agent runs.

## Answer

Paperclip stores secrets well but does not confine a local agent run on a Mac.

- **Secrets at rest:** encrypted with AES-256-GCM under a master key file at `~/.paperclip/instances/default/secrets/master.key`.
- **Secrets in use:** the server decrypts them and passes them to the agent process as plain environment variables, so the agent can read them.
- **Agent runs on macOS:** unsandboxed host processes. Both adapters default to skipping permission prompts: Claude Code is started with `--dangerously-skip-permissions`, Codex with `--dangerously-bypass-approvals-and-sandbox`. Both defaults can be changed in the adapter settings.
- **Built-in confinement:** paperclip's file and network scopes run through `bwrap` and throw an error on anything but Linux.
- **Worktrees:** separate code and branches only.
- **Sandbox providers:** all bundled ones are hosted services or Kubernetes; none runs locally on macOS without Docker or a cloud account.
- **Allowed, Ask, Off and approval gates:** cover calls through paperclip's tool gateway and board decisions. Nothing read says they limit what the agent process does with its own shell, files or network.
- **Possible fix, untested:** both adapters take a configurable `command`, so a wrapper around Anthropic's sandbox-runtime (`srt`) is the likely route. Paperclip has no built-in support for it.
- **Not found in the sources:** how the default ACP engine confines the processes, what a run token can do, and whether a wrapper command survives paperclip's version and environment probes.

Findings with sources: branch `research/how-paperclip-keeps-secrets-and-isolates-runs`, file `docs/research/how-paperclip-keeps-secrets-and-isolates-runs.md`.
