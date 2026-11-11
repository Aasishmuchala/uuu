"""The books' side of setup-wizard.sh: the three set-up entries only the owner
can give (GST registration, the company's address, the holiday list).

Run with the bench's Python from the bench's sites folder, as wire.sh does:

    python wizard_books.py --status [--json]
    python wizard_books.py --check-gstin <value> [--json]
    python wizard_books.py --apply <answers.json> [--dry-run]

and, without Frappe (any Python 3), for the wizard's line-by-line checks:

    python3 wizard_books.py --check-holiday "<YYYY-MM-DD name>" [--year <year>]
    python3 wizard_books.py --check-pincode <value>
    python3 wizard_books.py --show '<the --status --json output>'

--apply saves everything in one transaction through Frappe documents, so the
apps' own validation runs. On any refusal it rolls back, prints the books' own
reason as plain text and exits 1: nothing is half-saved. --dry-run does the
whole save, reads it back, then rolls back.

What it writes, and why (see engine/books/README.md, "Set-up wizard"):
- Company: gstin, gst_category, default_holiday_list. India Compliance's own
  set-up wizard sets the company's GST number the same way
  (india_compliance/setup_wizard.py, update_company_info).
- The company's own Address (is_your_company_address, linked to the Company):
  the address lines, state, PIN code, gstin and gst_category. Invoices take
  the company's GST number from this address (custom field company_gstin,
  fetch_from company_address.gstin).
- One Holiday List, and one submitted Holiday List Assignment for the
  company: HRMS (version 16) finds a person's holiday list through these
  assignments (hrms/utils/holiday_list.py, get_holiday_list_for_employee),
  not through the company's default alone.

The answers file:
    {"year": 2026,
     "gst": null | {"registered": false}
           | {"registered": true, "gstin": "...", "category": "Regular" | "Composition"},
     "address": null | {"line1", "line2", "city", "state", "pincode", "phone", "email"},
     "holidays": null | {"weekly_offs": ["Sunday", ...], "lines": ["2026-08-15 Independence Day", ...]}}
null keeps that part as it is. Never reads site_config.json or any secret.
"""

import datetime
import html
import json
import re
import sys

SITE = "engine.localhost"
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
CATEGORIES = {"Regular": "Registered Regular", "Composition": "Registered Composition"}
HOLIDAY_LINE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s+(\S.*)$")
PINCODE = re.compile(r"^[1-9][0-9]{5}$")


class Refused(Exception):
	"""A plain reason the answers cannot be used."""


# ---- pure parts (no Frappe) -------------------------------------------------


def holiday_list_dates(year):
	"""The list runs from 1 January of this year to 31 December of next year."""
	return datetime.date(year, 1, 1), datetime.date(year + 1, 12, 31)


def holiday_list_name(company, year):
	return "%s holidays %d-%d" % (company, year, year + 1)


def long_date(d):
	return "%d %s %d" % (d.day, d.strftime("%B"), d.year)


def parse_holiday_line(line, year):
	"""'YYYY-MM-DD name' to (date, name), or Refused with a plain reason."""
	m = HOLIDAY_LINE.match((line or "").strip())
	if not m:
		raise Refused("Write each holiday as a date and a name, like: %d-08-15 Independence Day" % year)
	try:
		d = datetime.date.fromisoformat(m.group(1))
	except ValueError:
		raise Refused("%s is not a real date." % m.group(1)) from None
	start, end = holiday_list_dates(year)
	if not start <= d <= end:
		raise Refused(
			"%s is outside the list, which runs from %s to %s." % (m.group(1), long_date(start), long_date(end))
		)
	return d, m.group(2).strip()


def check_pincode(value):
	"""A PIN code is six digits and does not start with 0."""
	pin = re.sub(r"\s+", "", value or "")
	if not PINCODE.match(pin):
		raise Refused("A PIN code is six digits and does not start with 0.")
	return pin


def merge_holidays(existing_dates, new):
	"""Which of the new (date, name) pairs to add: none whose date is already a
	day off, and no date twice. Returns (to_add, skipped), both in date order."""
	seen = {d if isinstance(d, datetime.date) else datetime.date.fromisoformat(str(d)) for d in existing_dates}
	to_add, skipped = [], []
	for d, name in sorted(new, key=lambda pair: pair[0]):
		if d in seen:
			skipped.append((d, name))
			continue
		seen.add(d)
		to_add.append((d, name))
	return to_add, skipped


