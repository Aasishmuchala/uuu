"""Wires the books for the department agents: one draft-only role, one user
and one API key per agent.

Run by wire.sh with the bench's Python from the bench's sites folder:

    python wire_bench.py <site> <state folder>
    python wire_bench.py --purge <site>     (used by verify.py; see purge())

Prints one line per thing it checked, each starting with `created`,
`updated`, `unchanged`, `removed` or `skipped`. Nothing secret is printed:
passwords and keys go straight into mode-0600 files under the state folder.

What each role may do is the table AGENTS below (CONTRACTS section 8). A role
gets rights only on the doctypes listed for it; every other permission row
that names the role is removed. No role may submit, cancel, amend, delete,
share, print, email, export or import anything. Server scripts ("Engine
guard: ...") hold what role rights cannot: in an agent's name they refuse any
message (Communication) or outgoing mail (Email Queue) however it is reached,
any change to a user, and any submit or amend of a submittable doctype. See
NOTES.md for why each is needed.
"""

import json
import os
import secrets
import sys
import time

import frappe
import frappe.permissions
from frappe.utils.password import get_decrypted_password, update_password

BENCH_URL = "http://127.0.0.1:8120"

# What a right set means. Every right not named is 0.
DRAFT = ("read", "write", "create", "select")  # submittable: stays a draft
RECORD = ("read", "write", "create", "select")  # a plain record
UPDATE = ("read", "write", "select")
READ = ("read", "select")
ALL_RIGHTS = (
	"read", "write", "create", "delete", "submit", "cancel", "amend",
	"report", "export", "import", "share", "print", "email", "select", "mask",
)

AGENTS = [
	{
		"slug": "bookkeeper",
		"name": "Bookkeeper",
		"user": "bookkeeper@engine.localhost",
		"role": "Engine Bookkeeper",
		"app": "erpnext",
		"rights": [
			# Quotation: drafts only, like the invoices; the owner approves each
			# (CONTRACTS-V3 section 35; NOTES.md note 14).
			(DRAFT, ["Sales Invoice", "Purchase Invoice", "Journal Entry", "Payment Entry", "Quotation"]),
			(RECORD, ["Customer", "Supplier", "Item"]),
			(READ, [
				"Company", "Account", "Cost Center", "Fiscal Year", "Currency",
				"Sales Taxes and Charges Template", "Purchase Taxes and Charges Template",
				"Item Tax Template", "Tax Category", "GST HSN Code",
				"Price List", "Customer Group", "Supplier Group", "Item Group", "Territory",
				"UOM", "Warehouse", "Mode of Payment", "Payment Terms Template",
			]),
		],
	},
	{
		"slug": "sales",
		"name": "Sales",
		"user": "sales@engine.localhost",
		"role": "Engine Sales",
		"app": "crm",
		"rights": [
			(RECORD, ["CRM Lead", "CRM Deal", "FCRM Note", "CRM Task"]),
			(READ, [
				"CRM Lead Status", "CRM Deal Status", "CRM Lead Source", "CRM Industry",
				"CRM Organization", "CRM Territory",
			]),
		],
	},
	{
		"slug": "support",
		"name": "Support",
		"user": "support@engine.localhost",
		"role": "Engine Support",
		"app": "helpdesk",
		"helpdesk_agent": True,
		"rights": [
			(UPDATE, ["HD Ticket"]),
			(RECORD, ["HD Ticket Comment"]),
			(READ, ["HD Ticket Status", "HD Ticket Type", "HD Ticket Priority", "HD Team"]),
		],
	},
	{
		"slug": "people",
		"name": "People",
		"user": "people@engine.localhost",
		"role": "Engine People",
		"app": "hrms",
		"rights": [
			(DRAFT, ["Leave Application", "Attendance"]),
			(RECORD, ["Employee"]),
			(READ, [
				"Company", "Leave Type", "Holiday List", "Department", "Designation",
				"Branch", "Employment Type", "Gender",
			]),
		],
	},
]

