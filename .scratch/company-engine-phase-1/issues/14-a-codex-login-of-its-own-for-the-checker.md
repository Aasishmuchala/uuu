# A Codex login of its own for the Checker

Label: wayfinder:task
Type: task
Status: open
Blocked by: 12

## Question

The Checker uses the owner's own Codex login file through a link, and the fence lets it read and write that one file so the login can refresh. The Claude agents already have a login of their own. Give the Checker one too: the owner signs Codex in once with the engine's Codex home (`~/.paperclip/uuu-engine/codex-home`), the link goes away, and the fence no longer opens anything under the owner's `~/.codex`. Done when the proof's NOTE line about the shared login is gone. This is a step only the owner can do, so it wants a wizard.
