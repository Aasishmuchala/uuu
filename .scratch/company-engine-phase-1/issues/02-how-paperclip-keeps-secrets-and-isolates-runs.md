# How paperclip keeps secrets and isolates agent runs on macOS

Label: wayfinder:research
Type: research
Status: open

## Question

How does paperclip store secrets, and how does it isolate what an agent run can touch on macOS? Cover its built-in secret storage and how secrets reach a run, its workspaces, worktrees and sandbox providers, what an agent can reach on the host by default, its connection permissions (Allowed, Ask, Off) and approval gates, and whether Anthropic's sandbox-runtime could wrap its agent runs.