# Server scripts that hold whatever the role rights cannot (see NOTES.md).
# Each refuses only when the request runs in an agent's name. `{users}` is
# replaced by the list of agent users.
GUARD_HEAD = "# Written by engine/books/wire.sh; changes here are undone by its next run.\n"
GUARD_SEND = GUARD_HEAD + """if frappe.session.user in {users}:
	frappe.throw("Agents may not send messages. The owner approves and sends.", title="Not allowed")
"""
GUARD_USER = GUARD_HEAD + """if frappe.session.user in {users}:
	frappe.throw("Agents may not change users.", title="Not allowed")
"""
GUARD_DRAFT = GUARD_HEAD + """if frappe.session.user in {users}:
	if doc.docstatus != 0:
		frappe.throw("Agents may only make drafts. The owner approves them.", title="Not allowed")
	if doc.amended_from and doc.is_new():
		frappe.throw("Agents may not amend a document. The owner does.", title="Not allowed")
"""
# (doctype, event, purpose, script). Drafts guards are added for every
# submittable doctype in AGENTS.
GUARDS = [
	("Communication", "Before Insert", "agents send nothing", GUARD_SEND),
	("Email Queue", "Before Insert", "agents send nothing", GUARD_SEND),
	("User", "Before Save", "agents change no user", GUARD_USER),
]


def say(verb, what):
	print(f"{verb:<9} {what}", flush=True)


def write_secret(path, text):
	"""Writes text to path with mode 0600, replacing it whole."""
	tmp = path + ".tmp"
	fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
	with os.fdopen(fd, "w") as f:
		f.write(text)
	os.chmod(tmp, 0o600)
	os.replace(tmp, path)


def read_env(path):
	out = {}
	try:
		with open(path) as f:
			for line in f:
				line = line.rstrip("\n")
				if "=" in line:
					k, v = line.split("=", 1)
					out[k] = v
	except FileNotFoundError:
		pass
	return out


def skipped_apps(state):
	path = os.path.join(state, "books", "skipped-apps.txt")
	try:
		with open(path) as f:
			return {w.strip() for w in f.read().replace(",", "\n").split() if w.strip()}
	except FileNotFoundError:
		return set()


def wire_role(agent):
	role = agent["role"]
	want = {"desk_access": 1, "two_factor_auth": 0, "disabled": 0}
	if not frappe.db.exists("Role", role):
		doc = frappe.get_doc({"doctype": "Role", "role_name": role, **want})
		doc.insert(ignore_permissions=True)
		say("created", f"role {role}")
		return
	doc = frappe.get_doc("Role", role)
	if any(doc.get(k) != v for k, v in want.items()):
		doc.update(want)
		doc.save(ignore_permissions=True)
		say("updated", f"role {role}")
	else:
		say("unchanged", f"role {role}")


