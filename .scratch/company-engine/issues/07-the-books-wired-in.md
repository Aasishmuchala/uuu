# 07: The books, customers, support and people wired in

**What to build:** The Bookkeeper, Sales, Support and People agents each get their own limited login to the system of record. They can prepare drafts and records and cannot make anything final. Their drafts appear in the owner's inbox; when the owner approves, the home screen makes the draft final with the owner's own rights. The Books, Customers, Support and People pages show where things stand without opening the system behind them.

**Blocked by:** 04, 05

**Status:** ready-for-agent

**Plan tasks:** B1, T10, T11

- [ ] Each of the four agents has its own login, its own key and its own narrow role
- [ ] A check shows, for each agent: it can create a draft, it cannot submit, it cannot delete
- [ ] No agent can send an email or a message from the system of record
- [ ] An agent's key reaches only that agent, inside its fence, and is never printed or stored in the repo
- [ ] A draft made by an agent appears in the inbox with its type, party, amount and who made it
- [ ] Approve makes the draft final; Send back returns it to the agent with the owner's note
- [ ] Books shows what the owner is owed, what they owe, and this month's sales and spend
- [ ] Customers shows leads and deals by stage
- [ ] Support shows open requests with their age, and draft replies waiting
- [ ] People shows staff, leave and attendance
- [ ] A part that was not installed says so on its page
