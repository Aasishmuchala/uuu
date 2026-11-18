# ProgressBar
Category: Feedback & Status.
Import: import { ProgressBar } from '@astryxdesign/core';

Progress bar for displaying determinate or indeterminate progress.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | accessible label |
| value | number | 0 |  | Current value (ignored when indeterminate). |
| max | number | 100 |  | Maximum value. |
| isLabelHidden | boolean | false |  | Visually hide label (remains accessible). |
| hasValueLabel | boolean | false |  | Show formatted value text (ignored when indeterminate). |
| formatValueLabel | (value: number, max: number) => string |  |  | Custom value label formatter; defaults to percentage string. |
| variant | 'accent' \| 'success' \| 'warning' \| 'error' \| 'neutral' | 'accent' |  | Semantic color variant. |
| isIndeterminate | boolean | false |  | Animated loading indicator for unknown progress. Under reduced motion it pulses in place instead of sliding. |
| marks | ReadonlyArray<{value: number; label: string}> |  |  | Fixed target marks ({value, label?}) drawn on the track in the 0..max scale; stay visible past the fill. Marks inside the fill take the variant on-color; marks on the bare track take the primary text color (secondary when disabled). A label reveals a tooltip on hover/focus. Ignored when indeterminate. |
| isDisabled | boolean | false |  | Visually disabled: grays out fill and text. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value. |

## Do
- Use a determinate bar when the total amount of work is known, and indeterminate when it's not.
- Choose a color variant that matches the context: accent for general progress, success for completion, warning or error for alerts.
- Always provide a label, even if hidden; screen readers need it to announce what's loading.

## Do not
- Place icons or labels inside the bar; compose them alongside it using layout components.
- Use a progress bar for instant actions; it's meant for operations that take noticeable time.
- Use multiple progress bars stacked together for the same operation; use one bar with a value label instead.
