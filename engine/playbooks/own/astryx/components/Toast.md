# Toast
Group: Toast. Category: Overlay.
Import: import { Toast } from '@astryxdesign/core';

toast notification w/ auto-dismiss, stacking, dedup, smooth animations; MediaTheme inverted surface

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| body | ReactNode |  | yes | primary message content |
| type | 'info' \| 'error' | 'info' |  | toast type; controls bg color; error persists until dismissed |
| isAutoHide | boolean |  |  | auto-dismiss; true for info, false for error |
| autoHideDuration | number | 5000 |  | ms before auto-dismiss; timed content must satisfy WCAG 2.2.1 |
| endContent | ReactNode |  |  | trailing end content (undo btn, link); keep action labels short |
| uniqueID | string |  |  | unique id for dedup |
| collisionBehavior | 'overwrite' \| 'ignore' | 'overwrite' |  | behavior when matching uniqueID exists |
| onHide | (reason: "auto" \| "manual") => void |  |  | callback when toast removed |
| onDismiss | (reason: "auto" \| "manual") => void |  | yes | Callback fired when the toast is dismissed. |
| renderContent | (toast: ToastContentRenderProps) => ReactNode |  |  | custom inner layout; receives content, resolved settings + dismiss callback; no injected fallback control |

## Do
- Short messages, a few words: "Changes saved", "Message sent".
- Short Undo action in endContent for reversible ops; set isAutoHide false when it must remain available.
- uniqueID to dedup repeated action toasts.
- Error type for failures needing attention; persists until dismissed.

## Do not
- Don't use for critical blocking errors. Use Banner for persistent in-context messaging.
- Don't put long/multi-line content; disappears in 5s, user may not finish reading.
- Don't show form validation errors. Use inline field validation instead.