def strip_html(text):
	"""The books' messages carry HTML (bold, links); the owner gets plain words."""
	text = re.sub(r"<br\s*/?>", " ", str(text or ""), flags=re.I)
	text = re.sub(r"<[^>]+>", "", text)
	return re.sub(r"\s+", " ", html.unescape(text)).strip()


def normalize_answers(answers, today=None):
	"""Checks the answers' shape and the parts that need no books. Returns a
	clean copy, or raises Refused."""
	if not isinstance(answers, dict):
		raise Refused("The answers file is not readable.")
	today = today or datetime.date.today()
	year = int(answers.get("year") or today.year)
	out = {"year": year, "gst": None, "address": None, "holidays": None}

	gst = answers.get("gst")
	if gst is not None:
		if gst.get("registered"):
			gstin = re.sub(r"\s+", "", str(gst.get("gstin") or "")).upper()
			if not gstin:
				raise Refused("A registered company needs its GST number.")
			category = gst.get("category") or "Regular"
			if category not in CATEGORIES:
				raise Refused("The GST scheme is Regular or Composition.")
			out["gst"] = {"registered": True, "gstin": gstin, "category": category}
		else:
			out["gst"] = {"registered": False}

	address = answers.get("address")
	if address is not None:
		clean = {k: str(address.get(k) or "").strip() for k in ("line1", "line2", "city", "state", "pincode", "phone", "email")}
		for key, label in (("line1", "The first address line"), ("city", "The city"), ("state", "The state")):
			if not clean[key]:
				raise Refused("%s is needed." % label)
		clean["pincode"] = check_pincode(clean["pincode"])
		out["address"] = clean

	holidays = answers.get("holidays")
	if holidays is not None:
		offs = list(holidays.get("weekly_offs") or [])
		for day in offs:
			if day not in WEEKDAYS:
				raise Refused("%s is not a day of the week." % day)
		parsed = [parse_holiday_line(line, year) for line in holidays.get("lines") or [] if str(line).strip()]
		to_add, _ = merge_holidays([], parsed)
		out["holidays"] = {"weekly_offs": [d for d in WEEKDAYS if d in offs], "public": to_add}
	return out


# ---- the books (Frappe) -------------------------------------------------------


def connect():
	import frappe

	frappe.init(site=SITE, sites_path=".")
	frappe.connect()
	frappe.set_user("Administrator")
	return frappe


def state_numbers():
	from india_compliance.gst_india.constants import STATE_NUMBERS

	return STATE_NUMBERS


def state_of_gstin(gstin):
	code = (gstin or "")[:2]
	for state, number in state_numbers().items():
		if number == code:
			return state
	return None


def no_online_lookups():
	"""India Compliance looks a GST number up online only when its API is on.
	Refuse rather than let anything leave this Mac."""
	from india_compliance.gst_india.utils import is_api_enabled

	if is_api_enabled():
		raise Refused(
			"India Compliance's online look-ups are switched on, so a GST number would be sent "
			"over the internet. Nothing was saved. Ask Claude to look at GST Settings."
		)


def company_name(frappe):
	name = frappe.db.get_single_value("Global Defaults", "default_company")
	if name and frappe.db.exists("Company", name):
		return name
	names = frappe.get_all("Company", pluck="name")
	if len(names) != 1:
		raise Refused("The books do not say which company is yours.")
	return names[0]


def own_address(frappe, company):
	"""The company's own address: linked to the Company, not disabled; the
	primary one when there are several."""
	rows = frappe.get_all(
		"Address",
		filters=[
			["Dynamic Link", "link_doctype", "=", "Company"],
			["Dynamic Link", "link_name", "=", company],
			["Address", "disabled", "=", 0],
		],
		fields=["name", "is_primary_address", "creation"],
		order_by="is_primary_address desc, creation asc",
	)
	return rows[0].name if rows else None


