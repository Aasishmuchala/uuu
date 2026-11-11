# Wiring the books for the agents: what the bench actually needed

Written by T10 on 11 November 2026 against the live bench (frappe 16.56,
erpnext 16.54, india_compliance, hrms, crm, telephony, helpdesk; site
`engine.localhost`). `wire.sh` does all of this; `wire.sh --verify` proves it
with each agent's own key (145 checks, all PASS on this date). M37 (version 3)
added the Bookkeeper's draft quotations and 28 checks for them: 173 checks
from then on, first run live by M56 (see note 14).

## What each role may do, as set

Rights are custom permission rows at level 0 (`Custom DocPerm`), one per role
and doctype. Every right not listed is 0: no role has delete, submit, cancel,
amend, share, print, email, report, export or import anywhere. Any other
permission row naming the role is removed on each run.

| Role (user) | Read, write, create | Read, write | Read only |
|---|---|---|---|
| Engine Bookkeeper (`bookkeeper@engine.localhost`) | Sales Invoice, Purchase Invoice, Journal Entry, Payment Entry, Quotation (drafts); Customer, Supplier, Item | | Company, Account, Cost Center, Fiscal Year, Currency, Sales/Purchase Taxes and Charges Template, Item Tax Template, Tax Category, GST HSN Code, Price List, Customer Group, Supplier Group, Item Group, Territory, UOM, Warehouse, Mode of Payment, Payment Terms Template |
| Engine Sales (`sales@engine.localhost`) | CRM Lead, CRM Deal, FCRM Note, CRM Task | | CRM Lead Status, CRM Deal Status, CRM Lead Source, CRM Industry, CRM Organization, CRM Territory |
| Engine Support (`support@engine.localhost`) | HD Ticket Comment | HD Ticket | HD Ticket Status, HD Ticket Type, HD Ticket Priority, HD Team |
| Engine People (`people@engine.localhost`) | Leave Application, Attendance (drafts); Employee | | Company, Leave Type, Holiday List, Department, Designation, Branch, Employment Type, Gender |

Each user has exactly its one role (plus frappe's automatic `All` and
`Desk User`), user type System User, no welcome mail, password in
`secrets/bench-users/<slug>.txt`, key in `secrets/agents/<slug>.env`.

## Where the bench differs from the plan, and what was done

1. **Permission calls.** `frappe.permissions.update_permission_property` and
   `add_permission` exist but print messages and validate as they go;
   `wire_bench.py` writes the same `Custom DocPerm` rows directly (after
   `setup_custom_perms`, which copies a doctype's standard rows first, exactly
   as those calls do) and clears the doctype's cache.
2. **Frappe never checks the `amend` right on the server.** An agent could
   post a new document with `amended_from` set and get a draft copy of a
   cancelled, final document. Role rights cannot stop that, so a server
   script `Engine guard: agents make drafts only (<doctype>)` (Before
   Validate) refuses, in an agent's name, any amendment and any save that is
   not a draft, on each submittable doctype above. Second layer for submit.
3. **Helpdesk shows tickets only to its agents.** Support needs an active
   `HD Agent` record (`helpdesk.utils.is_agent`). Making one adds the broad
   `Agent` role; `wire.sh` takes it off again. Being a helpdesk agent also
   unlocks the ticket's own methods `reply_via_agent` and
   `create_communication_via_contact`, which insert a `Communication` with
   `ignore_permissions` (role rights cannot stop them). So a server script
   `Engine guard: agents send nothing (Communication)` and one for
   `Email Queue` (Before Insert) refuse any message or outgoing mail made in
   an agent's name, whatever path it comes by.
   - Today `reply_via_agent` already fails earlier ("Unable to send email",
     no outgoing mail account). Once the owner connects an account the guard
     is what stops it. `create_communication_via_contact` reaches the guard
     today and `--verify` shows it refused.
4. **Server scripts had to be switched on.** They run only with
   `server_script_enabled: 1` in `sites/common_site_config.json`; `wire.sh`
   sets it (the bench rereads that file within 60 seconds, so the first run
   waits a minute; no restart). With it on, the owner (System Manager) can
   write server scripts; agents cannot (no rights on Server Script). If the
   setting is ever turned off, every `Communication` and `Email Queue`
   insert fails for everyone, so the books fail closed: nothing sends.
5. **Frappe shares each user's own User record with that user, with write
   and share,** on every save of the user. An agent could rename itself or
   set a password. `wire.sh` turns that share into read only, and the guard
   `Engine guard: agents change no user (User)` (Before Save) refuses any
   change to any user in an agent's name. Roles, keys and user type are
   level-1 fields an agent never had.
6. **Frappe's automatic `Desk User` role** lets every desk user list the
   names of users and roles (for picking one in a form). Agents see names
   only; reading any other user's record, or any role row or permission rule,
   is refused. Not changed: it is frappe's default for every person too.
7. **Frappe's `All` role** lets every user create and delete their own ToDo,
   File, Contact and Address rows. Not changed (it applies to every person).
   No agent can delete any department record.
8. **CRM shows a salesperson only their own leads and deals**
   (`crm.permissions.org_hierarchy`): those whose `lead_owner` /
   `deal_owner` is the user, or that are assigned to them. **T17: the Sales
   role instructions must say to set `lead_owner` (and `deal_owner`) to its
   own user** (`sales@engine.localhost`) when making one; otherwise Sales
   cannot open what it just made. Leads entered by people are visible to
   Sales only once assigned to it.
