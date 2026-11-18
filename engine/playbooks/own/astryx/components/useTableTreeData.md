# useTableTreeData
Import: import { useTableTreeData } from '@astryxdesign/core';

Headless tree plugin: indent + expander chevron on the tree column (first column by default), aria-level on body rows, aria-expanded on each expander button. Canonical plugin order puts tree before selection (checkbox column lands left of tree column). Consume treeConfig from useTableTreeState, or construct directly for server-driven trees. hasExpandableRows=false => full no-op (flat-data migration).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| getRowMeta | (item: T) => TableTreeRowMeta \| undefined |  | yes | structural meta per visible row: {id, level (0-based), hasChildren, isExpanded} |
| onToggleItem | (item: T) => void |  | yes | toggle row expansion |
| getRowLabel | (item: T) => string |  |  | derive a row identity for the localized expand/collapse accessible name. Blank or omitted values keep the generic row label. |
| hasExpandableRows | boolean |  | yes | false => plugin is a no-op (no expanders/indent/ARIA) |
| hasExpandAllControl | boolean | false |  | show expand-all/collapse-all toggle in tree column header. Needs isAllExpanded + onExpandAll/onCollapseAll (from useTableTreeState). Defaults to false. |
| isAllExpanded | boolean \| 'indeterminate' |  |  | aggregate state driving the header toggle: true (all) \| false (none) \| 'indeterminate' (some). |
| onExpandAll | () => void |  |  | expand every expandable row (header control) |
| onCollapseAll | () => void |  |  | collapse every row (header control) |
| indent | 'sm' \| 'md' \| 'lg' | 'md' |  | indent step per level: 'sm' \| 'md' \| 'lg' (spacing-3/4/6). Defaults to 'md'. |
| treeColumnKey | string |  |  | column carrying indent + expander. Defaults to first column. |
| hasRowClickExpansion | boolean | false |  | true => clicking an expandable row body toggles it (in addition to the chevron). Leaves stay inert; no-op on flat data. Defaults to false. |

## Example
```jsx
const {visibleData, treeConfig} = useTableTreeState({
  data: files,          // rows may nest under 'children'
  idKey: 'id',
  defaultExpandedIds: ['src'],
});
const tree = useTableTreeData({
  ...treeConfig,
  getRowLabel: item => item.name,
});

<Table data={visibleData} columns={columns} idKey="id" plugins={{tree}} />;
```