def check_gstin(frappe, value):
	from india_compliance.gst_india.utils import validate_gst_category, validate_gstin

	gstin = validate_gstin(value)
	if not gstin:
		raise Refused("Type the GST number: 15 letters and digits.")
	validate_gst_category("Registered Regular", gstin)
	state = state_of_gstin(gstin)
	if not state:
		raise Refused("The first two digits of %s are not a state's code." % gstin)
	return gstin, state


def read_status(frappe):
	from hrms.utils.holiday_list import get_holiday_list_assignments, resolve_holiday_list_assignment

	company = company_name(frappe)
	c = frappe.db.get_value("Company", company, ["gstin", "gst_category", "default_holiday_list"], as_dict=True)
	out = {
		"company": company,
		"gst_category": c.gst_category or "",
		"gstin": c.gstin or "",
		"gst_state": state_of_gstin(c.gstin) if c.gstin else "",
		"address": None,
		"holiday_list": None,
	}
	name = own_address(frappe, company)
	if name:
		a = frappe.get_doc("Address", name)
		out["address"] = {
			"name": a.name,
			"line1": a.address_line1 or "",
			"line2": a.address_line2 or "",
			"city": a.city or "",
			"state": a.state or "",
			"pincode": a.pincode or "",
			"phone": a.phone or "",
			"email": a.email_id or "",
			"gstin": a.get("gstin") or "",
		}
	if c.default_holiday_list and frappe.db.exists("Holiday List", c.default_holiday_list):
		h = frappe.get_doc("Holiday List", c.default_holiday_list)
		offs = sorted(
			{WEEKDAYS[getdate(r.holiday_date).weekday()] for r in h.holidays if r.weekly_off},
			key=WEEKDAYS.index,
		)
		out["holiday_list"] = {
			"name": h.name,
			"from_date": str(h.from_date),
			"to_date": str(h.to_date),
			"weekly_offs": offs,
			"public": [[str(r.holiday_date), strip_html(r.description)] for r in h.holidays if not r.weekly_off],
			"days_off": len(h.holidays),
		}
	assignment = resolve_holiday_list_assignment(
		[], get_holiday_list_assignments([company]).get(company, []), datetime.date.today()
	)
	out["leave_holiday_list"] = assignment.holiday_list if assignment else ""
	return out


def getdate(value):
	from frappe.utils import getdate as _getdate

	return _getdate(value)


def status_lines(s):
	lines = ["Company: %s" % s["company"]]
	if s["gstin"]:
		lines.append("GST: %s, number %s (%s)" % (s["gst_category"], s["gstin"], s["gst_state"]))
	else:
		lines.append("GST: %s, no GST number" % (s["gst_category"] or "not set"))
	a = s["address"]
	if a:
		parts = [a["line1"], a["line2"], a["city"], a["state"], a["pincode"]]
		lines.append("Address: " + ", ".join(p for p in parts if p))
	else:
		lines.append("Address: none")
	h = s["holiday_list"]
	if h:
		lines.append(
			"Holiday list: %s, %s to %s, weekly days off %s, %d public holiday(s)"
			% (h["name"], h["from_date"], h["to_date"], ", ".join(h["weekly_offs"]) or "none", len(h["public"]))
		)
	else:
		lines.append("Holiday list: none")
	if s["leave_holiday_list"]:
		lines.append("Leave uses: %s" % s["leave_holiday_list"])
	else:
		lines.append("Leave uses: no holiday list, so leave cannot be made final")
	return lines


