# useTableSelection
Import: import { useTableSelection } from '@astryxdesign/core';

Hook returning TablePlugin for row selection w/ checkboxes, select-all, aria-selected. Uses React Context for independent checkbox re-renders.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| getIsItemSelected | (item: T) => boolean |  | yes | Returns whether item is selected. |
| onSelectItem | (event: {item: T; isSelected: boolean}) => void |  | yes | Called on row checkbox toggle; isSelected = new desired state. |
| onSelectAll | (event: {isAllSelected: boolean}) => void |  | yes | Called on select-all header checkbox toggle. |
| getIsAllSelected | () => boolean |  | yes | Returns whether all selectable items are selected. |
| getIsIndeterminate | () => boolean |  |  | Returns partial selection state; renders indeterminate checkbox. |
| getIsItemSelectable | (item: T) => boolean | () => true |  | Returns whether row shows checkbox; non-selectable rows render nothing. |
| getIsItemEnabled | (item: T) => boolean | () => true |  | Returns whether row checkbox is interactive; disabled rows show disabled checkbox. |
| getRowLabel | (item: T) => string |  |  | Derives row identity for the checkbox's hidden label: `Select ${getRowLabel(item)}`. Falls back to "Select row" when omitted. |
| hasRowHighlight | boolean | true |  | false => skip the accent wash on checked rows (inline style, not overridable from userland). aria-selected is unaffected. Defaults to true. |

## Example
```jsx
const selectionPlugin = useTableSelection({
  getIsItemSelected: item => selectedIds.has(item.id),
  onSelectItem: ({item, isSelected}) => toggle(item.id, isSelected),
  onSelectAll: ({isAllSelected}) => selectAll(isAllSelected),
  getIsAllSelected: () => selectedIds.size === users.length,
  // Screen readers announce "Select Alice", "Select Bob", ...
  // instead of an undifferentiated "Select row" for every checkbox.
  getRowLabel: item => item.name,
});

<Table
  data={users}
  columns={columns}
  idKey="id"
  plugins={{selection: selectionPlugin}}
/>;
```
