# 01: The fence in its real home, with rules per agent and a longer proof

**What to build:** Every agent runs inside the fence, and the fence's rules come only from files the engine writes. Each agent can have a few extra allowances of its own: a local service it may reach, folders it may read, its lessons file. The owner can run one proof at any time and see, line by line, that an agent cannot read their files, cannot reach the board directly, and cannot act as the owner.

**Blocked by:** None (can start immediately)

**Status:** done

**Plan tasks:** T1, T3

- [x] An agent started in any folder that is not a task folder is refused, with a plain message
- [x] An agent with no rules file is refused, with a plain message saying to run setup
- [x] Nothing an agent's environment says can widen its fence
- [x] An agent's extra allowances are limited to the short list the engine permits; anything else stops the run
- [x] The Checker can read the work it checks and cannot change it
- [x] The proof shows: no reading the owner's home, keys or settings; no open internet; no direct board access; no reaching the home screen
- [x] The proof shows a request through the gate with no token is turned away
- [x] The proof uses a real agent test key to show every change on the gate's refusal list is refused, then removes the key
- [x] The proof's result is saved so the home screen can show when it last ran
- [x] The owner's two sign-in steps exist as a wizard and are never faked
