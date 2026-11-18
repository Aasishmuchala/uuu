# Theme
Group: Utilities. Category: Utility.
Import: import { Theme } from '@astryxdesign/core';

Wraps a subtree with a specific Astryx theme. For static production themes, use `astryx theme build` and import the generated CSS plus built theme object for first-paint and SSR performance. Use runtime `defineTheme()` when themes are dynamic or for prototyping. `defineTheme` accepts a `tokens` object whose keys are CSS custom property names (always prefixed with `--`). Common token names include `--color-accent`, `--color-background-surface`, `--color-background-body`, `--color-text-primary`, `--color-text-secondary`, `--radius-container`, `--spacing-1` through `--spacing-6`. Values can be a string (same for light/dark) or a `[light, dark]` tuple. Example: ```ts import {defineTheme} from '@astryxdesign/core/theme'; const myTheme = defineTheme({ name: 'ocean', tokens: { '--color-accent': ['#0077B6', '#48CAE4'], '--color-background-surface': ['#F0F8FF', '#0A1628'], '--color-text-primary': ['#0A1317', '#FFFFFF'], '--radius-container': '16px', }, }); ```

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| theme | DefinedTheme |  | yes | theme object to apply. Prefer built theme objects for static production themes; use runtime `defineTheme()` for dynamic themes. |
| mode | 'light' \| 'dark' \| 'system' | 'system' |  | color mode. System follows OS preference. defaults to "system" |
| children | ReactNode |  | yes | Content to render with the theme. |

## Do
- Build app themes known ahead of time w/ `astryx theme build`; import generated CSS + built theme object.
- Use runtime themes when theme is created/edited in browser, e.g. theme editor, user branding, prototype.
- Token names always start with `--` (e.g. `--color-accent`, `--color-background-surface`). Do not omit the prefix.

## Do not
- Default to runtime themes in SSR production apps. Component overrides inject after hydration instead of static CSS.
