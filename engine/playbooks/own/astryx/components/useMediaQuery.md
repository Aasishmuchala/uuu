# useMediaQuery
Category: media.
Import: import { useMediaQuery } from '@astryxdesign/core';

SSR-safe media query hook subscribing to window.matchMedia changes. Returns whether given media query matches. Always returns false on first render for SSR compatibility.

## Do
- Use for responsive layout switching based on viewport width, color scheme, or motion preferences.
- Prefer Astryx responsive tokens + component props over manual breakpoint logic when possible.

## Do not
- Use for server-rendered content that must match on first paint; hook always returns false initially.

## See also
- useImageMode
