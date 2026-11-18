# StatusDot
Category: Feedback & Status.
Import: import { StatusDot } from '@astryxdesign/core';

Small colored dot indicator for status display (online/offline, severity, etc).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| variant | 'success' \| 'warning' \| 'error' \| 'accent' \| 'neutral' |  | yes | Semantic color variant. |
| label | string |  | yes | Accessible label via aria-label. |
| isPulsing | boolean | false |  | Pulse animation; respects prefers-reduced-motion: reduce. |
| tooltip | string |  |  | Tooltip text on hover to explain status meaning. |
| icon | ReactNode |  |  | Optional ReactNode rendered centered in the dot (currentColor ink); a non-color mark for the status, use a different icon per status. Booleans/empty strings ignored (safe for cond && <Icon/>). Same contract as AvatarStatusDot. |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value. |

## Do
- Use StatusDot as a binary present/absent signal; avoid encoding many distinct states in a single dot, since color and size alone cannot reliably distinguish them.
- Always pair with a visible text label so status is not conveyed by color alone.
- Provide a descriptive `label` prop for screen reader accessibility.
- Pair the dot with an icon that carries the status as a distinct shape when it must stand on its own without adjacent text, so meaning survives without color.
- If you can't add a label or an icon, make sure the status is conveyed elsewhere accessibly (e.g. adjacent text, a table column, or a live region).

## Do not
- Rely on color alone to communicate status; StatusDot is not fully accessible in isolation, so the builder must make the status distinguishable in context via a label, an icon, or an accessible alternative.
- Use the pulse animation for purely decorative purposes; reserve it for states that require immediate attention.
