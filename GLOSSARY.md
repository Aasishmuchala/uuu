# Company engine

One app that runs a company end to end, with people and AI agents working together.

## Language

**Engine**:
The whole system: the company plane, the departments, the systems of record and the foundation under them.
_Avoid_: Platform, app, OS

**Person**:
A human in the company.
_Avoid_: User, staff, employee

**Agent**:
An AI worker with a role and a boss on the org chart.
_Avoid_: Bot, coworker, teammate, assistant

**Department**:
A group of agents with the skills for one business function and one dashboard.
_Avoid_: Team, division, space

**System of record**:
The one place where a kind of data officially lives, such as the books or the CRM.
_Avoid_: Backend, source of truth, database

**Fence**:
The limits on what an agent can reach: files, network and secrets.
_Avoid_: Jail, guardrail, sandbox (that names the tool that builds a fence)

**Board**:
The place where tasks and agents are kept and handed out (paperclip). Agents reach it only through the gate.
_Avoid_: Dashboard, tracker, control panel

**Gate**:
The small server between the agents and the board. It turns away every request an agent has no need to make.
_Avoid_: Firewall, proxy, API gateway

**Home screen**:
The owner's one front door to the engine, in a browser on this Mac.
_Avoid_: Dashboard, portal, admin panel, UI

**Needs you**:
Everything waiting for the owner: work to accept, drafts to approve, questions, plans.
_Avoid_: Inbox, notifications, queue

**Task**:
What the owner asks for. The code calls it a goal.
_Avoid_: Ticket, request, issue

**Draft**:
Work an agent has prepared that is not final until the owner approves it.
_Avoid_: Proposal, suggestion, pending item

**Fence policy**:
The short file of extra allowances one agent's fence has, such as one folder it may read.
_Avoid_: Permissions, ACL, profile

**Proof**:
The check that the fence holds, with a result for every line, run by `engine prove`.
_Avoid_: Audit, scan, pen test

**Files**:
The page where the company brain's files are kept and filled in.
_Avoid_: Docs, wiki, knowledge base

**Lesson**:
A note an agent keeps about how to do its job better next time. The owner can change it.
_Avoid_: Memory, rule, learning

**Brief**:
The first document of a larger task: the goal in the owner's words, what done looks like, and anything unclear.
_Avoid_: Spec, requirements, ticket

**Plan**:
The second document of a larger task: the approach and the steps, with who does each.
_Avoid_: Roadmap, design, proposal

**Check**:
The Checker's six yes or no questions about a piece of work, ending in a verdict of pass or fail.
_Avoid_: Review, test, QA report

**Round**:
One check of a task. After five failed rounds the task stops and asks the owner.
_Avoid_: Iteration, attempt, cycle

**Accept**:
The owner's yes to finished work, a plan or a draft.
_Avoid_: Approve (for finished work), sign off, merge

**Send back**:
The owner's no, with a note, so the work is done again.
_Avoid_: Reject, deny, decline

**Routine**:
Standing work that runs on a schedule, kept as one small file. It starts switched off.
_Avoid_: Cron job, automation, workflow, schedule

**Job**:
A named piece of work an agent can start for the owner, kept as one small file. Starting a job makes a task.
_Avoid_: Ready-made goal, template, preset, blueprint

**Map**:
The home page: the company brain in the middle, the departments around it.
_Avoid_: Home, overview

**Company brain**:
The company's own files that every agent reads before it works.
_Avoid_: Knowledge base, wiki, memory

**Hand-off**:
What is left for the owner when a job runs: you lead, you approve, or on its own.
_Avoid_: Autonomy level, mode

**Stage**:
One step of the build order: Foundations, Take in, Make, Hand on.
_Avoid_: Phase, level, tier

**Dashboard**:
The figures and records of one department.
_Avoid_: Report, analytics, control panel

**Daily brief**:
A short note each morning of what happened that needs no decision.
_Avoid_: Digest, report, summary email

**Sprite**:
A small picture or animation made of frames, with its data file and a GIF.
_Avoid_: Icon, asset, animation file

## Roles

**Owner**:
The person the company belongs to; the top of the org chart.
_Avoid_: Admin, boss, user

**Chief of staff**:
The agent that turns the owner's goals into tasks and assigns them.
_Avoid_: CEO, manager, orchestrator

**Builder**:
The agent that does the work on a task.
_Avoid_: Engineer, worker, implementer

**Checker**:
The agent that tests and reviews a builder's work before it reaches the owner.
_Avoid_: Reviewer, QA, verifier

**Bookkeeper**:
The agent that prepares entries and invoices in the books as drafts.
_Avoid_: Accountant, finance bot

**Sales**:
The agent that records leads and deals and qualifies them, as drafts.
_Avoid_: Salesperson, rep, CRM bot

**Support**:
The agent that drafts replies to customers. Nothing is sent.
_Avoid_: Helpdesk bot, agent (for the role)

**People**:
The agent that prepares staff records, leave and attendance, as drafts.
_Avoid_: HR, personnel, recruiter

**Marketer**:
The agent that drafts posts and newsletters. Nothing is published.
_Avoid_: Social media manager, copywriter

**Drafter**:
The agent that designs parts and gives back a STEP file with measured size.
_Avoid_: Engineer, CAD operator, designer

**Artist**:
The agent that makes sprites, animated GIFs, sprite sheets and simple vector images by script.
_Avoid_: Designer, illustrator, animator
