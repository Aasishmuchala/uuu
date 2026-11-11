# 03: One command to run the engine

**What to build:** The owner switches the whole engine on with one command and off with another. A status command says in plain words what is on, what is off and what is unhealthy. A prove command runs the fence proof, a setup command makes the company match its files, and a test command runs every test. The board is never started unless the fence is in place.

**Blocked by:** 01, 02

**Status:** done

**Plan tasks:** T5

- [x] Start brings up the books, the board, the gate and the home screen in that order, checking each before the next
- [x] Start stops at the first part that fails, names it, and says where to look
- [x] Start refuses to bring up the board when the fence is not in place
- [x] Running start twice never starts a second copy of anything
- [x] Stop brings everything down in reverse order and leaves no agent running
- [x] Status prints one line per part: on, off, unhealthy or not installed, with one plain sentence
- [x] A part that is not installed is skipped and said so, not treated as a failure
- [x] Nothing is set to start by itself when the Mac starts
- [x] Logs and process records live in the engine's own folder, outside the repo
