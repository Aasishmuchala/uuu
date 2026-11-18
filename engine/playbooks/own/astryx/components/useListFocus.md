# useListFocus
Category: focus.
Import: import { useListFocus } from '@astryxdesign/core';

Manages keyboard navigation within linear list following WAI-ARIA menu/listbox/toolbar patterns. Supports arrow key navigation (vertical / horizontal), Home/End for boundaries, optional wrap-around, Escape to close. Suitable for dropdown menus, toolbars, any 1D focusable list.

## Do
- Set orientation to 'horizontal' for toolbars + tab bars, 'vertical' for dropdown menus.
- Provide onEscape callback for menus/dropdowns to return focus to trigger.
- Enable hasRovingTabIndex (+ hasCaretGuard when widget can contain text inputs) for toolbar-style composites that should be a single tab stop.

## Do not
- Use for 2D grid navigation; prefer useGridFocus for grids + calendars.

## See also
- TabMenu
- Toolbar
- useGridFocus
- useFocusTrap
