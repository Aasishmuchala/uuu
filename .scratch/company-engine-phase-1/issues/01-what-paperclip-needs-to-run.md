# What paperclip needs to run on this Mac

Label: wayfinder:research
Type: research
Status: resolved

## Question

What does paperclip (github.com/paperclipai/paperclip) need to install and run on an M1 Pro Mac with 16 GB memory, about 21 GB free disk and no Docker? Cover the Node version, the database it uses and whether it needs Docker or any other service, the memory and disk it takes, the exact install and start steps, where it stores its data, and how Claude Code and Codex are connected as agents.

## Answer

Paperclip runs on this Mac once Node is upgraded; nothing else is missing.

- **Node:** needs 24.11.0 or newer. The Mac has 22.22.3. On Node 22 `npx` only warns, and the managed install refuses to run.
- **Database and services:** no Docker, Postgres or other service. With no `DATABASE_URL` it starts its own embedded PostgreSQL.
- **Mode:** `local_trusted`, the default: this Mac only, no login.
- **Start:** `npx paperclipai onboard --yes`, then `npx paperclipai run`. The interface is at `http://localhost:3100`.
- **Data:** everything lives under `~/.paperclip/instances/default/`.
- **Agents:** Claude Code and Codex connect through the `claude_local` and `codex_local` adapters, which run the installed CLIs with their existing sign-in.
- **Not found in the sources:** memory and disk needs, whether macOS 27 on Apple silicon is tested, and the minimum CLI versions. The trial run has to measure these.

Findings with sources: branch `research/what-paperclip-needs-to-run`, file `docs/research/what-paperclip-needs-to-run.md`.
