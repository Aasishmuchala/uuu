# 0012: No program settings in a task folder

## Context

Paperclip ties a working folder to the task, not to the agent. Every agent on a goal shares one task folder, and both programs start in it. The Claude program and the Codex program load instructions, skills, hooks and servers from the folder they work in.

A prototype on 12 November 2026 (`.router/prototypes/v5/p1/`) showed that this is a way for one agent to steer another, including the Checker. Without a rule, the Claude program loaded from a shared working folder: `CLAUDE.md`, `CLAUDE.local.md`, rules, skills, commands and agents under `.claude`, a `CLAUDE.md` or `.claude/skills` in a subfolder once a file there was read, every hook in `.claude/settings.json` (all four ran), and the server named in `.mcp.json` (it started). Codex loaded `AGENTS.md` and `AGENTS.override.md`, `.codex/config.toml` (its developer instructions reached the model), `.codex/skills/` and `.agents/skills/`.

So an agent that can write its task folder could leave a file there that the next agent's program obeyed, with that agent's rights and fence. This is the same family as `0007`, but between agents instead of towards the owner's side. It mattered little while agents never read the outside world. It matters once they do.

## Decision

The fence itself makes these names impossible to create, so nothing is left for another program to load.

- **A deny list in the fence.** For each of eight names (`.claude`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`, `AGENTS.md`, `AGENTS.override.md`, `.codex`, `.agents`) the planner adds four write-deny entries: the name at the top, inside it, at any depth, and inside it at any depth. Each letter is written as a two-letter set, because this disk ignores letter case. No agent can create, rename into place, link or make a folder with such a name, in any case.
- **Three folders, not one.** The entries apply to the task folder, the agent's own home and the run's temp folder. The prototype showed why: an agent can build a folder holding `CLAUDE.md` or a skill in its home or temp folder and move the whole folder into the task folder. The sandbox checks only the moved folder's own name, so the files arrived intact. With all three folders covered, 200 of 200 tries were refused (8 names, 3 letter cases, at the top and two folders down, create, mkdir, move onto, link and symbolic link), and a swapped-in folder arrives empty. Ordinary files still write. Both programs still run normally.
- **Program flags as a second layer, not the fix.** The Claude wrapper always passes `--disallowedTools WebSearch WebFetch`, so no agent searches through the program (the web belongs to a door of its own). The Codex wrapper passes `-c project_doc_max_bytes=0` and `-c web_search="disabled"`, right after `exec`. `--setting-sources user` is not used, because it stops paperclip's own skills from loading.
- **The proof checks it.** `engine prove` plants each of these names in the task folder in several ways (a folder, a file, a file in a subfolder, a moved file, a link) and fails if any succeeds, and checks that an ordinary file still writes beside them. A read-only check also looks through the task folders for any such name in any letter case.
- With every switch off, a run differs from before only by this list, the flags, and the read-only playbooks folder (`0011`).

## Consequences

- No agent can write these names, even for a good reason. An agent that wants to leave instructions for another uses the task text and comments, as before.
- Existing task folders that already hold one of these names are not swept. The proof's read-only check reports them.
- The sandbox tool's own built-in list is relative to its working folder, so `fence-run` keeps starting it in the task folder.
- The names were chosen by what the two programs actually load. Other names (`.lsp.json`, `.claude-plugin`, `GEMINI.md`) were planted in the prototype and loaded by neither. If a program update loads a new name, the list gets one more entry and the proof one more case.
- Nothing of this is live until the new wrappers and the planner are in place and the home screen is restarted.

## Rejected

- **Sweeping the task folder before each run.** It leaves the whole run for another agent to plant in, and it makes unfenced code move and delete agents' files, which is a risk of its own (`0007`).
- **Refusing to start a run when a name is present.** It lets one agent stop another's work, and gives the owner a stopped task for something the fence can prevent outright.
- **Program flags alone.** One setting stops `CLAUDE.md` and rules but not skills, hooks or `.mcp.json`. Another stopped paperclip's own skills. Neither covers Codex's `.codex` and `.agents`.
- **A deny list for the task folder only.** The prototype showed the move-whole-folder route around it.
