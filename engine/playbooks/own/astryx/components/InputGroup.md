# InputGroup
Group: Field. Category: Form Controls.
Import: import { InputGroup } from '@astryxdesign/core';

groups input with prefix/suffix addons in a connected container

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | InputGroupText, Button addons, and compatible input children: TextInput, NumberInput, TimeInput, DateInput, Typeahead, Tokenizer, Selector, or MultiSelector. |
| label | string |  | yes | Accessible label for the group. |
| isLabelHidden | boolean | false |  | Visually hide the label. |
| description | string |  |  | Helper text between label and input group. |
| isDisabled | boolean | false |  | Disable the entire group. |
| isOptional | boolean | false |  | Show the "Optional" indicator after the label. |
| isRequired | boolean | false |  | Mark the field as required. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Default size for inputs in the group. |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | Validation status. Its message shows below the group. The group border does not change; a theme can style the row from `data-status`. |
| labelTooltip | string |  |  | Tooltip text at the end of the label. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. |
| data-testid | string |  |  | Test selector. |

## Do
- Use text addons to show units, prefixes, or suffixes that clarify input format (e.g. "$", "kg", "[address left out]
- Use InputGroupText for static prefixes/suffixes like "$", "kg", or "[address left out]
- Use Button for an action attached to the input; InputGroup connects its corners automatically.
- Use InputGroup with compatible single-line inputs: TextInput, NumberInput, TimeInput, DateInput, Typeahead, Tokenizer, Selector, and MultiSelector.
- Keep each inner input's label specific; grouped inputs combine the group label with their own label and inherit group description/status.
- Keep multi-value controls (Tokenizer, MultiSelector) short inside a group; the group row is fixed-height and single-line.

## Do not
- Don't put multiple text inputs in one group; use separate fields instead.
- Don't use InputGroup for unrelated inputs; it's for a single input with decorations.
- Don't use InputGroup with TextArea, Slider, Switch, CheckboxInput, or RadioList.

## Parts
- InputGroupText
