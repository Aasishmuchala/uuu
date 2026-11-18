# useThemeName
Category: Utility.
Import: import { useThemeName } from '@astryxdesign/core';

The nearest theme name, or null when none is set. Lighter than useTheme.

## Do
- Use it when only the theme name is needed.
- Use useTheme for tokens or the color mode.

## Do not
- Treat null as a theme named default.

## See also
- Theme
- useTheme
