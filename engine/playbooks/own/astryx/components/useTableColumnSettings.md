# useTableColumnSettings
Import: import { useTableColumnSettings } from '@astryxdesign/core';

Headless column visibility/ordering. Provides filtered columns, toggle helpers, MultiSelector options.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| columns | ColumnSettingsOption[] |  | yes | All available columns w/ metadata (key, label, isAlwaysVisible, group). |
| activeColumnKeys | string[] |  | yes | Active column keys in display order. |
| onChangeActiveColumnKeys | (keys: string[]) => void |  | yes | Called on column toggle/reorder. |
| defaultColumnKeys | string[] |  |  | Default column set for reset. Omit = show all. |
