# useAnnounce
Category: accessibility.
Import: import { useAnnounce } from '@astryxdesign/core';

Imperative screen-reader announcements via a visually-hidden live region: the page-body one, or one inside the open Astryx modal the caller is rendered in (a native modal hides the body region). Polite + assertive regions created empty on first use + kept mounted, so announcements are reliable (most AT ignore a live region inserted together w/ its content). Messages auto-clear after ~2s.

## Do
- Use instead of hand-rolled aria-live div; region rendered w/ its content usually does not announce.
- "polite" for status / counts; "assertive" only for errors + time-sensitive alerts (it interrupts).
- Announce outcome, not interaction; "12 results", not "search ran".
- Changing value (result count while typing): own useAnnounce({hasReplace: true}) instance, so faster-than-a-frame input says only the latest.

## Do not
- Announce content already visible + labeled in DOM; doubles up for AT users.

## See also
- VisuallyHidden
- Toast
- useClipboard
