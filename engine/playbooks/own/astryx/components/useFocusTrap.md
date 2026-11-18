# useFocusTrap
Category: focus.
Import: import { useFocusTrap } from '@astryxdesign/core';

Traps focus within container element following WAI-ARIA dialog focus trap pattern. Listens to document focus events + redirects focus back into container if a Tab from inside moves focus out. Handles both Tab + Shift+Tab wrapping. Tab pressed while focus outside container left to the page. Mouse clicks outside container not intercepted; use light-dismiss handler for that.

## Do
- Call focusFirst() when opening dialog/modal to move focus into trapped region.
- Provide onEscape callback to close dialog when Escape pressed.
- Rely on built-in focus restoration on close; add own onHide focus handling only to send focus somewhere other than previously-focused element.

## Do not
- Use on non-modal content like tooltips / dropdowns; those need light-dismiss, not focus trapping.

## See also
- Dialog
- DatePicker
- useListFocus
- useScrollLock
