# useTableColumnsVirtualization
Import: import { useTableColumnsVirtualization } from '@astryxdesign/core';

Geometry-only column windowing opt-in for Table.virtualization. Keep full data, columns and a stable idKey on Table. Declared widths set the window; pinned columns always mount; a wide enough scroll area mounts every column. Unsupported content or structure renders every column. Native mounted-cell semantics, not discovery of unmounted columns. Adding or removing the capability remounts the table.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| initialViewportWidth | number |  | yes | First-frame inline viewport width for the window plan; does not size the Table; measured scroll area wins after mount. |
