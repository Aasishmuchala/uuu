# 24: The Codex agent's shell tool sees the program's whole environment

**What to build:** Paperclip gives Codex its shell settings (`shell_environment_policy.*`) in front of `exec`. Codex 0.156.1 drops every `-c` given before `exec` when `exec` has `-c` of its own, so those settings have no effect: the Checker's shell tool gets everything the Codex program has in its environment. Found in the provider-mode rehearsal on 12 November 2026. In provider mode that includes the Checker's own relay token (it works only at the relay on this Mac, for the Checker's own model, for six hours). Move the shell settings to where Codex reads them, in `engine/fence/bin/codex`, and leave the relay token out of what the shell tool gets.

**Blocked by:** none

**Status:** needs-triage

**Plan tasks:** none (found by task T10 of the version 4 plan; decision record `docs/adr/0010-an-outside-model-provider-behind-a-relay.md`)

- [ ] The wrapper puts the shell settings right after `exec`, where Codex reads them, in both modes
- [ ] The shell tool still gets what an agent needs to reach the gate, and the `UUU_*` names of its own key file
- [ ] In provider mode the shell tool does not get `ENGINE_RELAY_TOKEN`
- [ ] A rehearsal like T10's shows SET and UNSET for each name, without printing a value
- [ ] The proof still holds in both modes
