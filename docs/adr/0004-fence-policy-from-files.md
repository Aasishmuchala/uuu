# 0004: Fence policy from files

## Context

The fence limits what an agent can reach. If its rules could come from the agent's environment, an agent could widen its own fence. Different agents also need different small allowances: the Bookkeeper reaches the books, the Drafter its tools, the Checker the work it checks.

## Decision

Fence rules come only from files the engine writes, never from environment variables.

- Before it does anything, the fence tool and both wrappers (`claude`, `codex`) unset every inherited `FENCE_*`, `UUU_*` and `ENGINE_CONFIG`.
- Ports, hosts and folders come from `engine/config.json`.
- Each agent has `state/policy/<agent id>.json`, written by `engine setup`. The agent id from the environment is only the key to find the file. The file must belong to the owner, be a plain file nobody else can change, and name the same agent. Otherwise the run is refused.
- A policy can add only: local ports on a short list (the books), folders to read from a short list (`knowledge/docs`, `lessons`, `cad`, `art`), one lessons file to append to, one key file whose `UUU_*` lines are passed in, and one read-only task folder.
- The lessons file is the one place an agent may write that is not its own task folder.
- The Checker gets the work it checks as a read-only folder. It can read the work and cannot change it.
- `art` is a read root so the Artist can use its own Python and Pillow under `state/art`.
- An agent started in any other folder, or with no policy, is refused with a plain message.

## Consequences

- Widening any fence is a visible change to a file, followed by `engine setup` and `engine prove`.
- A new kind of allowance needs a change to the engine's short lists.
- The fence needs Anthropic's sandbox tool, and its quirks are written in `engine/fence/README.md`.

## Rejected

- Reading rules from the environment. An agent could set them.
- One shared policy for all agents. Every agent would hold the widest allowance.
