"""Proves what each department agent can and cannot do in the books, using
the agent's own key, the way the agent itself would call the books.

Run by `wire.sh --verify` with /usr/bin/python3 (standard library only):

    python3 verify.py <state folder> <site> <bench url>

For each agent it shows that it CAN make and edit drafts of its own documents,
and that it CANNOT make anything final (submit, cancel, amend), delete, read or
change users, roles or rights, read another department's records, or send a
message. The owner's two calls the home screen relies on (submit, comment) are
checked on the way. Every test record is removed again with the owner's key.

Prints one line per check, starting with PASS, FAIL or SKIP, then a RESULT
line. Exit 0 only when no line is FAIL. Never prints a key or a secret.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

AGENT_USERS = {
	"bookkeeper": ("Bookkeeper", "bookkeeper@engine.localhost", "erpnext"),
	"sales": ("Sales", "sales@engine.localhost", "crm"),
	"support": ("Support", "support@engine.localhost", "helpdesk"),
	"people": ("People", "people@engine.localhost", "hrms"),
}

# The main records of each department: no other agent may read them.
DEPARTMENT_DOCTYPES = {
	"bookkeeper": ["Sales Invoice", "Purchase Invoice", "Journal Entry", "Payment Entry", "Quotation", "Customer", "Supplier"],
	"sales": ["CRM Lead", "CRM Deal", "FCRM Note"],
	"support": ["HD Ticket", "HD Ticket Comment"],
	"people": ["Employee", "Leave Application", "Attendance"],
}
# Records no agent may read at all.
NOBODY_READS = ["User", "Role", "Has Role", "DocPerm", "Custom DocPerm", "Email Account", "Server Script", "Salary Slip"]

# Every right a permission row can hold (wire_bench.py's ALL_RIGHTS).
ALL_RIGHTS = (
	"read", "write", "create", "delete", "submit", "cancel", "amend",
	"report", "export", "import", "share", "print", "email", "select", "mask",
)

# Rights that must be 0 on an agent's own documents.
NEVER =("submit", "cancel", "amend", "delete", "share", "email", "print", "export", "import", "report")

# The fields the home screen reads (PLAN T11); checked with the owner's key.
HOME_FIELDS = {
	"Sales Invoice": ["name", "customer", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"],
	"Purchase Invoice": ["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"],
	"Journal Entry": ["name", "total_debit", "posting_date", "docstatus", "owner"],
	"Payment Entry": ["name", "party", "paid_amount", "posting_date", "docstatus", "owner"],
	"Quotation": ["name", "party_name", "customer_name", "transaction_date", "valid_till", "grand_total", "docstatus", "owner", "modified"],
	"CRM Lead": ["name", "lead_name", "organization", "status", "converted", "creation"],
	"CRM Deal": ["name", "organization", "status", "deal_value", "modified"],
	"HD Ticket": ["name", "subject", "raised_by", "status", "creation"],
	"HD Ticket Comment": ["name", "reference_ticket", "content", "commented_by", "creation"],
	"Employee": ["name", "employee_name", "designation", "date_of_joining", "status"],
	"Leave Application": ["name", "employee_name", "from_date", "to_date", "status", "docstatus", "owner"],
	"Attendance": ["name", "employee_name", "attendance_date", "status", "docstatus", "owner"],
}
HOME_FIELDS_APP = {
	"Sales Invoice": "erpnext", "Purchase Invoice": "erpnext", "Journal Entry": "erpnext", "Payment Entry": "erpnext",
	"Quotation": "erpnext",
	"CRM Lead": "crm", "CRM Deal": "crm", "HD Ticket": "helpdesk", "HD Ticket Comment": "helpdesk",
	"Employee": "hrms", "Leave Application": "hrms", "Attendance": "hrms",
}

COUNTS = {"PASS": 0, "FAIL": 0, "SKIP": 0}


def line(status, text):
	COUNTS[status] += 1
	print(f"{status} {text}", flush=True)


def check(ok, text):
	line("PASS" if ok else "FAIL", text)
	return ok


class Reply:
	def __init__(self, status, body):
		self.status = status
		self.body = body if isinstance(body, dict) else {}

	@property
	def ok(self):
		return 200 <= self.status < 300

	@property
	def data(self):
		return self.body.get("data") or {}

	@property
	def message(self):
		return self.body.get("message")

	@property
	def exc_type(self):
		return self.body.get("exc_type") or ""

	@property
	def text(self):
		"""The bench's own words for an error, without markup."""
		out = []
		try:
			for m in json.loads(self.body.get("_server_messages") or "[]"):
				out.append(json.loads(m).get("message", ""))
		except (ValueError, AttributeError):
			pass
		return " ".join(out) or str(self.body.get("exception", ""))

	@property
	def denied(self):
		"""Refused for lack of rights."""
		return self.status == 403 and self.exc_type == "PermissionError"

	def guarded(self, words):
		"""Refused by one of the engine's guards (wire_bench.py)."""
		return not self.ok and words in self.text


