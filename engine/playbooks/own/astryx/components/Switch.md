# Switch
Category: Form Controls.
Import: import { Switch } from '@astryxdesign/core';

Toggle switch for boolean values w/ integrated label support.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| ref | React.Ref<HTMLInputElement> |  |  | ref forwarded to underlying <input> |
| label | string |  | yes | Label text (always rendered for a11y). |
| value | boolean |  | yes | Whether switch is on or off. |
| onChange | (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void |  |  | Fired when switch state changes. |
| changeAction | (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void \| Promise<void> |  |  | Async action after onChange; triggers optimistic UI + loading spinner until resolved. |
| isLoading | boolean | false |  | Loading state; shows spinner in thumb. |
| isLabelHidden | boolean | false |  | Visually hides label; still accessible to screen readers. |
| description | string |  |  | Description text below label. |
| isDisabled | boolean | false |  | Whether switch is disabled. |
| size | 'sm' \| 'md' | 'md' |  | Size variant controlling track and thumb dimensions. sm (32x20px) matches sm checkbox/radio vertical rhythm; md (40x24px, default) matches md checkbox/radio vertical rhythm. |
| htmlName | string |  |  | HTML name attr for the checkbox; submits "on" when on. |
| disabledMessage | string |  |  | Explains why the switch is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the switch focusable via aria-disabled (toggling stays blocked). Use this instead of wrapping a disabled Switch in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| isOptional | boolean | false |  | Whether field is optional; mutually exclusive w/ isRequired. |
| isRequired | boolean | false |  | Whether switch is required; mutually exclusive w/ isOptional. |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | Status indicator w/ type + message; colored message box, sets aria-invalid on error. |
| onFocus | (e: FocusEvent<HTMLInputElement>) => void |  |  | Fired when switch receives focus. |
| onBlur | (e: FocusEvent<HTMLInputElement>) => void |  |  | Fired when switch loses focus. |
| labelIcon | IconType |  |  | Icon before label text. |
| labelTooltip | string |  |  | Tooltip text in info icon at label end. |
| labelPosition | 'start' \| 'end' | 'end' |  | Which side label appears; "start" places before switch. |
| labelSpacing | 'hug' \| 'spread' | 'hug' |  | Spacing behavior; "hug" places next to each other, "spread" pushes to opposite ends (full width). |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |

## Do
- Use for settings that apply immediately; the toggle should take effect without a separate save action.
- Pair with a clear, concise label that describes the setting being controlled.

## Do not
- Use for options that require a form submission to take effect; use a checkbox instead.
- Use a switch for multi-state values; it's strictly on/off.
- Wrap a disabled switch in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.
