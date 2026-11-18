# MoreMenu
Category: Action.
Import: import { MoreMenu } from '@astryxdesign/core';

Overflow menu w/ three-dot icon trigger. Convenience wrapper composing icon-only Button w/ dropdown menu, eliminating boilerplate for state management, positioning, accessibility.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| items | DropdownMenuOption[] |  | yes | Menu items (actions, dividers, sections). Same type as DropdownMenu items. |
| label | string | 'More options' |  | Accessible label (aria-label) + tooltip text. |
| variant | ButtonVariant | 'ghost' |  | Trigger button visual style variant. |
| size | ButtonSize | 'md' |  | Trigger button size. |
| icon | ReactNode |  |  | Override default three-dot icon. Accepts any ReactNode. |
| isDisabled | boolean | false |  | Whether menu trigger disabled. |
| placement | 'above' \| 'below' \| 'start' \| 'end' | 'below' |  | Menu position relative to trigger. Logical (RTL mirrors). |
| alignment | 'start' \| 'center' \| 'end' | 'start' |  | Alignment along the placement axis. 'end' aligns with the trigger's trailing edge. |
| presentation | 'popover' \| 'bottom-sheet' \| 'adaptive' |  |  | Popover, BottomSheet, or adaptive compact-touch presentation. |
| onOpenChange | (isOpen: boolean) => void |  |  | Callback fired when the menu opens or closes. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be stylex.create() value. |

## Do
- Use for overflow or secondary actions; keep primary actions visible outside the menu.
- Use dividers or sections to group related actions when the menu has many items.
- Use `presentation="adaptive"` when the visible overflow trigger should open a thumb-reachable BottomSheet on compact touch devices.

## Do not
- Hide primary actions inside a MoreMenu; they should be directly visible.
