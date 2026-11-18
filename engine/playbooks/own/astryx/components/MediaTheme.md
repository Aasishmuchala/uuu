# MediaTheme
Group: Utilities. Category: Utility.
Import: import { MediaTheme } from '@astryxdesign/core';

Provides token overrides for content rendered on inverted surfaces: media overlays, scrims, toasts, and tooltips. The base behavior flips color-scheme so all light-dark() tokens resolve to the correct side. Only a small set of tokens need explicit overrides beyond that. Themes can further customize component appearance on media surfaces via onDark/onLight in defineTheme(), with both token overrides (e.g. "--color-accent": "#90CAF9") and component overrides (e.g. ghost buttons get a border on dark surfaces).

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| mode | 'dark' \| 'light' \| 'auto' \| 'off' |  | yes | surface luminance context: dark for content over dark backgrounds (light text, white-tinted interactions), light for content over light backgrounds (dark text, black-tinted interactions), auto to decide from painted surface (none if ambient text already reads at 3:1, else better-reading side), off to turn off explicitly (element still renders, so children never remount) |
| fallback | 'dark' \| 'light' | 'dark' |  | side auto uses when surface is unmeasurable (SSR, first frame, background-image, which needs useImageMode sampling); ignored unless mode is auto |
| children | ReactNode |  | yes | Content to render with inverted token context. Components inherit the correct colors automatically. |

## Do
- Use for any content over dark background (image overlays, video scrims, dark cards) or other inverted surfaces like toasts/tooltips.
- Prefer mode="auto" when surface color comes from a theme token; a token named "inverted" is not guaranteed to be; auto measures what was painted.
- Pair w/ background color: MediaTheme flips token context but does NOT add background. Set backgroundColor on parent element.
- Themes can customize components on media surfaces via onDark.components + onLight.components in defineTheme(). E.g. add border to ghost buttons on dark surfaces.

## Do not
- Use MediaTheme for app-level dark mode: use Theme w/ mode="dark"/mode="system" instead. MediaTheme is for local surface inversions, not page-wide color scheme.
