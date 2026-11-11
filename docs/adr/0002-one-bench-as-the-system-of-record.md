# 0002: One bench as the system of record

## Context

The company needs books, customers, support and people records. Each could be a separate tool with its own database, sign-in and updates. On one Mac with 16 GB of memory and limited disk, that is too much to run and to keep safe.

## Decision

One Frappe bench holds all four: ERPNext with India Compliance (books), CRM (customers), Helpdesk (support) and HRMS (people). It runs on this Mac at `127.0.0.1:8120`, with a private database that is never a Homebrew service.

- Each department agent that works in it has its own login, which can prepare drafts and cannot make anything final, cancel or delete. Four logins were checked with 145 permission checks.
- The owner approves a draft from the home screen. Only then does it become final.
- `engine/books/` installs, starts, stops and checks it. `engine start` brings it up first.
- India Compliance's paid features stay off.

## Consequences

- One place to back up, one place to ask "what is true".
- A bench is heavy: five ports and several processes. The engine starts and stops it as one part.
- Agents can only be as careful as the bench's draft-only rights. Those rights run as server scripts inside the bench, so server scripts are switched on there.
- Changing to another tool later means moving data out of one bench, not several.

## Rejected

- A separate tool for each function. More to run, more sign-ins, no single record.
- Giving agents the owner's key to the bench. Draft-only logins exist so a mistake is never final.
