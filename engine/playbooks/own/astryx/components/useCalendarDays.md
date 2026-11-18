# useCalendarDays
Group: Calendar. Category: utilities.
Import: import { useCalendarDays } from '@astryxdesign/core';

Builds one month's day grid: every date incl. previous/next month filler days, grouped into weeks, + localized weekday names starting at weekStartsOn. Calendar's layout, for custom month views. Data only: rendering, selection, keyboard nav, a11y semantics are the caller's.

## Do
- Render dayNames as the header row so it follows weekStartsOn + locale.
- Style isOutside days differently (e.g. dimmed).

## Do not
- Build a selectable date picker with it; use Calendar.

## See also
- Calendar
- useLocale
