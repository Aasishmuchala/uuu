# useTableTreeState
Import: import { useTableTreeState } from '@astryxdesign/core';

State companion for useTableTreeData. Owns expanded set (controlled or uncontrolled), flattens nested data to visible rows (collapsed subtrees unmounted, not hidden). Returns {visibleData, treeConfig, expandedIds, isAllExpanded, expandAll, collapseAll} (isAllExpanded = true/false/indeterminate for a header expand-all control). Cell-local state in collapsed subtrees is lost on collapse; lift state that must survive.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| data | T[] |  | yes | nested data; rows carry child rows under childrenKey. Flat data => plugin is a no-op. |
| idKey | (keyof T & string) \| ((item: T) => string \| number) |  | yes | row ID accessor: property name or fn returning unique id |
| childrenKey | string | 'children' |  | property holding children array. Defaults to 'children'. |
| defaultExpandedIds | Iterable<string> |  |  | initial expanded ids (uncontrolled) |
| expandedIds | ReadonlySet<string> |  |  | controlled expanded set; pair with onExpandedIdsChange |
| onExpandedIdsChange | (ids: ReadonlySet<string>) => void |  |  | called with next expanded set on change (both modes); trigger lazy children fetch here |
| isItemExpandable | (item: T) => boolean |  |  | overrides non-empty-children expandability check (lazy loading) |
| sortSiblings | (siblings: T[]) => T[] |  |  | sorts each sibling group during flattening; pass applySort from useTableSortableState |
| indent | 'sm' \| 'md' \| 'lg' | 'md' |  | indent step per level: 'sm' \| 'md' \| 'lg'. Defaults to 'md'. |
| treeColumnKey | string |  |  | column carrying indent + expander. Defaults to first column. |