def apply_holidays(frappe, company, year, wanted, done):
	"""Updates this year's list (or makes it), keeps its public holidays, adds
	the new ones and sets the weekly days off. Returns the list's name."""
	start, end = holiday_list_dates(year)
	name = holiday_list_name(company, year)
	default = frappe.db.get_value("Company", company, "default_holiday_list")
	if frappe.db.exists("Holiday List", name):
		doc = frappe.get_doc("Holiday List", name)
		done.append("Holiday list %s: updated" % name)
	else:
		doc = frappe.new_doc("Holiday List")
		doc.holiday_list_name = name
		done.append("Holiday list %s: new" % name)
		if default and frappe.db.exists("Holiday List", default):
			# Public holidays from the list in use now carry over where they fit.
			for r in frappe.get_doc("Holiday List", default).holidays:
				if not r.weekly_off and start <= getdate(r.holiday_date) <= end:
					doc.append("holidays", {"holiday_date": r.holiday_date, "description": r.description})
	doc.from_date = min(getdate(doc.from_date), start) if doc.from_date else start
	doc.to_date = max(getdate(doc.to_date), end) if doc.to_date else end

	# Drop weekly days off that are no longer off, and any that a named public
	# holiday now takes. Public holidays already in the list are kept.
	offs = wanted["weekly_offs"]
	public_dates = {d for d, _ in wanted["public"]}
	doc.set(
		"holidays",
		[
			r
			for r in doc.holidays
			if not r.weekly_off
			or (WEEKDAYS[getdate(r.holiday_date).weekday()] in offs and getdate(r.holiday_date) not in public_dates)
		],
	)
	to_add, skipped = merge_holidays([r.holiday_date for r in doc.holidays], wanted["public"])
	for d, label in to_add:
		doc.append("holidays", {"holiday_date": d, "description": label, "weekly_off": 0})
	for d, label in skipped:
		done.append("%s (%s) is already in the list: kept as it was" % (d.isoformat(), label))
	# Then the list adds the weekly days off through its own method (it skips
	# dates already in the list).
	for day in offs:
		doc.weekly_off = day
		doc.get_weekly_off_dates()
	doc.save()
	return doc.name


def ensure_assignment(frappe, company, holiday_list, done):
	"""HRMS reads a person's holiday list from submitted assignments; one for
	the company covers everyone in it."""
	if frappe.db.exists(
		"Holiday List Assignment",
		{"applicable_for": "Company", "assigned_to": company, "holiday_list": holiday_list, "docstatus": 1},
	):
		return
	hla = frappe.new_doc("Holiday List Assignment")
	hla.applicable_for = "Company"
	hla.assigned_to = company
	hla.holiday_list = holiday_list
	hla.from_date = frappe.db.get_value("Holiday List", holiday_list, "from_date")
	hla.insert()
	hla.submit()
	done.append("Leave now uses %s, from %s" % (holiday_list, hla.from_date))


def apply(frappe, answers):
	"""Everything in the open transaction; the caller commits or rolls back."""
	no_online_lookups()
	company = company_name(frappe)
	done = []
	gst = answers["gst"]
	gstin = frappe.db.get_value("Company", company, "gstin") or ""
	category = frappe.db.get_value("Company", company, "gst_category") or "Unregistered"
	if gst is not None:
		if gst["registered"]:
			gstin, _state = check_gstin(frappe, gst["gstin"])
			category = CATEGORIES[gst["category"]]
		else:
			gstin, category = "", "Unregistered"

	address_name = own_address(frappe, company)
	address = answers["address"]
	if gstin and not address_name and address is None:
		raise Refused("A registered company needs an address in the books. Give the address too.")
	state_after = address["state"] if address else (frappe.db.get_value("Address", address_name, "state") if address_name else "")
	if address and address["state"] not in state_numbers():
		raise Refused("%s is not a state the books know. Check the spelling." % address["state"])
	if gstin and state_after and state_of_gstin(gstin) != state_after:
		raise Refused(
			"The GST number belongs to %s, but the address is in %s. They must be the same state."
			% (state_of_gstin(gstin), state_after)
		)

	company_doc = frappe.get_doc("Company", company)
	if answers["holidays"] is not None:
		company_doc.default_holiday_list = apply_holidays(frappe, company, answers["year"], answers["holidays"], done)
	if gst is not None:
		company_doc.gstin = gstin
		company_doc.gst_category = category
	if gst is not None or answers["holidays"] is not None:
		company_doc.save()
		if gst is not None:
			done.append("Company GST: %s%s" % (category, ", " + gstin if gstin else ""))

	if address is not None or (gst is not None and address_name):
		if address_name:
			a = frappe.get_doc("Address", address_name)
		else:
			a = frappe.new_doc("Address")
			a.address_title = company
			a.address_type = "Billing"
			a.country = "India"
			a.is_primary_address = 1
			a.is_shipping_address = 1
			a.is_your_company_address = 1
			a.append("links", {"link_doctype": "Company", "link_name": company})
		if address is not None:
			a.address_line1 = address["line1"]
			a.address_line2 = address["line2"] or None
			a.city = address["city"]
			a.state = address["state"]
			a.pincode = address["pincode"]
			a.phone = address["phone"] or None
			a.email_id = address["email"] or None
		a.gstin = gstin or None
		a.gst_category = category
		a.save()
		done.append("Company address: %s" % ("updated" if address_name else "new"))

	if answers["holidays"] is not None:
		ensure_assignment(frappe, company, company_doc.default_holiday_list, done)
	return done


