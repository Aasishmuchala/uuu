# RadioList
Group: Radio. Category: Form Controls.
Import: import { RadioList } from '@astryxdesign/core';

Radio group component for single-value selection from list of options.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Label text for the radio group (always rendered for accessibility). |
| value | string |  | yes | The currently selected value. |
| onChange | (value: string) => void |  | yes | Callback fired when the selected value changes. |
| children | ReactNode |  | yes | RadioListItem elements. |
| isLabelHidden | boolean | false |  | Whether to visually hide the label. |
| description | string |  |  | Description text displayed below the label. |
| orientation | 'vertical' \| 'horizontal' | 'vertical' |  | Layout direction of the radio items. |
| isDisabled | boolean | false |  | Whether all radio items are disabled. |
| htmlName | string |  |  | The HTML name attribute shared by the radio inputs, useful for form submissions. When omitted, a unique internal name still groups the radios. |
| disabledMessage | string |  |  | Explains why the group is disabled. Applies to the whole-group disabled state (isDisabled), not per item. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the radios focusable via aria-disabled (selection stays blocked). Use this instead of wrapping a disabled RadioList in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| isRequired | boolean | false |  | Whether the radio group is required. |
| isOptional | boolean | false |  | Whether the field is optional (mutually exclusive with isRequired). |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | Status indicator ({ type, message }). |
| size | 'sm' \| 'md' | 'md' |  | Size of the radio controls. |
| labelTooltip | string |  |  | Tooltip text for an info icon next to the label. |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| containerXstyle | StyleXStyles |  |  | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| containerClassName | string |  |  | Class name for the field container. Same targeting as `containerXstyle`. |
| containerStyle | CSSProperties |  |  | Inline styles for the field container. Same targeting as `containerXstyle`. |
| controlXstyle | StyleXStyles |  |  | StyleX styles for the visual control box: the element that paints the border and background and holds icons and end controls. Never the native input. |
| controlClassName | string |  |  | Class name for the visual control box. |
| controlStyle | CSSProperties |  |  | Inline styles for the visual control box. |

## Do
- Keep the number of options small: typically 2 to 7 choices.
- Use clear, concise labels that differentiate each option at a glance.
- Pre-select a default option when there's a sensible default; don't leave the group empty unless the choice is optional.

## Do not
- Use when multiple selections are needed; use CheckboxList instead.
- Use for long lists; use Selector for better discoverability.
- Use horizontal layout with more than 4 options; it wraps awkwardly.
- Wrap a disabled RadioList in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Parts
- RadioListItem
