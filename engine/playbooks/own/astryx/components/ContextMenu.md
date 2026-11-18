# ContextMenu
Group: ContextMenu. Category: Action.
Import: import { ContextMenu } from '@astryxdesign/core';

right-click context menu at cursor position

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | The trigger area: right-click on this content to open the menu. |
| items | ContextMenuOption[] |  |  | Data-driven menu entries. Pass exactly one of `items` or `menuContent`. Each entry is one of: an action item `{label, onClick?, icon?, isDisabled?, variant?, items?}` (nested `items` open a flyout in popover presentation and drill into a new view in bottom-sheet presentation; variant `"destructive"` renders it in the error color), a divider `{type: "divider"}`, or a section `{type: "section", title?, items: [...action items]}`. |
| menuContent | ReactNode |  |  | Custom JSX menu content for compound mode. Pass exactly one of `menuContent` or `items`. |
| menuWidth | number \| string | '160px' |  | Custom menu width. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Size of menu items: controls padding density. |
| label | string | 'Context menu' |  | Accessible name for the menu surface, announced when it opens. |
| onOpenChange | (isOpen: boolean) => void |  |  | Callback fired when the menu opens or closes. |
| presentation | 'popover' \| 'bottom-sheet' \| 'adaptive' | 'popover' |  | Presentation policy. `popover` opens at the pointer position, `bottom-sheet` always uses an action sheet, and `adaptive` uses the BottomSheet on a compact touch screen: a coarse primary pointer, and a viewport narrower than the theme `md` breakpoint (768px by default) or shorter than 500px. |
| isDisabled | boolean | false |  | When true, right-click shows the native browser context menu instead. |
| triggerXstyle | StyleXStyles \| StyleXStyles[] |  |  | Styles applied to the trigger wrapper. Accepts `stylex.create()` values, not inline style objects. |
| triggerAs | 'div' \| 'span' | 'div' |  | The element the trigger wrapper renders as. 'div' is a block; 'span' an inline wrapper, so a reference inside prose can own a context menu without breaking the text flow. |

## Do
- Keep items concise and action-oriented.
- Group related actions with sections and dividers.
- Use adaptive presentation for cursor popover on desktop and BottomSheet on compact touch.
- Ensure actions are also accessible via other UI elements.
- Keep a visible mobile entry point for important actions.

## Do not
- Use as the only way to access important actions.
- Place more than 10–12 items without grouping.

## Parts
- ContextMenuItem
