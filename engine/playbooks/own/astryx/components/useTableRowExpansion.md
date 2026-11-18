# useTableRowExpansion
Import: import { useTableRowExpansion } from '@astryxdesign/core';

Returns a TablePlugin that expands a full-width detail panel below a row via renderExpanded(item). Adds a chevron column + right-click expand/collapse action; consumer owns expandedKeys. Panel content starts at the first column (past the chevron), inset by density. For nested child rows that reuse parent columns, use useTableTreeData + useTableTreeState instead.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| expandedKeys | Set<string> |  | yes | Set of currently-expanded row keys. Consumer-owned. |
| onToggle | (key: string) => void |  | yes | Called with a row key when its expansion is toggled. |
| getRowKey | (item: T) => string |  | yes | Derive a stable unique key from a row item. |
| getRowLabel | (item: T) => string |  |  | Derive a row identity for the localized expand/collapse control label. Blank or omitted values keep the generic row label. |
| renderExpanded | (item: T) => ReactNode |  | yes | Render the full-width detail panel below an expanded row. Receives the row item. |
| getIsItemExpandable | (item: T) => boolean |  |  | Control which rows are expandable. Defaults to all rows expandable. |
| panelVariant | 'muted' \| 'transparent' | 'transparent' |  | Detail panel background: 'transparent' (default) paints nothing, so the panel takes the surface behind the table and leaves a striped table's zebra alone; 'muted' washes it, for a bare table where nothing else separates the panel from the data. |
| hasRowClickExpansion | boolean | false |  | Toggle a row by clicking anywhere on it, not just the chevron; pointer-only, skips interactive cell content and text selections. Defaults to false. |
| animatedLayout | AnimatedLayout |  |  | Handle from useAnimatedLayout: opening or closing a panel glides the rows after it instead of jumping them. Under Reduce Motion they fade in place on touch and change at once with a mouse; with column lines they change at once. |

## Example
```jsx
const [expandedKeys, setExpandedKeys] = useState(new Set());
const expansion = useTableRowExpansion({
  expandedKeys,
  onToggle: key =>
    setExpandedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    }),
  getRowKey: item => item.id,
  getRowLabel: item => item.name,
  renderExpanded: item => <OrderDetails order={item} />,
});

<Table data={orders} columns={columns} idKey="id" plugins={{expansion}} />;
```
