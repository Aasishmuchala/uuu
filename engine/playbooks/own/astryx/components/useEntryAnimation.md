# useEntryAnimation
Category: motion & gestures.
Import: import { useEntryAnimation } from '@astryxdesign/core';

Returns StyleX style for animating element on mount. Only animates when element dynamically inserted after initial page paint; elements rendered on page load not animated. Uses Astryx motion tokens (duration, easing) for consistent timing. Server-rendered elements hydrate without entry style, never animate; elements mounted after hydration animate.

## Do
- Use for conditionally rendered elements like validation messages, toasts, expanding sections.
- Spread returned style into stylex.props() alongside other styles.

## Do not
- Use for elements that should be visible on initial page load; they will not animate.

## See also
- FieldStatus
