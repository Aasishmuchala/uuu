# Spec: the company engine on one Mac

Status: ready-for-agent

Written 11 November 2026 from the phase 1 map, the two fence trials and the owner's request to finish every phase that fits this Mac. Vocabulary is from `GLOSSARY.md`.

## Problem Statement

The owner runs a company alone and wants agents to do the work of its departments while they stay in charge. Today the pieces exist only as a trial: paperclip runs three fenced agents, but starting it takes a hand-written script, a fenced agent can still act as the owner on the board, there are no books, customers, support desk or staff records for agents to work in, and the only screen is paperclip's own board, which shows tasks and runs rather than "what needs me". The owner has to know how it all works to use any of it.

## Solution

One engine, switched on with one command, and one home screen in the browser.

- The home screen opens on an inbox: everything that is waiting for the owner, each with a plain description and the one or two things they can do about it. A box at the top takes a goal in plain words and hands it to the Chief of staff.
- Each department has a page: Books, Customers, Support, People, Marketing, Studio, Knowledge, and the Company page for the agents themselves. A page shows where things stand and what is in flight; the owner never has to open the systems behind it.
- Behind the pages, agents do the work inside a fence. They prepare drafts in the system of record; the Checker reviews; the owner approves; only then is anything final.
- A health page says, in plain words, whether the engine is on, whether the fence holds, and what is not connected yet.
- Anything that would send something outside the company is visibly switched off until the owner connects an account.

## User Stories

1. As the owner, I want to switch the whole engine on with one command, so that I do not have to remember the order of its parts.
2. As the owner, I want to switch it all off with one command, so that agents run only when I choose.
3. As the owner, I want one status command that says in plain words what is on and what is not, so that I can tell at a glance whether something is wrong.
4. As the owner, I want a proof I can run any time that the fence holds, so that I trust agents with my Mac.
5. As the owner, I want a fenced agent to be unable to act as me on the board, so that an agent can never give itself more rights.
6. As the owner, I want every agent to be fenced without any per-agent setup, so that a new agent cannot be added unfenced by mistake.
7. As the owner, I want the engine to refuse to start an agent if the fence is not in place, so that a broken install fails closed.
8. As the owner, I want the company's agents, their rights and their instructions kept as files in the repo, so that I can see and change who does what.
9. As the owner, I want one command that makes the running company match those files, so that setup is repeatable.
10. As the owner, I want to open one address in my browser and see what needs me, so that I spend minutes a day, not hours.
11. As the owner, I want each inbox item to say who raised it, what it is and what I can do, so that I can decide without opening anything else.
12. As the owner, I want to approve or send back an item with one click and an optional note, so that review is quick.
13. As the owner, I want to type a goal in plain words and have the Chief of staff take it, so that I never fill in a task form.
14. As the owner, I want to see each goal's progress as a short list of steps and who has each, so that I know where it stands.
15. As the owner, I want to see the finished result of a goal and the Checker's verdict in one place, so that I can trust or question it.
16. As the owner, I want a Company page showing every agent, what it is doing now and whether it is healthy, so that I know my staff.
17. As the owner, I want to pause and resume an agent from the Company page, so that I can stop one without stopping all.
18. As the owner, I want the books kept in a real accounting system with Indian GST, so that the figures are usable for filing.
19. As the owner, I want a Bookkeeper agent that prepares invoices and bills as drafts, so that I only review.
20. As the owner, I want drafts from agents to appear in my inbox and become final only when I approve, so that nothing is posted to the books without me.
21. As the owner, I want a Books page with what I am owed, what I owe, and this month's sales and spend, so that I know the money without opening the accounting system.
22. As the owner, I want a Customers page showing leads and deals by stage, so that none is dropped.
23. As the owner, I want a Sales agent that records and qualifies leads I hand it, so that follow-up is not on me.
24. As the owner, I want a Support page showing open requests and their age, so that nothing waits unseen.
25. As the owner, I want a Support agent that drafts replies for my approval, so that nothing is sent without me.
26. As the owner, I want a People page with staff, leave and attendance, so that HR records live in one place.
27. As the owner, I want a People agent that prepares HR records as drafts, so that I only confirm.
28. As the owner, I want a Marketing page with a content calendar of drafts by agents, so that I can approve a week of content in one sitting.
29. As the owner, I want publishing to be visibly off until I connect accounts, so that nothing goes out by accident.
30. As the owner, I want a Knowledge page where I drop company documents and search them, so that answers come from our own papers.
31. As the owner, I want agents to read that knowledge and a list of lessons before they work, so that they stop repeating mistakes.
32. As the owner, I want a Studio page listing what agents have drafted, with files I can open, so that creative work is in one place.
33. As the owner, I want to ask for a simple part or drawing and get a CAD file with its measurements, so that small CAD jobs need no operator.
34. As the owner, I want a search box that finds tasks, documents and records across the engine, so that I do not need to know where a thing lives.
35. As the owner, I want every page to say plainly when its system is not installed or not connected, so that an empty page is never mistaken for "nothing to do".
36. As the owner, I want the home screen to work in light and dark and on a narrow window, so that it is comfortable all day.
37. As the owner, I want every error shown in plain words with what to do next, so that I am never left with a code.
38. As the Chief of staff, I want to know my team and each member's job, so that I hand each goal to the right agent.
39. As a department agent, I want my own limited login to the system of record, so that I can do my work and nothing more.
40. As a department agent, I want my instructions to say how drafts, checks and approvals work, so that I never try to finalise or send anything myself.
41. As the Checker, I want to read the work I am checking without being able to change it where that is possible, so that my verdict is independent.
42. As a later builder, I want every part covered by tests I can run with one command, so that I can change it safely.

