# 02: The gate between agents and the board

**What to build:** Agents reach the board only through a gate. The gate lets a request through only when it carries an agent's token, so an agent can never act as the owner. It also refuses the few changes an agent could use to give itself more reach, such as changing its own settings, moving a task to another folder, or creating agents and projects. The owner keeps using the board and the home screen with no sign-in.

**Blocked by:** None (can start immediately)

**Status:** done

**Plan tasks:** T4

- [x] A request with no token is turned away and never reaches the board
- [x] A request with a made-up token is turned away by the board itself
- [x] A live connection with no token is closed
- [x] Every change on the refusal list is refused, however the address is written
- [x] An address the gate cannot read safely is refused
- [x] Everything an agent needs for normal work passes unchanged: taking a task, commenting, changing status, creating a step
- [x] Each refusal is written to a log with the time and what was asked, and never a token or the content
- [x] The gate has its own health answer that does not touch the board
- [x] When the board is off, the gate says so plainly
