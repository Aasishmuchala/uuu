# useMultiCombobox
Group: MultiSelector. Category: focus.
Import: import { useMultiCombobox } from '@astryxdesign/core';

Multi-select combobox state + keys; focus stays on control. Powers MultiSelector. Toggle keeps list open; rows may carry an action cell (grid). Renders nothing, sets no attrs: caller renders + wires ARIA.

## Do
- Option id = getItemId(index); control aria-activedescendant = activeDescendantId.
- isGrid only when rows carry a control; action cell id = getActionCellId(index).
- Announce result count via useAnnounce on new query.

## Do not
- Close after each toggle; multi-select stays open.

## See also
- MultiSelector
- useCombobox
- useAnnounce
