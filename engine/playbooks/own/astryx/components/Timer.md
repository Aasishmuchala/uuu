# Timer
Category: Content.
Import: import { Timer } from '@astryxdesign/core';

Standardized elapsed or stopwatch duration with clock-derived, non-rendering DOM updates.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| startTime | number |  |  | operation start as Unix milliseconds; omit to count from Timer's mount |
| format | 'elapsed' \| 'clock' | 'elapsed' |  | elapsed compact units or clock stopwatch notation |
| type | 'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit' | 'supporting' |  | semantic text type; defaults to supporting like Timestamp |
| size | '4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl' |  |  | explicit font size override |
| color | 'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit' | 'secondary' |  | text color; defaults to secondary like Timestamp |
| weight | 'normal' \| 'medium' \| 'semibold' \| 'bold' |  |  | font weight override |
| xstyle | StyleXStyles |  |  | StyleX styles for the Text wrapper |
| className | string |  |  | CSS class for the Text wrapper |
| style | CSSProperties |  |  | inline styles for the Text wrapper |

## Do
- Use elapsed for compact duration text that may span seconds, minutes, or hours.
- Use clock for stopwatch-like surfaces where seconds remain meaningful after an hour.
- Pass startTime when the operation began before Timer mounted so the display reflects the complete wait.

## Do not
- Do not use Timer for dates, time zones, or relative calendar language; use Timestamp instead.
- Do not add aria-live unless hearing an announcement every tick is appropriate for the specific task.

## Example
```jsx
<Timer />
```