def wire_rights(agent):
	role = agent["role"]
	wanted = {}
	for rights, doctypes in agent["rights"]:
		for dt in doctypes:
			if not frappe.db.exists("DocType", dt):
				say("skipped", f"{role}: {dt} is not in the books")
				continue
			wanted[dt] = set(rights)

	# Rows that name this role on any doctype not wanted, at another level, or
	# only for the owner of a record: removed. Standard rows (DocPerm) only
	# count where no custom rows exist; custom rows replace them.
	custom_parents = set(frappe.permissions.get_doctypes_with_custom_docperms())
	for row in frappe.get_all("Custom DocPerm", filters={"role": role}, fields=["name", "parent", "permlevel", "if_owner"]):
		if row.parent not in wanted or row.permlevel != 0 or row.if_owner:
			frappe.delete_doc("Custom DocPerm", row.name, ignore_permissions=True, force=True)
			frappe.clear_cache(doctype=row.parent)
			say("removed", f"{role}: rights on {row.parent} (level {row.permlevel})")
	for row in frappe.get_all("DocPerm", filters={"role": role}, fields=["parent"]):
		if row.parent not in custom_parents and row.parent not in wanted:
			frappe.permissions.setup_custom_perms(row.parent)
			for c in frappe.get_all("Custom DocPerm", filters={"role": role, "parent": row.parent}, pluck="name"):
				frappe.delete_doc("Custom DocPerm", c, ignore_permissions=True, force=True)
			frappe.clear_cache(doctype=row.parent)
			say("removed", f"{role}: standard rights on {row.parent}")

	for dt, rights in wanted.items():
		values = {r: (1 if r in rights else 0) for r in ALL_RIGHTS}
		frappe.permissions.setup_custom_perms(dt)
		name = frappe.db.get_value("Custom DocPerm", {"parent": dt, "role": role, "permlevel": 0, "if_owner": 0})
		if not name:
			doc = frappe.get_doc({
				"doctype": "Custom DocPerm", "parent": dt, "parenttype": "DocType",
				"parentfield": "permissions", "role": role, "permlevel": 0, "if_owner": 0, **values,
			})
			doc.insert(ignore_permissions=True)
			frappe.clear_cache(doctype=dt)
			say("created", f"{role}: {', '.join(sorted(rights - {'select'}))} on {dt}")
			continue
		doc = frappe.get_doc("Custom DocPerm", name)
		if any(int(doc.get(r) or 0) != v for r, v in values.items()):
			doc.update(values)
			doc.save(ignore_permissions=True)
			frappe.clear_cache(doctype=dt)
			say("updated", f"{role}: {', '.join(sorted(rights - {'select'}))} on {dt}")
		else:
			say("unchanged", f"{role}: rights on {dt}")


def wire_user(agent, state):
	email, role = agent["user"], agent["role"]
	allowed_roles = {role} | set(frappe.permissions.AUTOMATIC_ROLES)
	if not frappe.db.exists("User", email):
		doc = frappe.get_doc({
			"doctype": "User", "email": email, "first_name": agent["name"], "last_name": "Agent",
			"user_type": "System User", "enabled": 1, "send_welcome_email": 0,
			"roles": [{"role": role}],
		})
		doc.flags.no_welcome_mail = True
		doc.insert(ignore_permissions=True)
		say("created", f"user {email}")
	else:
		doc = frappe.get_doc("User", email)
		changed = False
		extra = [r for r in doc.roles if r.role not in allowed_roles]
		for r in extra:
			doc.remove(r)
			changed = True
		if role not in [r.role for r in doc.roles]:
			doc.append("roles", {"role": role})
			changed = True
		for k, v in (("enabled", 1), ("first_name", agent["name"]), ("last_name", "Agent")):
			if doc.get(k) != v:
				doc.set(k, v)
				changed = True
		if changed:
			doc.save(ignore_permissions=True)
			say("updated", f"user {email} (name, enabled, roles: {role} only)")
		else:
			say("unchanged", f"user {email}")

	pw_path = os.path.join(state, "secrets", "bench-users", agent["slug"] + ".txt")
	if os.path.exists(pw_path):
		say("unchanged", f"password of {email} (in secrets/bench-users/{agent['slug']}.txt)")
	else:
		password = secrets.token_urlsafe(24)
		update_password(email, password)
		write_secret(pw_path, password + "\n")
		say("created", f"password of {email} (in secrets/bench-users/{agent['slug']}.txt)")