class Bench:
	def __init__(self, url, site, token):
		self.url, self.site, self._token = url, site, token

	def call(self, method, path, body=None, query=None):
		url = self.url + urllib.parse.quote(path, safe="/._-")
		if query:
			url += "?" + urllib.parse.urlencode(
				{k: (v if isinstance(v, str) else json.dumps(v)) for k, v in query.items()}
			)
		data = json.dumps(body).encode() if body is not None else None
		req = urllib.request.Request(url, data=data, method=method)
		req.add_header("Authorization", "token " + self._token)
		req.add_header("X-Frappe-Site-Name", self.site)
		req.add_header("Accept", "application/json")
		if data is not None:
			req.add_header("Content-Type", "application/json")
		try:
			with urllib.request.urlopen(req, timeout=120) as resp:
				status, raw = resp.status, resp.read()
		except urllib.error.HTTPError as e:
			status, raw = e.code, e.read()
		except (urllib.error.URLError, OSError) as e:
			return Reply(0, {"exception": f"the books did not answer ({e.__class__.__name__})"})
		try:
			return Reply(status, json.loads(raw or b"{}"))
		except ValueError:
			return Reply(status, {})

	def get(self, path, query=None):
		return self.call("GET", path, query=query)

	def post(self, path, body=None):
		return self.call("POST", path, body if body is not None else {})

	def put(self, path, body):
		return self.call("PUT", path, body)

	def delete(self, path):
		return self.call("DELETE", path)

	def method(self, name, body=None):
		return self.post("/api/method/" + name, body)

	def doc(self, doctype, name):
		return self.get(f"/api/resource/{doctype}/{name}")

	def new(self, doctype, values):
		return self.post(f"/api/resource/{doctype}", values)


def read_token(path, env_style):
	try:
		with open(path) as f:
			text = f.read()
	except OSError:
		return None
	if env_style:
		vals = dict(l.split("=", 1) for l in text.splitlines() if "=" in l)
		key, secret = vals.get("UUU_BENCH_API_KEY"), vals.get("UUU_BENCH_API_SECRET")
	else:
		parts = text.split()
		key, secret = (parts + [None, None])[:2]
	return f"{key}:{secret}" if key and secret else None


class Run:
	"""One verify run: the agents, the owner, and the records to remove."""

	def __init__(self, state, site, url):
		self.state, self.site, self.url = state, site, url
		self.mark = "check " + time.strftime("%H%M%S")
		self.created = []  # (doctype, name) in the order made
		self.agents = {}
		self.made = {}  # slug -> {doctype: name}
		token = read_token(os.path.join(state, "secrets", "bench-owner-api.txt"), False)
		self.owner = Bench(url, site, token) if token else None

	def keep(self, doctype, name):
		if name and (doctype, name) not in self.created:
			self.created.append((doctype, name))

	def made_by(self, slug, doctype, reply, what):
		name = reply.data.get("name") if reply.ok else None
		ok = bool(name) and reply.data.get("docstatus", 0) == 0
		if name:
			self.keep(doctype, name)
			self.made.setdefault(slug, {})[doctype] = name
		detail = name if ok else (reply.text or f"answer {reply.status}")
		check(ok, f"{self.agents[slug][0]} can make {what} ({detail})")
		return name if ok else None


def own_rights(run, slug, a, doctype, name):
	"""The books' own reckoning of the agent's rights on its document."""
	r = a.method("frappe.client.get_doc_permissions", {"doctype": doctype, "docname": name})
	perms = (r.message or {}).get("permissions", {}) if r.ok else {}
	wrong = [p for p in NEVER if perms.get(p)]
	check(
		r.ok and perms.get("read") and perms.get("write") and not wrong,
		f"{run.agents[slug][0]}: the books give it read and write on its {doctype} and no "
		+ ", ".join(NEVER) + (f" (but it has: {', '.join(wrong)})" if wrong else ""),
	)


