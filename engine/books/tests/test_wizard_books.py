"""The pure parts of wizard_books.py, the helper setup-wizard.sh runs inside
the books: reading a holiday line, checking a PIN code, the holiday list's
name and dates, merging holidays without a date twice, and the answers' shape.
None of this needs Frappe; the module imports it only when it talks to the
books.

Run: /usr/bin/python3 -m unittest discover -s engine/books/tests -p 'test_*.py'
"""
import datetime
import os
import subprocess
import sys
import unittest

BOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BOOKS)

import wizard_books as wb  # noqa: E402

D = datetime.date


class HolidayLine(unittest.TestCase):
	def test_date_and_name(self):
		self.assertEqual(wb.parse_holiday_line("2026-08-15 Independence Day", 2026), (D(2026, 8, 15), "Independence Day"))

	def test_spaces_around_are_dropped(self):
		self.assertEqual(wb.parse_holiday_line("  2027-01-26   Republic Day  ", 2026), (D(2027, 1, 26), "Republic Day"))

	def test_name_is_needed(self):
		with self.assertRaisesRegex(wb.Refused, "date and a name"):
			wb.parse_holiday_line("2026-08-15", 2026)

	def test_date_comes_first(self):
		with self.assertRaisesRegex(wb.Refused, "date and a name"):
			wb.parse_holiday_line("Diwali 2026-11-08", 2026)

	def test_other_date_forms_are_refused(self):
		with self.assertRaisesRegex(wb.Refused, "date and a name"):
			wb.parse_holiday_line("15-08-2026 Independence Day", 2026)

	def test_not_a_real_date(self):
		with self.assertRaisesRegex(wb.Refused, "2026-02-30 is not a real date"):
			wb.parse_holiday_line("2026-02-30 Nothing", 2026)

	def test_outside_the_list(self):
		with self.assertRaisesRegex(wb.Refused, "1 January 2026 to 31 December 2027"):
			wb.parse_holiday_line("2028-01-01 New Year", 2026)
		with self.assertRaises(wb.Refused):
			wb.parse_holiday_line("2025-12-31 Old Year", 2026)

	def test_both_ends_are_inside(self):
		self.assertEqual(wb.parse_holiday_line("2026-01-01 New Year", 2026)[0], D(2026, 1, 1))
		self.assertEqual(wb.parse_holiday_line("2027-12-31 Year End", 2026)[0], D(2027, 12, 31))


class Pincode(unittest.TestCase):
	def test_six_digits(self):
		self.assertEqual(wb.check_pincode("560001"), "560001")

	def test_spaces_are_dropped(self):
		self.assertEqual(wb.check_pincode(" 560 001 "), "560001")

	def test_refused(self):
		for bad in ("56001", "5600011", "060001", "56000A", "", None):
			with self.subTest(bad=bad), self.assertRaisesRegex(wb.Refused, "six digits"):
				wb.check_pincode(bad)


class ListNameAndDates(unittest.TestCase):
	def test_name(self):
		self.assertEqual(wb.holiday_list_name("Sthyra", 2026), "Sthyra holidays 2026-2027")

	def test_dates_run_to_the_end_of_next_year(self):
		self.assertEqual(wb.holiday_list_dates(2026), (D(2026, 1, 1), D(2027, 12, 31)))


class Merge(unittest.TestCase):
	def test_new_dates_are_added_in_order(self):
		add, skip = wb.merge_holidays([], [(D(2026, 10, 2), "B"), (D(2026, 8, 15), "A")])
		self.assertEqual(add, [(D(2026, 8, 15), "A"), (D(2026, 10, 2), "B")])
		self.assertEqual(skip, [])

	def test_dates_already_in_the_list_are_kept_as_they_were(self):
		add, skip = wb.merge_holidays(["2026-08-15", D(2026, 1, 26)], [(D(2026, 8, 15), "Again"), (D(2026, 10, 2), "New")])
		self.assertEqual(add, [(D(2026, 10, 2), "New")])
		self.assertEqual(skip, [(D(2026, 8, 15), "Again")])

	def test_no_date_twice_among_the_new(self):
		add, skip = wb.merge_holidays([], [(D(2026, 8, 15), "One"), (D(2026, 8, 15), "Two")])
		self.assertEqual(add, [(D(2026, 8, 15), "One")])
		self.assertEqual(skip, [(D(2026, 8, 15), "Two")])


class Answers(unittest.TestCase):
	TODAY = D(2026, 11, 11)

	def test_keep_everything(self):
		self.assertEqual(
			wb.normalize_answers({"gst": None, "address": None, "holidays": None}, self.TODAY),
			{"year": 2026, "gst": None, "address": None, "holidays": None},
		)

	def test_full(self):
		out = wb.normalize_answers(
			{
				"year": 2026,
				"gst": {"registered": True, "gstin": " 29abcde1234f1zw ", "category": "Composition"},
				"address": {"line1": "12 MG Road", "city": "Bengaluru", "state": "Karnataka", "pincode": "560001"},
				"holidays": {"weekly_offs": ["Sunday", "Saturday"], "lines": ["2026-08-15 Independence Day", ""]},
			},
			self.TODAY,
		)
		self.assertEqual(out["gst"], {"registered": True, "gstin": "29ABCDE1234F1ZW", "category": "Composition"})
		self.assertEqual(out["address"]["line2"], "")
		self.assertEqual(out["holidays"]["weekly_offs"], ["Saturday", "Sunday"])
		self.assertEqual(out["holidays"]["public"], [(D(2026, 8, 15), "Independence Day")])

	def test_refusals(self):
		cases = [
			({"gst": {"registered": True}}, "GST number"),
			({"gst": {"registered": True, "gstin": "X", "category": "Other"}}, "Regular or Composition"),
			({"address": {"city": "B", "state": "K", "pincode": "560001"}}, "first address line"),
			({"address": {"line1": "1", "city": "B", "state": "K", "pincode": "56001"}}, "six digits"),
			({"holidays": {"weekly_offs": ["Sun"]}}, "not a day of the week"),
			({"holidays": {"weekly_offs": [], "lines": ["Diwali"]}}, "date and a name"),
		]
		for answers, reason in cases:
			with self.subTest(reason=reason), self.assertRaisesRegex(wb.Refused, reason):
				wb.normalize_answers(answers, self.TODAY)


class Plain(unittest.TestCase):
	def test_html_is_stripped(self):
		self.assertEqual(
			wb.strip_html("Postal Code <strong>600001</strong> for address <a href='x'>A-1</a><br>is not &amp; ok"),
			"Postal Code 600001 for address A-1 is not & ok",
		)

	def test_the_wizard_checks_run_without_frappe(self):
		run = lambda *a: subprocess.run(  # noqa: E731
			[sys.executable, "-I", os.path.join(BOOKS, "wizard_books.py"), *a], capture_output=True, text=True
		)
		ok = run("--check-holiday", "2026-08-15  Independence Day", "--year", "2026")
		self.assertEqual((ok.returncode, ok.stdout), (0, "2026-08-15 Independence Day\n"))
		bad = run("--check-pincode", "56001")
		self.assertEqual(bad.returncode, 1)
		self.assertIn("six digits", bad.stdout)


if __name__ == "__main__":
	unittest.main()
