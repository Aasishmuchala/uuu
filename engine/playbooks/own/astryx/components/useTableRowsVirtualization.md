# useTableRowsVirtualization
Import: import { useTableRowsVirtualization } from '@astryxdesign/core';

Geometry-only fixed-height flat-row opt-in for Table.virtualization. Keep full data and stable idKey on Table. Positive finite CSS-pixel sizes; unsupported content, geometry, identity or a caller scrollWrapper falls back to full rendering. Native mounted-row semantics, not discovery of unmounted rows.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| rowHeight | number |  | yes | Total body-row pitch including density padding and borders; text and supported controls must fit. Taller equal rows window at their measured height. |
| initialViewportHeight | number |  | yes | First-frame viewport height for the window plan; does not size the Table; measured viewport wins after mount. |
