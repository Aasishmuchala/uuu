# 23: Tax by month on the Books dashboard

**What to build:** The owner cannot check a GST split or a past month from the home screen. The "GST summary for a month" job gives the figures as a file, but the Books dashboard shows only what is owed and what is drafted. Add a "Tax by month" section to the Books dashboard: for each of the last twelve months, the taxable value and each tax head (CGST, SGST, IGST) from final sales invoices and final purchase bills, read from the books by the home server.

**Blocked by:** none

**Status:** needs-triage

**Plan tasks:** none (found by the Books trial on 12 November 2026; finding 20 in the second trials)

- [ ] The figures come from final records only, never from drafts
- [ ] A month with nothing in it says so plainly
- [ ] The figures for a month equal the "GST summary for a month" job's figures for the same month
- [ ] The section reads well at 390 px wide, light and dark
- [ ] A test built from stub records covers a month with both in-state and out-of-state tax
