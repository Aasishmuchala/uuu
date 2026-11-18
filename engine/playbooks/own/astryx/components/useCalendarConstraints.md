# useCalendarConstraints
Group: Calendar. Category: utilities.
Import: import { useCalendarConstraints } from '@astryxdesign/core';

Provides date constraint validation combining min/max bounds, range-span caps relative to rangeAnchor, and custom rule functions into isDateDisabled.

## Do
- Set rangeAnchor only while actively picking a range end.
- Use dateConstraints for recurring blackout dates or closures.

## Do not
- Run expensive computation inside dateConstraints.

## See also
- Calendar
- useCalendarDays
- useCalendarNavigation
