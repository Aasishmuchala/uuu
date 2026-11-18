# useCalendarNavigation
Group: Calendar. Category: utilities.
Import: import { useCalendarNavigation } from '@astryxdesign/core';

Manages visible month pagination, previous/next stepping, localized month-year labels, and pending cross-month keyboard focus.

## Do
- Wire navigateMonth(-1) and navigateMonth(1) to Previous/Next buttons.
- Provide focusedDate and offset to navigateMonth during keyboard navigation.

## Do not
- Format month-year labels manually instead of using monthYearLabel.

## See also
- Calendar
- useCalendarDays
- useCalendarConstraints
