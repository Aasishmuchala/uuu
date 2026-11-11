# 06: Switch over to the real engine, with a gate that refuses changes by default

**What to build:** The trial setup is replaced by the real engine. The board gives every agent rights the owner cannot take away, so the gate now refuses every change an agent asks for unless it is on a short list of what the work needs. The company's files no longer pretend to trim those rights. A real goal runs through the Chief of staff, the Builder and the Checker and comes back to the owner.

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-agent

**Plan tasks:** P1a, P1b, T16b (plan revision R1 in the first plan)

- [ ] An agent's request that changes anything is refused unless it is on the gate's short list
- [ ] Creating or changing agents, skills, tool connections, projects, settings and routines is refused for every agent
- [ ] The apply command no longer tries to change an agent's grants, and says plainly that the gate blocks them
- [ ] The stand-in board behaves like the real one about grants, so tests cannot pass by accident
- [ ] The proof shows each refusal with a real agent test key
- [ ] One command starts everything; a real goal finishes and reaches the owner
- [ ] The trial code is deleted