9. **Leave requests.** A draft with leave type `Leave Without Pay` works with
   no leave allocation and no holiday list. Other leave types need an
   allocation first (owner set-up). A leave draft works without a holiday
   list, but making it final needs one. **For T11/T17: HRMS submits a Leave
   Application only when its `status` is `Approved` or `Rejected`**, so the
   home screen's approve must set `status: "Approved"` before calling submit.
10. **Final ledger documents cannot be deleted.** A cancelled Sales Invoice
    (or Purchase Invoice, Journal Entry, Payment Entry) is linked to its
    ledger rows, and deleting it fails unless Accounts Settings "Delete
    Accounting and Stock Ledger Entries on deletion of Transaction" is on.
    `--verify` therefore never makes a ledger document final; it shows the
    Bookkeeper's cancel right is 0 with the books' own check
    (`frappe.client.has_permission`), and shows a real cancel refused on an
    Attendance record the owner made final. **For T17's clean-up:** cancelled
    trial invoices need that setting on for the deletion (then off again), or
    stay listed as cancelled.
11. **Numbering.** Deleting the latest record of a series winds the series
    back, so `--verify` deletes newest first and leaves invoice, lead, deal,
    staff, attendance, leave and ticket numbers where they were. CRM Task
    numbers are a database counter and do not wind back (a gap of one per
    verify run; harmless).
12. **History.** Deleting a record leaves a change history, a copy in the bin
    of deleted records and a "deleted" note. `--verify` clears those for its
    own test records with the bench's Python (`wire_bench.py --purge`),
    because deleting them over HTTP would leave new history of its own.
13. Frappe makes a Contact for each new user (`Bookkeeper Agent`, ...). Left
    as is.
14. **Quotations (M37, CONTRACTS-V3 section 35).** The Bookkeeper drafts
    `Quotation`; no other role gains anything, and Sales has no right in the
    books' selling records. Quotation is submittable, so `wire.sh` adds the
    guard `Engine guard: agents make drafts only (Quotation)` by itself. What
    a quotation to a customer needed, read from the doctype
    (`erpnext/selling/doctype/quotation/quotation.json` and `quotation.py`):
    `quotation_to: "Customer"`, `party_name`, `company`, `transaction_date`,
    `order_type: "Sales"`, `items`; `valid_till` is optional. Currency, price
    list and its currency, and their rates are filled in by the books from
    the company and the customer, as for an invoice. Every type this reads
    (Customer, Item, Company, Currency, Price List, Customer Group, Territory,
    UOM, the tax templates, Tax Category, Payment Terms Template) the
    Bookkeeper could already read or make, and the lookups inside the
    quotation's own code (Selling and CRM settings, the customer's name) do
    not check rights. So **no new read-only type was added.** Not proven live
    yet: whether the books accept a draft quotation with the GST set-up as it
    is; M56 runs `--verify`, and if a save is refused for lack of one more
    read right, that type is added read only here and named in this note.
    A quotation is not a ledger document, so `--verify` lets the owner make
    its test quotation final, shows the Bookkeeper cannot change, cancel,
    amend, delete or send from it, then cancels and deletes it newest first,
    which winds the `SAL-QTN-` series back (note 11).

## The two owner calls (CONTRACTS section 8), checked live

| Call | Table says | Bench does |
|---|---|---|
| submit | `POST /api/method/frappe.client.submit` with `{"doc": <the full document as read>}` | Same. Answers 200 with `message` = the document, `docstatus: 1`. An agent's key gets 403 `PermissionError`. |
| comment | `POST /api/method/frappe.desk.form.utils.add_comment` with `reference_doctype, reference_name, content, comment_email, comment_by` | Same. Answers 200 with `message` = the new Comment (its `name`). |

No difference.

## The home screen's fields (PLAN T11), checked live

Every field T11 lists exists on its doctype (`--verify` checks it each run
with the owner's key). Values worth knowing:

- `CRM Lead.status` and `CRM Deal.status` are links to `CRM Lead Status` /
  `CRM Deal Status`. Deal statuses: Qualification, Demo/Making,
  Proposal/Quotation, Negotiation, Ready to Close, Won, Lost (so "open deal"
  = not Won and not Lost holds). Lead statuses: New, Contacted, Nurture,
  Qualified, Unqualified, Junk, Converted. `CRM Lead.converted` is a check.
- `HD Ticket.status` is a link to `HD Ticket Status`: Open, Replied,
  Resolved, Closed.
- `Leave Application.status`: Open, Approved, Rejected, Cancelled.
- `Attendance.status`: Present, Absent, On Leave, Half Day, Work From Home.
- `Employee.status`: Active, Inactive, Suspended, Left.
- Names look like `SINV-26-00001`, `CRM-LEAD-2026-00001`,
  `CRM-DEAL-2026-00001`, `HR-EMP-00001`, `HR-ATT-2026-00001`,
  `HR-LAP-2026-00001`; HD Tickets are `0001`, `0002`, ...
- An agent's draft has `owner` = the agent's user, so the inbox's "made by an
  agent" filter on `owner` works. Helpdesk's own sample ticket `0001`
  "Welcome to Helpdesk" exists from the install.

## Run it

```bash
engine/books/wire.sh            # make or check; a second run prints only `unchanged`
engine/books/wire.sh --verify   # PASS/FAIL lines, then RESULT; exit 0 only when no FAIL
```

`--verify` needs the books on and makes and removes about a dozen records
(one owner-opened test request among them). It never makes a ledger document
final and never sends anything. The two records it does make final, an
attendance record and a quotation, are cancelled and deleted again.
