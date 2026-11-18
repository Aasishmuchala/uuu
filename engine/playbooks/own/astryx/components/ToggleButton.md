# ToggleButton
Group: Button. Category: Action.
Import: import { ToggleButton } from '@astryxdesign/core';

toggle btn w/ pressed/unpressed states, icon swap, group integration for single/multi-select

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Accessible label for the button. Used as visible text, or as aria-label for icon-only buttons. |
| isPressed | boolean |  |  | Whether the button is currently pressed. Ignored for a ToggleButtonGroup member with a value. |
| onPressedChange | (isPressed: boolean, event: MouseEvent) => void |  |  | Called synchronously when pressed state should change. Receives the next state and the click event; call event.preventDefault() to skip pressedChangeAction. Without an Action, the callback produces no Action-pending feedback. Ignored for a ToggleButtonGroup member with a value. |
| pressedChangeAction | (isPressed: boolean) => void \| Promise<void> |  |  | Action handler for API- or navigation-backed toggles, run in a transition after the synchronous onPressedChange callback unless that callback calls event.preventDefault(). Works without onPressedChange. Shows an optimistic pressed state and a spinner while pending, and remains interruptible by re-clicks. Omit it for callback-only toggles with no Action-pending feedback. Ignored for a ToggleButtonGroup member with a value. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Button size. Defaults to group size when inside a group. |
| elevation | 'none' \| 'low' \| 'med' \| 'high' | 'none' |  | Resting shadow depth for floating (FAB-style) toggle buttons, mirroring Button. `none` is the default flat button; `low`/`med`/`high` map to the shadow token scale. Applies inside a ToggleButtonGroup as well — grouped children retain their own elevation. |
| isDisabled | boolean | false |  | Whether the button is disabled. |
| isLoading | boolean | false |  | Whether the button shows a loading spinner. |
| icon | ReactNode |  |  | Icon element. When provided without children, button becomes icon-only with tooltip from label. |
| isIconOnly | boolean | false |  | When true, renders as a square icon-only button with `label` as the aria-label and an automatic tooltip from the label. |
| pressedIcon | ReactNode |  |  | Icon shown when pressed. Falls back to icon if not provided. |
| children | ReactNode |  |  | Visible content. If omitted with icon, button becomes icon-only. |
| tooltip | string |  |  | Tooltip text shown on hover. |
| value | string |  |  | Value identifier when used inside ToggleButtonGroup. Required in groups. |
| data-testid | string |  |  | Test selector for automated testing frameworks. |

## Do
- Filled/colored icon for pressed state so users see current state at a glance.
- Keep label identical between states. Let visual treatment communicate the change.
- Wrap related toggles in ToggleButtonGroup with accessible label.

## Do not
- Don't use ToggleButton for one-time actions; use regular Button for submit/delete.
- Don't mix ToggleButtons with regular Buttons in the same group.
- Don't use ToggleButton for persistent settings; use Switch instead.

## Parts
- ToggleButtonGroup