def wire_helpdesk_agent(agent):
	"""Helpdesk shows tickets only to its agents: an active HD Agent record.
	Making one adds the broad `Agent` role, which is taken off again."""
	email = agent["user"]
	if not frappe.db.exists("HD Agent", email):
		frappe.get_doc({"doctype": "HD Agent", "user": email, "agent_name": agent["name"], "is_active": 1}).insert(
			ignore_permissions=True
		)
		say("created", f"helpdesk agent record for {email}")
	elif not frappe.db.get_value("HD Agent", email, "is_active"):
		frappe.db.set_value("HD Agent", email, "is_active", 1)
		say("updated", f"helpdesk agent record for {email} (active)")
	else:
		say("unchanged", f"helpdesk agent record for {email}")
	user = frappe.get_doc("User", email)
	extra = [r for r in user.roles if r.role not in ({agent["role"]} | set(frappe.permissions.AUTOMATIC_ROLES))]
	if extra:
		for r in extra:
			user.remove(r)
		user.save(ignore_permissions=True)
		say("removed", f"roles {', '.join(r.role for r in extra)} from {email}")


def wire_key(agent, state):
	email = agent["user"]
	path = os.path.join(state, "secrets", "agents", agent["slug"] + ".env")
	have = read_env(path)
	user = frappe.get_doc("User", email)
	current_secret = get_decrypted_password("User", email, "api_secret", raise_exception=False) if user.api_key else None
	good = (
		user.api_key
		and current_secret
		and have.get("UUU_BENCH_API_KEY") == user.api_key
		and have.get("UUU_BENCH_API_SECRET") == current_secret
		and have.get("UUU_BENCH_URL") == BENCH_URL
		and have.get("UUU_BENCH_SITE") == frappe.local.site
		and len(have) == 4
	)
	if good:
		if os.stat(path).st_mode & 0o777 != 0o600:
			os.chmod(path, 0o600)
			say("updated", f"key file secrets/agents/{agent['slug']}.env (mode 0600)")
		else:
			say("unchanged", f"key of {email} (in secrets/agents/{agent['slug']}.env)")
		return
	if not user.api_key:
		user.api_key = frappe.generate_hash(length=15)
	secret = frappe.generate_hash(length=15)
	user.api_secret = secret
	user.save(ignore_permissions=True)
	write_secret(
		path,
		f"UUU_BENCH_URL={BENCH_URL}\nUUU_BENCH_SITE={frappe.local.site}\n"
		f"UUU_BENCH_API_KEY={user.api_key}\nUUU_BENCH_API_SECRET={secret}\n",
	)
	say("created", f"key of {email} (in secrets/agents/{agent['slug']}.env)")


def wire_self_share(agent):
	"""Frappe shares each user's own User record with that user, with the
	right to change and share it. Agents keep reading it, nothing more."""
	email = agent["user"]
	want = {"read": 1, "write": 0, "share": 0, "submit": 0}
	name = frappe.db.get_value("DocShare", {"share_doctype": "User", "share_name": email, "user": email})
	if not name:
		say("unchanged", f"{email} has no rights on its own user record")
		return
	doc = frappe.get_doc("DocShare", name)
	if any(int(doc.get(k) or 0) != v for k, v in want.items()):
		doc.update(want)
		doc.flags.ignore_share_permission = True
		doc.save(ignore_permissions=True)
		say("updated", f"{email} may read its own user record and not change it")
	else:
		say("unchanged", f"{email} may read its own user record and not change it")


def wire_guards(users, wired):
	"""Server scripts that refuse, in an agent's name only: any message or
	outgoing mail, any change to a user, and anything but a fresh draft of a
	submittable doctype (no submit, no amend). Server scripts must be on in
	the bench's common settings; enable_server_scripts() does that first."""
	fill = json.dumps(sorted(users))
	guards = list(GUARDS)
	for agent in wired:
		for _rights, doctypes in agent["rights"]:
			for dt in doctypes:
				if frappe.db.exists("DocType", dt) and frappe.get_meta(dt).is_submittable:
					guards.append((dt, "Before Validate", "agents make drafts only", GUARD_DRAFT))
	names = set()
	for dt, event, purpose, script in guards:
		name = f"Engine guard: {purpose} ({dt})"
		names.add(name)
		want = {
			"script_type": "DocType Event", "reference_doctype": dt,
			"doctype_event": event, "script": script.replace("{users}", fill), "disabled": 0,
		}
		if not frappe.db.exists("Server Script", name):
			doc = frappe.get_doc({"doctype": "Server Script", **want})
			doc.insert(ignore_permissions=True, set_name=name)
			say("created", name)
			continue
		doc = frappe.get_doc("Server Script", name)
		if any(doc.get(k) != v for k, v in want.items()):
			doc.update(want)
			doc.save(ignore_permissions=True)
			say("updated", name)
		else:
			say("unchanged", name)
	for name in frappe.get_all("Server Script", filters={"name": ["like", "Engine guard: %"]}, pluck="name"):
		if name not in names:
			frappe.delete_doc("Server Script", name, ignore_permissions=True, force=True)
			say("removed", name)


