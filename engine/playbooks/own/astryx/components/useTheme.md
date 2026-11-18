# useTheme
Group: Utilities. Category: Utility.
Import: import { useTheme } from '@astryxdesign/core';

Programmatic access to theme tokens for SVG/canvas/charts needing JS values instead of CSS vars.

## Do
- Use tokens/token(name) for SVG/canvas/chart config theme colors in React.
- Use resolveThemeTokens(theme, {mode}) outside React hooks.
- Prefer CSS vars / StyleX tokens for ordinary styling; use hook when JS needs values.
- Use --color-data-* tokens for chart series.

## Do not
- Hardcode light/dark chart colors: resolve from current theme.
- Assume hook reflects arbitrary CSS cascade/media-surface overrides.

## See also
- Theme
- useMediaQuery
