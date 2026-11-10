# 02: The gate between agents and the board

**What to build:** Agents reach the board only through a gate. The gate lets a request through only when it carries an agent's token, so an agent can never act as the owner. It also refuses the few changes an agent could use to give itself more reach, such as changing its own settings, moving a task to another folder, or creating agents and projects. The owner keeps using the board and the home screen with no sign-in.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Plan tasks:** T4

- [ ] A request with no token is turned away and never reaches the board
- [ ] A request with a made-up token is turned away by the board itself
- [ ] A live connection with no token is closed
- [ ] Every change on the refusal list is refused, however the address is written
- [ ] An address the gate cannot read safely is refused
- [ ] Everything an agent needs for normal work passes unchanged: taking a task, commenting, changing status, creating a step
- [ ] Each refusal is written to a log with the time and what was asked, and never a token or the content
- [ ] The gate has its own health answer that does not touch the board
- [ ] When the board is off, the gate says so plainly
