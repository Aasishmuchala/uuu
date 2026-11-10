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