def cannot_finalise(run, slug, a, doctype, name):
	who = run.agents[slug][0]
	full = a.doc(doctype, name).data
	check(a.method("frappe.client.submit", {"doc": full}).denied, f"{who} cannot submit its {doctype} (submit call)")
	check(a.put(f"/api/resource/{doctype}/{name}", {"docstatus": 1}).denied, f"{who} cannot submit its {doctype} (by saving it as final)")
	check(
		a.method("run_doc_method", {"dt": doctype, "dn": name, "method": "submit"}).denied,
		f"{who} cannot submit its {doctype} (through the document's own method)",
	)
	r = a.method("frappe.client.has_permission", {"doctype": doctype, "docname": name, "perm_type": "cancel"})
	check(r.ok and (r.message or {}).get("has_permission") is False, f"{who} may not cancel a {doctype} (the books' own check)")
	r = a.new(doctype, {**copy_of(full), "amended_from": name})
	if r.ok:
		run.keep(doctype, r.data.get("name"))
	check(r.guarded("may not amend"), f"{who} cannot amend a {doctype}")
	check(run.owner.doc(doctype, name).data.get("docstatus") == 0, f"{who}'s {doctype} is still a draft after all that")


def copy_of(doc):
	"""A document as a new one would be sent: without its name and history."""
	drop = {"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "parent", "parentfield", "parenttype", "doctype"}
	out = {}
	for k, v in doc.items():
		if k in drop or k.startswith("_"):
			continue
		if isinstance(v, list):
			v = [{ck: cv for ck, cv in row.items() if ck not in drop} if isinstance(row, dict) else row for row in v]
		out[k] = v
	return out


def cannot_delete(run, slug, a, doctype, name):
	who = run.agents[slug][0]
	ok = a.delete(f"/api/resource/{doctype}/{name}").denied
	ok = a.method("frappe.client.delete", {"doctype": doctype, "name": name}).denied and ok
	check(ok, f"{who} cannot delete its {doctype}")


def cannot_send(run, slug, a, doctype, name):
	who = run.agents[slug][0]
	check(
		a.method("frappe.core.doctype.communication.email.make", {
			"doctype": doctype, "name": name, "subject": run.mark, "content": run.mark,
			"recipients": "nobody@example.invalid", "send_email": 1,
		}).denied,
		f"{who} cannot email from its {doctype}",
	)
	check(
		a.new("Communication", {
			"subject": run.mark, "content": run.mark, "communication_medium": "Email",
			"sent_or_received": "Sent", "recipients": "nobody@example.invalid",
			"reference_doctype": doctype, "reference_name": name,
		}).denied,
		f"{who} cannot make a message record",
	)
	check(
		a.method("frappe.core.doctype.sms_settings.sms_settings.send_sms", {"receiver_list": ["9999999999"], "msg": run.mark}).denied,
		f"{who} cannot send a text message",
	)
	check(
		a.method("frappe.share.add", {"doctype": doctype, "name": name, "user": "Administrator", "read": 1, "notify": 1}).denied,
		f"{who} cannot share its {doctype} with anyone",
	)


def cannot_touch_users(run, slug, a):
	who, email, _app = run.agents[slug]
	others = [u for s, (_n, u, _a) in AGENT_USERS.items() if s != slug]
	check(a.doc("User", "Administrator").denied, f"{who} cannot read the owner's user record")
	check(all(a.doc("User", u).denied for u in others), f"{who} cannot read another agent's user record")
	r = a.get("/api/resource/User", {"fields": ["name", "email", "api_key", "roles"], "limit_page_length": 50})
	check(
		(r.ok and all(set(row) <= {"name"} for row in r.body.get("data", []))) or r.denied,
		f"{who} sees at most the names of users (for picking one in a form), nothing else",
	)
	r = a.put(f"/api/resource/User/{email}", {"first_name": "Changed", "roles": [{"role": "System Manager"}]})
	check(not r.ok, f"{who} cannot change its own user record or roles")
	r = a.method("frappe.client.set_value", {"doctype": "User", "name": email, "fieldname": "new_password", "value": run.mark + "-Xy9!"})
	check(not r.ok, f"{who} cannot set its own password")
	check(a.new("User", {"email": "intruder@engine.localhost", "first_name": "Intruder"}).denied, f"{who} cannot make a user")
	check(a.method("frappe.core.doctype.user.user.generate_keys", {"user": email}).denied, f"{who} cannot make itself a new key")
	check(
		a.new("Has Role", {"parent": email, "parenttype": "User", "parentfield": "roles", "role": "System Manager"}).denied,
		f"{who} cannot give itself a role",
	)
	check(a.new("Role", {"role_name": "Engine Intruder"}).denied, f"{who} cannot make a role")
	check(
		a.new("Custom DocPerm", {"parent": "Sales Invoice", "role": "System Manager", "read": 1, "submit": 1}).denied,
		f"{who} cannot add a permission rule",
	)
	check(
		a.method("frappe.core.page.permission_manager.permission_manager.update", {
			"doctype": "Sales Invoice", "role": "Engine Bookkeeper", "permlevel": 0, "ptype": "submit", "value": 1,
		}).denied,
		f"{who} cannot change a permission rule",
	)
	check(
		a.method("frappe.core.page.permission_manager.permission_manager.add", {
			"parent": "Sales Invoice", "role": "Engine Bookkeeper", "permlevel": 1,
		}).denied,
		f"{who} cannot add a permission level",
	)
	unreadable = [dt for dt in NOBODY_READS if dt not in ("User", "Role") and not a.get(f"/api/resource/{dt}").denied]
	check(not unreadable, f"{who} cannot list role rows, permission rules, mail accounts, scripts or pay slips" + (f" (but can: {', '.join(unreadable)})" if unreadable else ""))


def bookkeeper(run, a):
	m = run.mark
	cust = run.made_by("bookkeeper", "Customer", a.new("Customer", {"customer_name": f"Engine {m} customer", "customer_type": "Company"}), "a customer record")
	code = "ENGINE-" + m.replace(" ", "-").upper()
	item = run.made_by("bookkeeper", "Item", a.new("Item", {
		"item_code": code, "item_name": f"Engine {m} item", "item_group": "Services",
		"stock_uom": "Nos", "is_stock_item": 0, "gst_hsn_code": "998311",
	}), "an item record")
	if not (cust and item):
		return
	inv = run.made_by("bookkeeper", "Sales Invoice", a.new("Sales Invoice", {
		"customer": cust, "company": "Sthyra", "items": [{"item_code": item, "qty": 1, "rate": 100}],
	}), "a draft invoice")
	if not inv:
		return
	check(a.put(f"/api/resource/Sales Invoice/{inv}", {"remarks": f"Engine {m}: edited"}).ok, "Bookkeeper can edit its draft invoice")
	own_rights(run, "bookkeeper", a, "Sales Invoice", inv)
	cannot_finalise(run, "bookkeeper", a, "Sales Invoice", inv)
	cannot_delete(run, "bookkeeper", a, "Sales Invoice", inv)
	cannot_delete(run, "bookkeeper", a, "Customer", cust)
	cannot_send(run, "bookkeeper", a, "Sales Invoice", inv)
	quotation(run, a, cust, item)


def quotation(run, a, cust, item):
	"""The Bookkeeper drafts quotations (CONTRACTS-V3 section 35); the owner
	alone makes one final. Not a ledger document, so the owner can make the
	test one final, cancel it and delete it (NOTES.md notes 10 and 14)."""
	m, o = run.mark, run.owner
	today = time.strftime("%Y-%m-%d")
	later = time.strftime("%Y-%m-%d", time.localtime(time.time() + 30 * 86400))
	values = {
		"quotation_to": "Customer", "party_name": cust, "company": "Sthyra", "order_type": "Sales",
		"transaction_date": today, "valid_till": later, "items": [{"item_code": item, "qty": 1, "rate": 100}],
	}
	qtn = run.made_by("bookkeeper", "Quotation", a.new("Quotation", values), "a draft quotation")
	if not qtn:
		return
	check(a.put(f"/api/resource/Quotation/{qtn}", {"terms": f"Engine {m}: edited"}).ok, "Bookkeeper can edit its draft quotation")
	own_rights(run, "bookkeeper", a, "Quotation", qtn)
	cannot_finalise(run, "bookkeeper", a, "Quotation", qtn)
	r = a.new("Quotation", {**values, "docstatus": 1})
	if r.ok:
		run.keep("Quotation", r.data.get("name"))
	check(
		not r.ok and (r.denied or r.guarded("may only make drafts")),
		"Bookkeeper cannot make a quotation that is final from the start",
	)
	guard = o.doc("Server Script", "Engine guard: agents make drafts only (Quotation)").data
	check(
		guard.get("reference_doctype") == "Quotation" and guard.get("doctype_event") == "Before Validate"
		and not guard.get("disabled") and "may only make drafts" in (guard.get("script") or ""),
		"the guard refuses, in an agent's name, a quotation saved as anything but a draft (its script is on)",
	)
	cannot_delete(run, "bookkeeper", a, "Quotation", qtn)
	cannot_send(run, "bookkeeper", a, "Quotation", qtn)

	# Once the owner has made it final, the Bookkeeper cannot change, cancel or amend it.
	r = o.method("frappe.client.submit", {"doc": o.doc("Quotation", qtn).data})
	if not check(r.ok and (r.message or {}).get("docstatus") == 1, "the owner can make the draft quotation final"):
		return
	check(a.put(f"/api/resource/Quotation/{qtn}", {"terms": f"Engine {m}: changed"}).denied, "Bookkeeper cannot change a final quotation")
	check(a.method("frappe.client.cancel", {"doctype": "Quotation", "name": qtn}).denied, "Bookkeeper cannot cancel a final quotation (cancel call)")
	check(
		a.method("run_doc_method", {"dt": "Quotation", "dn": qtn, "method": "cancel"}).denied,
		"Bookkeeper cannot cancel a final quotation (through the document's own method)",
	)
	check(o.doc("Quotation", qtn).data.get("docstatus") == 1, "the quotation is still final")
	cannot_send(run, "bookkeeper", a, "Quotation", qtn)
	if check(o.method("frappe.client.cancel", {"doctype": "Quotation", "name": qtn}).ok, "the owner can cancel it"):
		r = a.new("Quotation", {**values, "amended_from": qtn})
		if r.ok:
			run.keep("Quotation", r.data.get("name"))
		check(r.guarded("may not amend"), "Bookkeeper cannot amend a cancelled quotation")
		cannot_delete(run, "bookkeeper", a, "Quotation", qtn)


def sales(run, a):
	m, me = run.mark, AGENT_USERS["sales"][1]
	lead = run.made_by("sales", "CRM Lead", a.new("CRM Lead", {
		"first_name": "Engine", "last_name": m, "organization": f"Engine {m} org", "lead_owner": me,
	}), "a lead")
	if not lead:
		return
	check(a.put(f"/api/resource/CRM Lead/{lead}", {"status": "Contacted"}).ok, "Sales can edit its lead")
	run.made_by("sales", "FCRM Note", a.new("FCRM Note", {
		"title": f"Engine {m}", "content": "check", "reference_doctype": "CRM Lead", "reference_docname": lead,
	}), "a note")
	run.made_by("sales", "CRM Task", a.new("CRM Task", {
		"title": f"Engine {m}", "status": "Todo", "reference_doctype": "CRM Lead", "reference_docname": lead,
	}), "a task")
	deal = run.made_by("sales", "CRM Deal", a.new("CRM Deal", {"lead": lead, "deal_owner": me}), "a deal")
	if deal:
		check(a.put(f"/api/resource/CRM Deal/{deal}", {"probability": 20}).ok, "Sales can edit its deal")
		cannot_delete(run, "sales", a, "CRM Deal", deal)
	own_rights(run, "sales", a, "CRM Lead", lead)
	cannot_delete(run, "sales", a, "CRM Lead", lead)
	cannot_send(run, "sales", a, "CRM Lead", lead)


def support(run, a):
	m = run.mark
	# Support may not open requests, so the owner opens one to work on.
	r = run.owner.new("HD Ticket", {"subject": f"Engine {m} request", "raised_by": "Administrator", "description": "check"})
	ticket = r.data.get("name") if r.ok else None
	if not check(bool(ticket), f"the owner can open a test request ({ticket or r.text})"):
		return
	run.keep("HD Ticket", ticket)
	run.made.setdefault("support", {})["HD Ticket"] = ticket
	check(a.doc("HD Ticket", ticket).ok, "Support can read a request")
	r = a.get("/api/resource/HD Ticket", {"fields": ["name"], "limit_page_length": 100})
	check(r.ok and any(row.get("name") == ticket for row in r.body.get("data", [])), "Support can list requests")
	check(a.put(f"/api/resource/HD Ticket/{ticket}", {"priority": "Low"}).ok, "Support can update a request")
	check(a.new("HD Ticket", {"subject": f"Engine {m}", "raised_by": "Administrator", "description": "x"}).denied, "Support cannot open a request itself")
	sender(run, a, ticket)
	draft = run.made_by("support", "HD Ticket Comment", a.new("HD Ticket Comment", {
		"reference_ticket": ticket, "content": f"DRAFT REPLY: Engine {m}", "commented_by": AGENT_USERS["support"][1],
	}), "a draft reply")
	if draft:
		check(a.put(f"/api/resource/HD Ticket Comment/{draft}", {"content": f"DRAFT REPLY: Engine {m}, edited"}).ok, "Support can edit its draft reply")
		own_rights(run, "support", a, "HD Ticket Comment", draft)
		cannot_delete(run, "support", a, "HD Ticket Comment", draft)
	cannot_delete(run, "support", a, "HD Ticket", ticket)
	r = a.method("run_doc_method", {"dt": "HD Ticket", "dn": ticket, "method": "reply_via_agent", "args": {"message": f"Engine {m}"}})
	check(not r.ok, "Support cannot reply to the customer")
	r = a.method("run_doc_method", {"dt": "HD Ticket", "dn": ticket, "method": "create_communication_via_contact", "args": {"message": f"Engine {m}"}})
	check(r.guarded("may not send"), "Support cannot post a message on a request in the customer's name")
	cannot_send(run, "support", a, "HD Ticket", ticket)


def sender(run, a, ticket):
	"""Support reads who raised a request, which the helpdesk keeps at level 7
	of HD Ticket, and nothing more (NOTES.md note 15): it cannot change the
	sender, and level 8 (the request's key, its mail account) stays shut."""
	o = run.owner
	raised_by = o.doc("HD Ticket", ticket).data.get("raised_by")
	data = a.doc("HD Ticket", ticket).data
	check(bool(raised_by) and data.get("raised_by") == raised_by, "Support can read who raised a request (on the request)")
	r = a.get("/api/resource/HD Ticket", {"fields": ["name", "raised_by"], "filters": [["name", "=", ticket]]})
	rows = r.body.get("data", []) if r.ok else []
	check(bool(rows) and rows[0].get("raised_by") == raised_by, "Support can read who raised a request (in the list)")
	a.put(f"/api/resource/HD Ticket/{ticket}", {"raised_by": "intruder@example.invalid"})
	check(o.doc("HD Ticket", ticket).data.get("raised_by") == raised_by, "Support cannot change who raised a request")
	seen = [f for f in ("key", "email_account", "opening_date", "via_customer_portal") if f in data]
	check(not seen, "Support cannot read a request's level-8 fields (its key, its mail account)" + (f" (but can: {', '.join(seen)})" if seen else ""))
	r = o.get("/api/resource/Custom DocPerm", {
		"fields": ["permlevel", *ALL_RIGHTS], "filters": [["parent", "=", "HD Ticket"], ["role", "=", "Engine Support"]],
		"limit_page_length": 20,
	})
	rows = {row.get("permlevel"): row for row in r.body.get("data", [])} if r.ok else {}
	level7 = rows.get(7) or {}
	check(
		sorted(rows) == [0, 7] and level7.get("read") == 1 and not any(level7.get(x) for x in ALL_RIGHTS if x != "read"),
		"the books give Support read and nothing else above level 0 of a request, at level 7 only",
	)


def people(run, a):
	m = run.mark
	emp = run.made_by("people", "Employee", a.new("Employee", {
		"first_name": f"Engine {m}", "gender": "Male", "date_of_birth": "1990-01-01",
		"date_of_joining": "2026-11-01", "company": "Sthyra", "status": "Active",
	}), "a staff record")
	if not emp:
		return
	check(a.put(f"/api/resource/Employee/{emp}", {"designation": "Accountant"}).ok, "People can edit its staff record")
	att = run.made_by("people", "Attendance", a.new("Attendance", {
		"employee": emp, "attendance_date": "2026-11-10", "status": "Present", "company": "Sthyra",
	}), "a draft attendance record")
	leave = run.made_by("people", "Leave Application", a.new("Leave Application", {
		"employee": emp, "leave_type": "Leave Without Pay", "from_date": "2026-11-20", "to_date": "2026-11-21",
		"company": "Sthyra", "status": "Open",
	}), "a draft leave request")
	if leave:
		check(a.put(f"/api/resource/Leave Application/{leave}", {"description": f"Engine {m}"}).ok, "People can edit its draft leave request")
		cannot_finalise(run, "people", a, "Leave Application", leave)
		cannot_delete(run, "people", a, "Leave Application", leave)
	cannot_delete(run, "people", a, "Employee", emp)
	if not att:
		return
	check(a.put(f"/api/resource/Attendance/{att}", {"status": "Work From Home"}).ok, "People can edit its draft attendance record")
	own_rights(run, "people", a, "Attendance", att)
	cannot_finalise(run, "people", a, "Attendance", att)
	cannot_send(run, "people", a, "Attendance", att)

	# Once the owner has made it final, People cannot change, cancel, amend or delete it.
	o = run.owner
	r = o.method("frappe.client.submit", {"doc": o.doc("Attendance", att).data})
	check(r.ok and (r.message or {}).get("docstatus") == 1, "the owner's submit call works (frappe.client.submit with the full document)")
	r = o.method("frappe.desk.form.utils.add_comment", {
		"reference_doctype": "Attendance", "reference_name": att, "content": f"Engine {m}: comment",
		"comment_email": "Administrator", "comment_by": "Administrator",
	})
	check(r.ok and (r.message or {}).get("name"), "the owner's comment call works (frappe.desk.form.utils.add_comment)")
	check(a.put(f"/api/resource/Attendance/{att}", {"status": "Absent"}).denied, "People cannot change a final attendance record")
	check(a.method("frappe.client.cancel", {"doctype": "Attendance", "name": att}).denied, "People cannot cancel a final attendance record (cancel call)")
	check(
		a.method("run_doc_method", {"dt": "Attendance", "dn": att, "method": "cancel"}).denied,
		"People cannot cancel a final attendance record (through the document's own method)",
	)
	check(o.doc("Attendance", att).data.get("docstatus") == 1, "the attendance record is still final")
	if check(o.method("frappe.client.cancel", {"doctype": "Attendance", "name": att}).ok, "the owner can cancel it"):
		r = a.new("Attendance", {"employee": emp, "attendance_date": "2026-11-10", "status": "Present", "company": "Sthyra", "amended_from": att})
		if r.ok:
			run.keep("Attendance", r.data.get("name"))
		check(r.guarded("may not amend"), "People cannot amend a cancelled attendance record")
		cannot_delete(run, "people", a, "Attendance", att)


def cross_department(run):
	"""No agent reads another department's records, by list or by name."""
	for slug, a in run.clients.items():
		who = run.agents[slug][0]
		seen = []
		for other, doctypes in DEPARTMENT_DOCTYPES.items():
			if other == slug or other not in run.clients:
				continue
			for dt in doctypes:
				if not a.get(f"/api/resource/{dt}", {"limit_page_length": 1}).denied:
					seen.append(dt + " list")
			for dt, name in run.made.get(other, {}).items():
				if not a.doc(dt, name).denied:
					seen.append(f"{dt} {name}")
		check(not seen, f"{who} cannot read another department's records" + (f" (but can: {', '.join(seen)})" if seen else ""))


def nothing_sent(run):
	users = [run.agents[s][1] for s in run.clients]
	for dt in ("Communication", "Email Queue"):
		r = run.owner.get(f"/api/resource/{dt}", {"fields": ["name"], "filters": [["owner", "in", users]], "limit_page_length": 5})
		check(r.ok and not r.body.get("data"), f"no {'message' if dt == 'Communication' else 'outgoing mail'} was made in any agent's name")


def home_fields(run, skipped):
	bad = []
	for dt, fields in HOME_FIELDS.items():
		if HOME_FIELDS_APP[dt] in skipped:
			continue
		r = run.owner.get(f"/api/resource/{dt}", {"fields": fields, "limit_page_length": 1})
		if not r.ok:
			bad.append(dt)
	check(not bad, "the home screen's fields exist in the books" + (f" (not in: {', '.join(bad)})" if bad else ""))


def clean_up(run):
	o, left, gone = run.owner, [], []
	for dt, name in reversed(run.created):
		if dt == "HD Ticket":
			r = o.get("/api/resource/Communication", {"fields": ["name"], "filters": [["reference_doctype", "=", dt], ["reference_name", "=", name]]})
			for row in r.body.get("data", []):
				if o.delete(f"/api/resource/Communication/{row['name']}").ok:
					gone.append(("Communication", row["name"]))
		d = o.doc(dt, name)
		if d.status == 404:
			continue
		if d.data.get("docstatus") == 1:
			o.method("frappe.client.cancel", {"doctype": dt, "name": name})
		r = o.delete(f"/api/resource/{dt}/{name}")
		if r.ok:
			gone.append((dt, name))
		elif r.status != 404:
			left.append(f"{dt} {name}")
	still = [f"{dt} {n}" for dt, n in run.created if o.doc(dt, n).status != 404]
	check(not left and not still, f"the {len(run.created)} test records are removed again" + (f" (still there: {', '.join(still or left)})" if still or left else ""))

	# The books also keep a history of each record, a copy of each deleted one
	# and a note that it was deleted; comments and tasks linked to a deleted
	# record are removed in the background. Give that a moment, then clear the
	# rest with the bench's own Python (an HTTP delete would leave new history).
	names = [n for _dt, n in gone]
	for _ in range(10):
		r = o.get("/api/resource/Comment", {"fields": ["name"], "filters": [["reference_name", "in", names], ["comment_type", "!=", "Deleted"]]})
		if not r.body.get("data"):
			break
		time.sleep(1)
	bench = os.path.join(run.state, "books", "bench")
	try:
		p = subprocess.run(
			[os.path.join(bench, "env", "bin", "python"), os.path.join(os.path.dirname(os.path.abspath(__file__)), "wire_bench.py"), "--purge", run.site],
			cwd=os.path.join(bench, "sites"), input=json.dumps(gone), capture_output=True, text=True, timeout=300,
		)
		ok = p.returncode == 0
	except (OSError, subprocess.SubprocessError):
		ok = False
	check(ok, "the books' history of the test records is cleared too")


def main(state, site, url):
	run = Run(state, site, url)
	if not run.owner:
		line("FAIL", "the owner's books key is missing (secrets/bench-owner-api.txt); run engine/books/install.sh")
		return finish()
	if run.owner.get("/api/method/ping").message != "pong":
		line("FAIL", "the books are not answering. Run: engine start")
		return finish()
	try:
		with open(os.path.join(state, "books", "skipped-apps.txt")) as f:
			skipped = set(f.read().split())
	except OSError:
		skipped = set()

	run.clients = {}
	for slug, (name, email, app) in AGENT_USERS.items():
		run.agents[slug] = (name, email, app)
		if app in skipped:
			line("SKIP", f"{name}: the {app} app was left out when Books was installed")
			continue
		token = read_token(os.path.join(state, "secrets", "agents", slug + ".env"), True)
		if not token:
			line("FAIL", f"{name} has no books key yet. Run: engine/books/wire.sh")
			continue
		a = Bench(url, site, token)
		r = a.get("/api/method/frappe.auth.get_logged_user")
		if check(r.ok and r.message == email, f"{name} signs in to the books with its own key as {email}"):
			run.clients[slug] = a

	steps = {"bookkeeper": bookkeeper, "sales": sales, "support": support, "people": people}
	try:
		home_fields(run, skipped)
		for slug, a in run.clients.items():
			steps[slug](run, a)
		cross_department(run)
		for slug, a in run.clients.items():
			cannot_touch_users(run, slug, a)
		nothing_sent(run)
	finally:
		clean_up(run)
	return finish()


def finish():
	result = "holds" if COUNTS["FAIL"] == 0 else "failed"
	print(f"RESULT: {result}: {COUNTS['PASS']} passed, {COUNTS['FAIL']} failed, {COUNTS['SKIP']} skipped", flush=True)
	return 0 if COUNTS["FAIL"] == 0 else 1


if __name__ == "__main__":
	if len(sys.argv) != 4:
		sys.exit(__doc__)
	sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3].rstrip("/")))
