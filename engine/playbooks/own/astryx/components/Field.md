# Field
Group: Field. Category: Form Controls.
Import: import { Field } from '@astryxdesign/core';

Low-level field shell for custom controls needing label/description/status.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Label text for the field (always rendered for accessibility). |
| inputID | string |  | yes | ID for the input element (used for the label htmlFor attribute). |
| labelID | string |  |  | ID applied to the label element itself for group accessibility. |
| isGroupLabel | boolean | false |  | Renders the label as a span for control groups (radiogroup, checkbox list). |
| children | ReactNode |  | yes | The input or control to render. |
| isLabelHidden | boolean | false |  | Visually hide the label (still accessible to screen readers). |
| isDisabled | boolean | false |  | Whether the associated input is disabled. Propagates disabled styling to the label. |
| description | string |  |  | Description text displayed between the label and input. |
| descriptionID | string |  |  | ID for the description element (use for aria-describedby on the input). |
| isOptional | boolean | false |  | Whether the field is optional (mutually exclusive with isRequired). |
| isRequired | boolean | false |  | Whether the field is required (mutually exclusive with isOptional). |
| labelIcon | ReactNode \| IconType |  |  | Icon to display before the label text. See `astryx docs icons` for valid semantic names. |
| labelTooltip | string |  |  | Help text for an info button after the label, named "About {label}". Hover and keyboard focus preview it; a tap, click, Enter, or Space opens it and never focuses or toggles the control. |
| status | {type: 'warning' \| 'error' \| 'success', message?: string, messageID?: string} |  |  | Status indicator with type and optional message. When message is set, displays a colored status box. messageID is for wiring aria-describedby on the input. |
| statusVariant | 'attached' \| 'detached' \| 'tooltip' | 'attached' |  | How status feedback is placed. Attached overlaps an eligible opaque, bordered, fixed-height control; detached renders a message below custom or non-bordered controls; tooltip leaves the visible affordance to the wrapped input and announces its message without a FieldStatus box. |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. Prefer this over setting width via xstyle/className/style, which only size the inner control box. Without a width, a row can shrink the whole field below the natural width of its control, so filter bars shrink instead of overflowing. |
| ref | React.Ref<HTMLDivElement> |  |  | Ref forwarded to the root element. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |
| className | string |  |  | CSS class name(s) appended to the root element. Prefer xstyle for StyleX deduplication. |
| style | React.CSSProperties |  |  | Inline styles applied to the root element. Takes priority over StyleX inline styles. |

## Do
- Wrap custom controls/widgets that need labeling, helper text, optional/required indicators, or validation status.
- Always provide a label; visually hide it only when context is clear.
- Wire inputID/descriptionID to htmlFor and aria-describedby on the inner control.
- Use attached status only for opaque, bordered, fixed-height controls; use detached for custom, tall, translucent, or non-bordered controls.

## Do not
- Nest Field around styled inputs; it double-renders labels and status UI.
- Set both isOptional and isRequired on the same field.
- Hide the label without another way to understand field purpose.

## Parts
- FieldLabel
- FieldStatus

## Example
```jsx
import {useState} from 'react';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Selector} from '@astryxdesign/core/Selector';
import {StackItem} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';

// Every Field-based input (TextInput, Selector, DateInput, ...) can be shrunk
// by its row, so a filter bar never pushes the page sideways. Let the row wrap
// so that on a phone the search box keeps a full line and the selectors move
// below it; on wider screens everything stays on one line, with the search box
// taking the free space.
function OrdersFilterBar() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Awaiting fulfillment');
  const [region, setRegion] = useState('All regions');
  const [sort, setSort] = useState('Newest first');
  return (
    <HStack gap={2} wrap="wrap" vAlign="center">
      <StackItem size="fill">
        <TextInput
          label="Search orders"
          isLabelHidden
          placeholder="Search by order or customer"
          startIcon={<Icon icon="search" />}
          value={query}
          onChange={setQuery}
        />
      </StackItem>
      <Selector
        label="Status"
        isLabelHidden
        options={['All statuses', 'Awaiting fulfillment', 'Shipped', 'Delivered', 'Returned']}
        value={status}
        onChange={setStatus}
      />
      <Selector
        label="Region"
        isLabelHidden
        options={['All regions', 'North America', 'Europe', 'Asia Pacific']}
        value={region}
        onChange={setRegion}
      />
      <Selector
        label="Sort"
        isLabelHidden
        options={['Newest first', 'Oldest first', 'Highest total']}
        value={sort}
        onChange={setSort}
      />
    </HStack>
  );
}
```
