# useIcon
Group: Icon. Category: utilities.
Import: import { useIcon } from '@astryxdesign/core';

Resolves a semantic icon name to a React node via the nearest Theme, so custom components draw the same icons as Astryx components and follow theme overrides. Fallback: nearest Theme icons (outside any Theme, the root's registered theme), registerIcons() overrides, built-in default. Node returned as is (built-ins are 1em, currentColor). Function entries read at {size: 'md'}. Use <Icon icon={name} /> for another size, a color or a label.

## Do
- Use in custom components that place a semantic icon, so Theme overrides reach them.
- Render <Icon icon={name} /> for a non-md size, a color, or an accessible label.

## Do not
- Import a library glyph for a semantic purpose a theme should control (success, error).

## See also
- Icon
- Theme
- useTheme
