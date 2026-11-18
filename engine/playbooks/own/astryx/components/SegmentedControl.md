# SegmentedControl
Group: SegmentedControl. Category: Action.
Import: import { SegmentedControl } from '@astryxdesign/core';

A segmented button group that allows users to make a single selection from a small set of mutually exclusive options. Use SegmentedControl when all options should be visible at once and the selection controls a value or mode, not page navigation. Under a finger, on a touch device (a coarse primary pointer), the selection slides to the new segment, whether a tap, an arrow key or a new value moved it; with Reduce Motion nothing travels: the old selection fades out as the new one fades in. There, pressing the selected segment lifts it, and dragging it carries the selection along with the selected label’s colour following it, and the segment under the finger is chosen when it lets go; a tap selects through the browser’s click; a pressed unselected segment shows the shared pressed overlay, and nothing dims. A drag that drifts off the control still chooses by its position along it. Going back to the selected segment, or Escape, changes nothing. With a mouse or a pen every change, a click included, slides on the theme’s duration and easing, and dragging the selected segment carries it as a finger does.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string |  | yes | currently selected value (controlled) |
| onChange | (value: string) => void |  | yes | callback on segment selection |
| label | string |  | yes | aria-label for radio group (never rendered) |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | size variant |
| layout | 'hug' \| 'fill' | 'hug' |  | hug (default) sizes to content, capped at container; fill stretches equally |
| isDisabled | boolean | false |  | disables entire control |
| disabledMessage | string |  |  | Explains why the control is disabled. Applies to the whole-group disabled state (isDisabled), not per segment. With isDisabled, shows a tooltip on hover/keyboard focus, and the reason describes each segment (selection stays blocked). Use this instead of wrapping a disabled SegmentedControl in Tooltip, so the reason is attached to the control itself. |
| children | ReactNode |  | yes | SegmentedControlItem children |
| xstyle | StyleXStyles |  |  | additional StyleX styles for container |

## Do
- Use for switching between 2–5 mutually exclusive views or modes where all options should be visible.
- Provide a descriptive label for the control to ensure the group is accessible to screen readers.

## Do not
- Use for page-level navigation; use TabList instead. TabList is a navigation component, while SegmentedControl is an input that always has exactly one selected option.
- Use for simple on/off states; use ToggleButton instead. ToggleButton can be toggled on or off independently, while SegmentedControl enforces a single selection from a group.
- Wrap a disabled SegmentedControl in Tooltip to explain why it is disabled; the reason is then not attached to the control or its segments. Use the disabledMessage prop instead.

## Parts
- SegmentedControlItem

## Example
```jsx
import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';

const SUMMARY = {
  overview: '4 projects, 2 due this week.',
  activity: '18 updates since Monday.',
  members: '12 members, 3 pending invites.',
  billing: 'Next invoice on October 1.',
};

// Inside a VStack the default hug layout keeps its content width; it does not
// stretch to the card. When the card is narrower than the control (a 320px
// phone column), the control caps at the card width and each label truncates
// with an ellipsis instead of running past the card edge. The full label stays
// each segment's accessible name. Keep labels short for phone widths.
function WorkspaceCard() {
  const [view, setView] = useState('overview');
  return (
    <Card maxWidth={480}>
      <VStack gap={3}>
        <Heading level={3}>Team workspace</Heading>
        <SegmentedControl label="Workspace view" value={view} onChange={setView}>
          <SegmentedControlItem value="overview" label="Overview" />
          <SegmentedControlItem value="activity" label="Activity" />
          <SegmentedControlItem value="members" label="Members" />
          <SegmentedControlItem value="billing" label="Billing" />
        </SegmentedControl>
        <Text color="secondary">{SUMMARY[view]}</Text>
      </VStack>
    </Card>
  );
}
```
