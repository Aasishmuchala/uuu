# CheckboxList
Group: Checkbox. Category: Form Controls.
Import: import { CheckboxList } from '@astryxdesign/core';

Checkbox group component for multi-value selection. Collection mode (parent state) + standalone mode (per-item state).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Label text for the checkbox group (always rendered for accessibility). |
| children | ReactNode |  | yes | CheckboxListItem elements. |
| value | string[] |  |  | The currently selected values (collection mode). |
| onChange | (values: string[]) => void |  |  | Callback fired when the selected values change. |
| changeAction | (values: string[]) => void \| Promise<void> |  |  | Async action on change with optimistic updates. While the promise is pending, the toggled item shows a spinner inside its checkbox and is marked aria-busy. |
| isLabelHidden | boolean | false |  | Whether to visually hide the label. |
| description | string |  |  | Description text displayed below the label. |
| isOptional | boolean | false |  | Whether the group is optional. Shows the optional indicator after the group label, unless a surrounding FormLayout already makes fields optional by default. |
| isRequired | boolean | false |  | Whether the group needs at least one checked box. Shows the required indicator after the group label by the same rules as every input field. While no box is checked, the browser blocks submit and moves focus to the first box that is neither disabled nor read-only, with its own message. A disabled or read-only group requires nothing. Show your own error text through status. Mutually exclusive with isOptional. |
| density | 'compact' \| 'balanced' \| 'spacious' | 'balanced' |  | Spacing density for list items. |
| hasDividers | boolean | false |  | Whether to show dividers between items. |
| isDisabled | boolean | false |  | Whether all checkbox items are disabled. |
| disabledMessage | string |  |  | Explains why the group is disabled. Applies to the whole-group disabled state (isDisabled), not per item. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the checkboxes focusable via aria-disabled (toggling stays blocked). Use this instead of wrapping a disabled CheckboxList in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| isReadOnly | boolean | false |  | Whether all checkbox items are read-only. Displays the current state at full opacity but prevents interaction. Unlike isDisabled, read-only checkboxes are not visually dimmed. |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | Status indicator ({ type, message }). |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| containerXstyle | StyleXStyles |  |  | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| containerClassName | string |  |  | Class name for the field container. Same targeting as `containerXstyle`. |
| containerStyle | CSSProperties |  |  | Inline styles for the field container. Same targeting as `containerXstyle`. |
| controlXstyle | StyleXStyles |  |  | StyleX styles for the visual control box: the element that paints the border and background and holds icons and end controls. Never the native input. |
| controlClassName | string |  |  | Class name for the visual control box. |
| controlStyle | CSSProperties |  |  | Inline styles for the visual control box. |

## Do
- Keep the list short: three to seven options is the sweet spot. Beyond that, switch to MultiSelector which adds search and scrolling.
- Turn on dividers (hasDividers) when items have helper text underneath; without them the labels and descriptions blur together.
- Write a group label that says what the choices represent: "Export formats" tells users more than "Options".

## Do not
- Show a CheckboxList when the user can only pick one thing; that is what RadioList is for.
- Put buttons or links inside the trailing slot (endContent); the whole row is already tappable, so a nested button creates two competing click targets.
- Wrap a disabled CheckboxList in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Parts
- CheckboxListItem
