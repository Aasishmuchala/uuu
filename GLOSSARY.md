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
