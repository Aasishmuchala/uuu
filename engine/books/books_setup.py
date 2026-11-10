"""First-run setup for the books site, without a browser.

Run with the bench's Python from the bench's sites folder, while the bench is
running (setup queues a job):

    python books_setup.py setup <site>
    python books_setup.py owner-key <site> <file>

`setup` does what the setup wizard does in the browser: company Sthyra (STH),
India, INR, Asia/Kolkata, the Indian chart of accounts, fiscal year April 2026
to March 2027. No extra user is made, no demo data, telemetry stays off.

`owner-key` gives the Administrator an API key and secret and writes them,
one per line, to <file> with mode 0600. Nothing secret is printed.
"""

import json
import os
import sys

import frappe

COMPANY = "Sthyra"


def connect(site):
	frappe.init(site=site, sites_path=".")
	frappe.connect()
	frappe.set_user("Administrator")


def india_chart():
	from erpnext.accounts.doctype.account.chart_of_accounts.chart_of_accounts import (
		get_charts_for_country,
	)

	charts = [c for c in get_charts_for_country("India") if not c.startswith("Standard")]
	if len(charts) != 1:
		sys.exit(f"expected one Indian chart of accounts, found: {charts}")
	return charts[0]


def setup(site):
	connect(site)
	if frappe.is_setup_complete():
		print(f"[books] first-run setup already complete on {site}")
	else:
		from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

		chart = india_chart()
		args = {
			"language": "English",
			"country": "India",
			"timezone": "Asia/Kolkata",
			"currency": "INR",
			"company_name": COMPANY,
			"company_abbr": "STH",
			"chart_of_accounts": chart,
			"fy_start_date": "2026-04-01",
			"fy_end_date": "2027-03-31",
			"setup_demo": 0,
			"enable_telemetry": 0,
		}
		print(f"[books] running first-run setup on {site} (chart: {chart})")
		result = setup_complete(json.dumps(args))
		frappe.db.commit()
		print(f"[books] setup result: {result}")
		if not frappe.is_setup_complete():
			sys.exit("first-run setup did not complete")
	if not frappe.db.exists("Company", COMPANY):
		sys.exit(f"company {COMPANY} not found after setup")
	print(f"[books] company {COMPANY} exists")
	frappe.destroy()


def owner_key(site, path):
	connect(site)
	user = frappe.get_doc("User", "Administrator")
	if not user.api_key:
		user.api_key = frappe.generate_hash(length=15)
	secret = frappe.generate_hash(length=15)
	user.api_secret = secret
	user.save(ignore_permissions=True)
	frappe.db.commit()
	fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
	with os.fdopen(fd, "w") as f:
		f.write(f"{user.api_key}\n{secret}\n")
	os.chmod(path, 0o600)
	print(f"[books] owner API key for Administrator written to {path}")
	frappe.destroy()


if __name__ == "__main__":
	if len(sys.argv) == 3 and sys.argv[1] == "setup":
		setup(sys.argv[2])
	elif len(sys.argv) == 4 and sys.argv[1] == "owner-key":
		owner_key(sys.argv[2], sys.argv[3])
	else:
		sys.exit(__doc__)
