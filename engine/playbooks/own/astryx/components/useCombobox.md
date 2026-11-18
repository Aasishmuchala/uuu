# useCombobox
Group: Selector. Category: focus.
Import: import { useCombobox } from '@astryxdesign/core';

Single-select combobox state + keys; focus stays on control. Powers Selector / CommandPalette, and comboboxes over a single-line field you render (search whose results replace a section, an add-people field). Renders nothing: spread getFieldProps / getListboxProps / getOptionProps, or wire role, aria-expanded, aria-controls, aria-activedescendant yourself.

## Do
- Option id = getItemId(index); aria-activedescendant only while open and highlightedIndex points at a rendered option.
- Type-to-select w/o search: run useTypeahead first, fall through when it returns false.
- Own field: spread the getters, set active option on new query (first: Enter picks; -1: Enter stays the field’s).
- Announce result count via useAnnounce on new query (AST-075 DEC-2); for none, the words the field shows.

## Do not
- Non-option controls (create button, empty message) inside listbox; render beside it.
- Move DOM focus onto options; use aria-activedescendant.

## See also
- Selector
- CommandPalette
- useMultiCombobox
- useTypeahead
- useAnnounce
