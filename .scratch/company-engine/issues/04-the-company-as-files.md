# 04: The company as files, applied with one command

**What to build:** The company's agents, their jobs, rights, limits and standing instructions are kept as files the owner can read and change. One command makes the running company match those files, and running it again changes nothing. There are nine agents: Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer and Drafter.

**Blocked by:** None (can start immediately)

**Status:** done

**Plan tasks:** T6, T7

- [x] One file lists every agent with its job, tool, model, limits, rights and who it reports to
- [x] Each agent has its own instructions in plain language
- [x] Every agent's instructions say: work only in the current working folder, never change workspace settings, work in the system of record only as drafts, report plainly, never send anything outside
- [x] The Chief of staff knows its team and each member's job, and hands out one step at a time
- [x] Only the Chief of staff may assign tasks; no agent may create agents or skills
- [ ] The extra rights paperclip gives every agent by default are removed (not possible: paperclip does not let the owner remove them; the gate refuses every change by default instead, see docs/adr/0001)
- [x] Each agent runs one task at a time with a time limit per run
- [x] There is one project with one folder, and every goal's work goes into it
- [x] New agents need the owner's approval
- [x] The command writes each agent's fence rules
- [x] A second run changes nothing; an agent that is not in the file is left alone, never deleted
