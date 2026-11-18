# useTableRowStatus
Import: import { useTableRowStatus } from '@astryxdesign/core';

Returns a TablePlugin with a narrow per-row status column. {status,label} resolves themed success/error/warning glyph + tone. Stable {color,icon?,label} stays custom: color is paint-only, no icon = 8px dot, icon = caller glyph. label is required; null leaves the cell empty. Memoize getStatus.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| getStatus | (item: T) => ({ status: 'success' \| 'warning' \| 'error'; color?: never; icon?: never; label: string } \| { status?: never; color: 'accent' \| 'success' \| 'error' \| 'warning' \| 'red' \| 'orange' \| 'green' \| 'yellow' \| 'blue' \| 'gray' \| string; icon?: IconName; label: string }) \| null |  | yes | Map a row to semantic {status,label}, custom {color,icon?,label}, or null. Semantic status owns themed glyph + tone. Custom color always owns paint; omitted icon = dot, explicit icon = caller glyph. Branches are exclusive and label is required. |