def enable_server_scripts():
	"""The guard is a server script, and the bench runs server scripts only
	when its common settings say so. Returns True when it had to switch them on."""
	from frappe.installer import update_site_config

	path = os.path.abspath("common_site_config.json")
	with open(path) as f:
		if json.load(f).get("server_script_enabled"):
			say("unchanged", "books setting: server scripts on (the guard needs them)")
			return False
	update_site_config("server_script_enabled", 1, validate=False, site_config_path=path)
	say("updated", "books setting: server scripts on (the guard needs them)")
	return True


def main(site, state):
	frappe.init(site=site, sites_path=".")
	frappe.connect()
	frappe.set_user("Administrator")
	skipped = skipped_apps(state)
	installed = set(frappe.get_installed_apps())
	users, wired = [], []
	for agent in AGENTS:
		if agent["app"] in skipped or agent["app"] not in installed:
			say("skipped", f"{agent['name']}: the {agent['app']} app was left out when Books was installed")
			continue
		wire_role(agent)
		wire_rights(agent)
		wire_user(agent, state)
		if agent.get("helpdesk_agent"):
			wire_helpdesk_agent(agent)
		wire_key(agent, state)
		wire_self_share(agent)
		users.append(agent["user"])
		wired.append(agent)
		frappe.db.commit()
		frappe.clear_cache(user=agent["user"])
	switched_on = False
	if users:
		switched_on = enable_server_scripts()
		wire_guards(users, wired)
	frappe.db.commit()
	frappe.destroy()
	if switched_on:
		# Running bench processes reread their common settings every 60 seconds.
		print("Waiting a minute for the books to pick up the new setting...", flush=True)
		time.sleep(65)


def purge(site):
	"""Clears the books' own history of records that `wire.sh --verify` made
	and has already deleted with the owner's key: their change history, their
	copies in the bin of deleted records and the "deleted" notes. Reads a JSON
	list of [doctype, name] pairs on stdin. Deletes rows directly, so that the
	clearing leaves no history of its own. Prints how many rows went."""
	pairs = [(dt, name) for dt, name in json.load(sys.stdin)]
	frappe.init(site=site, sites_path=".")
	frappe.connect()
	gone = 0
	for dt, name in pairs:
		if frappe.db.exists(dt, name):
			continue  # never touch the history of a record that is still there
		for table, filters in (
			("Version", {"ref_doctype": dt, "docname": name}),
			("Deleted Document", {"deleted_doctype": dt, "deleted_name": name}),
			("Comment", {"comment_type": "Deleted", "reference_doctype": dt, "subject": f"{dt} {name}"}),
			("Comment", {"reference_doctype": dt, "reference_name": name}),
			("ToDo", {"reference_type": dt, "reference_name": name}),
		):
			n = frappe.db.count(table, filters)
			if n:
				frappe.db.delete(table, filters)
				gone += n
	frappe.db.commit()
	frappe.destroy()
	print(json.dumps({"rows": gone}))


if __name__ == "__main__":
	if len(sys.argv) == 3 and sys.argv[1] == "--purge":
		purge(sys.argv[2])
	elif len(sys.argv) == 3:
		main(sys.argv[1], sys.argv[2])
	else:
		sys.exit(__doc__)
