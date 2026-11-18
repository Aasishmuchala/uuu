# DropdownMenu
Group: DropdownMenu. Category: Action.
Import: import { DropdownMenu } from '@astryxdesign/core';

dropdown menu for actionable items in popup

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| button | DropdownMenuButtonProps | { label: 'Menu' } |  | Props for the trigger button (Button props except onClick). Mutually exclusive with `renderTrigger`. |
| renderTrigger | (props: DropdownMenuTriggerProps) => ReactNode |  |  | Render the control the menu hangs off — an IconButton, a chip, an avatar, a list row — instead of the built-in Button. Spread the given props onto it: they carry the press model (a mouse opens on press-down, a finger or a pen opens as it presses), the keyboard opens, the toggle click, and `aria-haspopup`/`aria-expanded`/`aria-controls`/`id`; the menu is then named by that control through `aria-labelledby`. Mutually exclusive with `button`. |
| items | DropdownMenuOption[] |  | yes | Array of menu entries. Each entry is one of: an action item `{label, onClick?, href?, target?, rel?, icon?, description?, endContent?, isDisabled?, variant?, hasCloseOnSelect?, id?}` (`href` makes the row a real link, so a modified click keeps the browser's meaning; variant `"destructive"` renders it in the error color; `endContent` holds trailing content such as a keyboard-shortcut hint; `id` is the row's stable React key, needed only when the array reorders or filters), a divider `{type: "divider"}`, or a section `{type: "section", title?, id?, items: [...action items]}`. |
| presentation | 'popover' \| 'bottom-sheet' \| 'adaptive' |  |  | Presentation surface for data-driven items. 'popover' stays anchored, 'bottom-sheet' always renders the actions in a modal BottomSheet, and 'adaptive' uses a BottomSheet on compact coarse-pointer layouts while remaining anchored elsewhere. Compound children currently support popover only. Omitted, the menu is anchored, and under a finger or a pen, on every device, its trigger opens as it is pressed (inside a scroll view, after the 150 ms content-touch delay), and the opening finger picks after moving 10 px. Pass 'popover' to keep the pointer behavior on every device, a 500 ms hold included. |
| isMenuOpen | boolean |  |  | Controlled open state for the menu. Mounting with true renders the menu open without moving focus into it; focus moves to the first item only when the menu opens after mount. |
| onOpenChange | (isOpen: boolean) => void |  |  | Callback fired when the open state changes. |
| menuWidth | number \| string |  |  | Minimum width for the popover presentation. Length values may grow for content; intrinsic and CSS-wide keywords select the preferred inline size. Every form is capped to the available viewport space. Defaults to matching the trigger width up to that cap. |
| menuMaxHeight | number |  |  | Maximum height in pixels for the popover presentation, for a menu that must fit its rows. Lifts the default 300px cap; the viewport still bounds it. |
| header | ReactNode |  |  | Content above the rows and outside the menu itself — a filter field, a toggle. A menu holds only its rows, so a control that is not a row goes here or in `footer`, never among the rows. It keeps its own keys and presses. With a header or footer the popover is a modal dialog around the menu: Tab and Shift+Tab move through the header, the menu and the footer and wrap at either end, and Escape closes. The bottom sheet shows it above the actions. |
| footer | ReactNode |  |  | Content below the rows and outside the menu itself — a "Create" button. Tab from the menu moves into it, and Tab past its last control wraps to the start of the dialog (see `header`). The bottom sheet shows it below the actions. |
| placement | 'above' \| 'below' \| 'start' \| 'end' | 'below' |  | Popover placement relative to the trigger. Ignored by the bottom-sheet presentation. Logical: start/end resolve against the menu's own inherited direction (RTL mirrors). |
| alignment | 'start' \| 'center' \| 'end' | 'start' |  | Popover alignment along the placement axis. Ignored by the bottom-sheet presentation. Logical: start/end follow the menu's own inherited direction (RTL mirrors). |
| onClick | () => void |  |  | Callback fired for accepted trigger activation. The trailing click from the same press that light-dismissed the menu is ignored. |
| hasChevron | boolean | true |  | Whether to show a chevron icon on the trigger button. Set to false for icon-only triggers. |
| children | ReactNode |  |  | Compound-mode menu content: DropdownMenuItem, DropdownMenuDivider, DropdownMenuSubMenu (a flyout on a laptop, a drilled-in view with a Back row on a phone), and the selectable items. Mutually exclusive with `items`. |

## Do
- Keep menu items concise and action-oriented so users can scan options quickly.
- Use sections and dividers to group related actions when the menu has many items.
- For a short, flat action set, use presentation="bottom-sheet" when product policy calls for a modal touch surface.
- Use presentation="adaptive" when the same short action set should remain anchored on pointer layouts and become a BottomSheet on compact coarse-pointer layouts.
- For a hierarchy that cannot fit as adjacent flyouts on a compact touch surface, a product may explicitly use a drill-in interaction with a Back action.
- Choose presentation explicitly in product code. A compact, coarse-pointer, hover-free media query is one useful policy, but DropdownMenu does not impose a universal device breakpoint.
- When the content is no longer a short list of immediate actions, reevaluate the interaction and choose a component that matches the actual task; content traits alone do not determine the component.

## Do not
- Use a DropdownMenu for navigation; use a navigation component instead.
- Place more than 10–12 items in a single menu without grouping them into sections.

## Parts
- DropdownMenuItem
