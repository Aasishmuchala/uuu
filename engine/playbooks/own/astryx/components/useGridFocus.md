# useGridFocus
Category: focus.
Import: import { useGridFocus } from '@astryxdesign/core';

Manages keyboard navigation within 2D grid following WAI-ARIA grid pattern. Supports arrow keys for cell-to-cell navigation, Home/End for row boundaries, Ctrl+Home/Ctrl+End for grid boundaries, Page Up/Down for custom callbacks (e.g. month navigation in calendars). Boundary navigation callbacks allow cross-grid navigation.

## Do
- Use for calendar date grids: wire onPageUp/onPageDown to month navigation + onNavigateBefore/onNavigateAfter for cross-month arrow key navigation.
- Attach both gridRef + handleKeyDown to grid container element.
- For roving-tabindex grids (e.g. Calendar): hasRovingTabIndex: true + attach handleFocus to onFocus; seed one focus target tabindex=0, hook repairs + moves it.

## Do not
- Use for simple linear lists; prefer useListFocus for 1D navigation.

## See also
- Calendar
- useListFocus
- useFocusTrap
