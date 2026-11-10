# Secrets and sandboxing in phase 1

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 02

## Question

How are secrets kept and agent commands sandboxed in phase 1: with what paperclip has built in, or with something added?

## Answer

Decided with the owner on 11 November 2026.

- Each agent runs under its own tool's sandbox, with paperclip's skip-permissions defaults turned off.
- Anthropic's sandbox-runtime is added as a wrapper if that proves too weak.
- Agents get no secrets at all.
- Paperclip starts without `OPENAI_API_KEY`.
- Proof before any real work: an agent must fail to read the owner's SSH keys.

This setup was untested with paperclip when decided; the trial run may force a change.

## Changed by the trial runs

The owner agreed the change on 11 November 2026, after the first trial.

- The first line did not survive. Codex's own sandbox lets it read every file, and Claude Code's covers only its shell commands. The outer fence (Anthropic's sandbox-runtime) is the real boundary for every agent, and inside it the tools run with their own prompts off.
- "No secrets" means no secrets of the owner's. Each agent has the one login it needs to reach its model.
- The proof grew from one failed read of the SSH keys to fifteen checks per tool. See the tickets "Trial run: paperclip with two agents on this Mac" and "The same fence around Codex".
