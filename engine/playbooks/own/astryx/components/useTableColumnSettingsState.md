# useTableColumnSettingsState
Group: Table. Category: utilities.
Import: import { useTableColumnSettingsState } from '@astryxdesign/core';

Headless column visibility + ordering state for Table. Manages active columns, toggle/reset operations, produces config for useTableColumnSettings. Renderer-agnostic; pairs with any picker UI.

## Do
- Pass columnSettingsConfig directly to useTableColumnSettings.
- Mark essential identifier columns with isAlwaysVisible: true.

## Do not
- Mutate activeColumnKeys directly; use provided toggle and reset operations.

## See also
- Table
- useTableColumnSettings
- useTableSelectionState
