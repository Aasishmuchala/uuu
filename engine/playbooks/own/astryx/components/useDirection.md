# useDirection
Category: utilities.
Import: import { useDirection } from '@astryxdesign/core';

Returns the current text direction ('ltr' or 'rtl') during render. Render-time last resort: prefer CSS logical properties first.

## Do
- Prefer CSS logical properties before using useDirection.
- Use for HTML canvas rendering where time/value axes start from the logical inline start edge.

## Do not
- Use to conditionally swap styles that CSS logical properties solve directly.

## See also
- InternationalizationProvider
- useLocale
- useTranslator