## Implementation Decisions

- **Parts.** Paperclip (company plane), the fence, the gate, one Frappe bench (books, customers, support, people), the home screen, and the `engine` command that runs them.
- **The fence.** Anthropic's sandbox-runtime around wrappers named `claude` and `codex`, first on paperclip's PATH. Rules are computed per run from: the task folder (must lie in one of the known task-folder trees or the run is refused), the agent's own home, and a per-agent policy file. The owner's home folder is unreadable. Network is an allow-list. Everything in the trial README is a requirement.
- **Per-agent policy.** A file per agent id, written by the company-apply command: the extra local services that agent may reach and the folders it may read. The wrappers read policy from these files only and clear any fence-related variables they inherit.
- **The gate.** A local forwarder in front of the board that passes only requests carrying a bearer token and refuses upgrades without one. Paperclip validates the token. The fence allows the gate's port, never the board's. The proof asserts both: no direct board access from inside the fence, and a 401 through the gate without a token.
- **The engine command.** `start`, `stop`, `status`, `prove`, `setup`, `test`. Each part has a start step, a health check and a stop step; `start` stops and reports at the first part that fails its health check; `status` reports each part as on, off or unhealthy with one plain sentence. Logs and process ids live in the engine's state folder. Nothing is registered to start at login.
- **The company as files.** One company file lists agents (name, role, tool, model, rights, limits, who they report to, policy) and points at one instructions file per role. `setup` applies it idempotently: creates what is missing, corrects what differs, never deletes an agent it did not create without being asked.
- **Roles.** Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer, Drafter. Only the Chief of staff may assign tasks. No agent may create agents or skills. Each runs one task at a time with a run time limit.
- **The system of record.** One Frappe bench with ERPNext, India Compliance, CRM, Helpdesk and HRMS, on a private MariaDB with its own data folder and port. Installed stepwise with a free-disk floor of 8 GB; an app that would break the floor is skipped and reported.
- **Drafts and approval.** Each department agent has its own bench user whose role can create and edit but not submit. The home screen holds the owner's key and performs submits when the owner approves. Sending (email, messages) is not wired.
- **The home screen.** A Node 24 server using only built-in modules, on its own local port, serving a no-build browser interface (vendored Preact and htm). The server is the only thing that talks to paperclip and the bench; the browser talks only to the server. It binds to the local machine only and is not on the fence's allow-list.
- **Inbox model.** One list merged from: paperclip approvals, tasks waiting on the owner, finished goals not yet acknowledged, bench drafts made by agents, and content drafts. Each item has: source, title, who raised it, when, a plain summary, and its allowed actions.
- **Knowledge.** A folder of company documents indexed with the built-in SQLite full-text search; readable by agents through policy; a lessons file per role.
- **Marketing.** Content drafts are files in the engine's state with a status (draft, approved, sent back). No publishing code.
- **CAD.** A Drafter agent runs CadQuery in its task folder and returns a STEP file plus measured bounding box and volume.
- **Plain language.** Interface text avoids tool names where a plain word exists ("Books", not "ERPNext"). Technical names appear only on the health page.

## Testing Decisions

- A good test exercises behaviour through the public seam and never reaches into internals.
- **Seams:** (1) the `engine` command's subcommands and exit codes; (2) the gate's HTTP behaviour against a stub board; (3) the fence planner's inputs to rules, as a pure function; (4) the fence proof run against the real sandbox; (5) the home server's HTTP API against stub paperclip and bench servers; (6) the company-apply command against a stub board (idempotence: a second run changes nothing).
- The interface is checked in a real browser at desktop and narrow widths, light and dark, with the stubs and with the live engine.
- An end-to-end check gives a real goal to the live engine and follows it to the owner's inbox.
- Prior art: `engine/prototype-fence/prove-fence.sh` (the proof) and the relay test recorded in the trial README.

## Out of Scope

- Anything that sends outside the company: email, WhatsApp, social posts, e-invoice filing. Built only as off switches.
- Accounts and logins only the owner can create: a board login, the Codex agent's own login, Meta, social networks, the GST portal.
- Docker, a second machine, phone or remote access.
- The blueprint's separate services that do not fit this Mac: Chatwoot, Typebot, AnythingLLM, postiz, listmonk, Umami, ComfyUI, Langfuse, LiteLLM, authentik.
- Selling the engine to others.

## Further Notes

- The trial README (`engine/prototype-fence/README.md`) is the record of what the fence needs and why. Its code is the starting point and is deleted once replaced.
- Open tickets on the phase 1 map: 13 (closed here by the gate), 14 (the Codex agent's own login: an owner wizard), 15 (what an agent's own rights still allow: tests and grant removal here).
- The orchestrator's brief with constraints and scout findings is `.router/BRIEF.md`.
