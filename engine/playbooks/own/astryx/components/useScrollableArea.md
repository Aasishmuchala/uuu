# useScrollableArea
Category: layout.
Import: import { useScrollableArea } from '@astryxdesign/core';

Composes logical-axis scrolling into caller-owned viewport/content elements with stable effective-axis and edge state.

## Do
- Pass already-resolved props and refs through both prop getters, then spread each returned object once.
- Use viewport keyboard ownership only when the viewport itself should enter the tab order; provide a concise accessible label.
- Use contentOrViewport to delegate forward Tab entry to the first sequential native link or button when it preserves native scroll keys. Inputs, composite widgets, and nested scroll areas retain the named viewport stop. Shift+Tab from the delegated first child skips the viewport; pointer and programmatic focus stay on it.
- Use content keyboard ownership when your integration already supplies keyboard access to the full scroll range. Automatic delegation checks current content at each keyboard entry without continuously tracking its focusability.
- Pass caller `xstyle` through `getViewportProps`; the getter composes it with fitting clip, active overflow, and Sticky containment.
- Give a viewport-owned tab stop a visible focus indicator; compose `focusOutlineStyles.focusVisible` (or an equivalent) into the viewport `xstyle`, as ScrollableArea does.

## Do not
- Attach only the viewport getter. A real observed content box is required for live overflow changes.
- Declare overflow through caller props on the viewport; the getter owns overflow declarations and strips conflicting inline values.

## See also
- ScrollableArea
- useScrollOverflow
