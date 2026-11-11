# 09: Tasks and the acceptance view

**What to build:** Every task on a board with the columns Backlog, In progress, Pending review and Done, with Failed and Canceled always visible, and as a list. A task's own page is where the owner accepts work: the Checker's numbered checks with the evidence for each, a tab per round, a timeline of the steps, the documents in order, the conversation, the files, and one large Accept button.

**Blocked by:** 07

**Status:** ready-for-agent

**Plan tasks:** V3, V8, V13, V14, V24, V25

- [ ] The board shows each task as a card with its identifier, title, who has it, its size, and a schedule chip when it came from a routine
- [ ] A finished task waits under Pending review until the owner accepts it
- [ ] The task page shows how many verification rounds there were and one Accept button when the work is waiting
- [ ] Each check shows pass or fail, its reason and its evidence; an image is shown large
- [ ] Each round has its own tab, labelled Repairing, Passed or Failed
- [ ] The timeline shows each step with who did it and how long it took
- [ ] The brief, the plan, the summary and the check can be read in order
- [ ] Send back takes a note and reopens the task
- [ ] Files and comments that agents wrote are read safely: no link is followed and nothing is shown as a web page
