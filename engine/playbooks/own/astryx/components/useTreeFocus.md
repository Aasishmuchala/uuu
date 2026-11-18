# useTreeFocus
Category: focus.
Import: import { useTreeFocus } from '@astryxdesign/core';

Manages roving-tabindex focus + WAI-ARIA tree keyboard model. ArrowUp/Down/Home/End roam linearly over visible treeitems (skip disabled); ArrowRight/Left carry tree semantics (expand/collapse, move to first-child/parent). Enter/Space activate; printable chars trigger typeahead.

## Do
- Use for hierarchical tree widgets: wire onToggleExpand to expansion state + onActiveChange to a single roving tab stop.
- Attach both treeRef + handleKeyDown to role="tree" container.

## Do not
- Use for linear lists (prefer useListFocus) or 2D grids (prefer useGridFocus).

## See also
- TreeList
- useListFocus
- useGridFocus
- useFocusTrap