def books_reason(frappe, exc):
	if isinstance(exc, Refused):
		return str(exc)
	text = strip_html(str(exc))
	if not text:
		for raw in reversed(frappe.local.message_log or []):
			try:
				text = strip_html(json.loads(raw).get("message") if isinstance(raw, str) else raw.get("message"))
			except Exception:
				text = strip_html(raw)
			if text:
				break
	return text or "The books refused without a reason (%s)." % type(exc).__name__


def main(argv):
	as_json = "--json" in argv
	args = [a for a in argv if a != "--json"]
	mode = args[0] if args else ""

	if mode == "--check-holiday" and len(args) in (2, 4):
		year = int(args[3]) if len(args) == 4 and args[2] == "--year" else datetime.date.today().year
		try:
			d, name = parse_holiday_line(args[1], year)
		except Refused as e:
			print(e)
			return 1
		print("%s %s" % (d.isoformat(), name))
		return 0
	if mode == "--check-pincode" and len(args) == 2:
		try:
			print(check_pincode(args[1]))
		except Refused as e:
			print(e)
			return 1
		return 0

	if mode == "--show" and len(args) == 2:
		print("\n".join(status_lines(json.loads(args[1]))))
		return 0

	if mode == "--status" and len(args) == 1:
		frappe = connect()
		try:
			s = read_status(frappe)
			if as_json:
				s["states"] = sorted(state_numbers())
		finally:
			frappe.destroy()
		print(json.dumps(s) if as_json else "\n".join(status_lines(s)))
		return 0

	if mode == "--check-gstin" and len(args) == 2:
		frappe = connect()
		try:
			gstin, state = check_gstin(frappe, args[1])
		except Exception as e:
			reason = books_reason(frappe, e)
			print(json.dumps({"ok": False, "reason": reason}) if as_json else reason)
			return 1
		finally:
			frappe.db.rollback()
			frappe.destroy()
		print(json.dumps({"ok": True, "gstin": gstin, "state": state}) if as_json else "Valid. It belongs to %s." % state)
		return 0

	if mode == "--apply" and len(args) in (2, 3) and args[2:] in ([], ["--dry-run"]):
		dry = args[2:] == ["--dry-run"]
		try:
			with open(args[1], encoding="utf-8") as f:
				answers = normalize_answers(json.load(f))
		except (OSError, ValueError, Refused) as e:
			print(e if isinstance(e, Refused) else "The answers file could not be read.")
			print("Nothing was saved.")
			return 1
		frappe = connect()
		try:
			try:
				done = apply(frappe, answers)
				after = status_lines(read_status(frappe))
			except Exception as e:
				reason = books_reason(frappe, e)
				frappe.db.rollback()
				print("The books refused: %s" % reason)
				print("Nothing was saved.")
				return 1
			if dry:
				frappe.db.rollback()
			else:
				frappe.db.commit()
		finally:
			frappe.destroy()
		for line in done:
			print(line)
		print("")
		print("The books would then hold:" if dry else "The books now hold:")
		for line in after:
			print("  " + line)
		print("")
		print("Dry run: the books checked all of it, then it was undone. Nothing was saved." if dry else "Saved.")
		return 0

	print(
		"usage: wizard_books.py --status [--json] | --check-gstin <value> [--json]"
		" | --apply <answers.json> [--dry-run] | --check-holiday <line> [--year Y] | --check-pincode <value>"
		" | --show <status json>",
		file=sys.stderr,
	)
	return 64


if __name__ == "__main__":
	sys.exit(main(sys.argv[1:]))
