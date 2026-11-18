# Thumbnail
Category: Content.
Import: import { Thumbnail } from '@astryxdesign/core';

Square preview card for image attachments. Skeleton shimmer on upload, image on success, placeholder when no src.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| src | string |  |  | Image source URL. |
| alt | string |  |  | Alt text for image. Omitted → explicitly decorative (alt="" + role="presentation" + aria-hidden); dev warn when src set with no alt and no label. |
| label | string |  |  | Accessible label (file name). Tooltip on hover, aria-label. |
| onRemove | (e: React.MouseEvent) => void |  |  | (e) => void. Overlaid remove button callback. |
| onClick | (e: React.MouseEvent) => void |  |  | (e) => void. Adds button semantics + hover overlay. |
| isLoading | boolean | false |  | Skeleton (no src) or upload overlay (with src). Default: false. |
| isDisabled | boolean | false |  | Disabled state. Default: false. |
| showRemoveOn | 'always' \| 'hover' | 'hover' |  | When remove button shows: hover (default: reveal on hover/focus, stays visible under coarse primary pointer, e.g. phone/tablet) \| always. Only when onRemove set. |
| xstyle | StyleXStyles |  |  | stylex.create() for layout. |
| className | string |  |  | CSS class. Prefer xstyle. |
| style | CSSProperties |  |  | Inline styles. Prefer xstyle. |
| data-testid | string |  |  | Test selector. |

## Do
- Always set label (file name) for a11y; powers screen reader announce + hover tooltip.
- isLoading w/o src → skeleton; isLoading w/ src → spinner overlay. Two distinct loading states.
- onClick adds button semantics + hover overlay; pair with lightbox for full preview.

## Do not
- Don't use for non-image files (PDF, xlsx); use file attachment component with icon instead.
- Don't omit alt when src present; screen readers need image content description, not just label.
