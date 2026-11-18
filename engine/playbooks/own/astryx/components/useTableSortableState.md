# useTableSortableState
Group: Table. Category: utilities.
Import: import { useTableSortableState } from '@astryxdesign/core';

Owns a Table's sort state + sorts rows locally; convenience layer over useTableSortable. Render sortedData, pass sortConfig to useTableSortable. Uncontrolled or controlled (sort + onSortChange). isMultiSortEnabled: Shift+click adds tiebreakers. Server-sorted data: use useTableSortable directly.

## Do
- Use with in-memory data; pass sortedData to Table.
- Add comparators for non-natural orders (e.g. status rank).

## Do not
- Use for server-side sorted/paginated data.

## See also
- Table
- useTableSortable
- useCollator
