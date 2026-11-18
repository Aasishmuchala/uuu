# Divider
Category: Layout.
Import: import { Divider } from '@astryxdesign/core';

visual separator w/ optional label, using Astryx design tokens

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| orientation | 'horizontal' \| 'vertical' | 'horizontal' |  | divider orientation |
| label | ReactNode |  |  | optional centered label; preserves 0; null/boolean/"" omit it |
| variant | 'subtle' \| 'strong' | 'subtle' |  | visual weight of divider line |
| isFullBleed | boolean | false |  | extend to container edges w/ negative margins |
| xstyle | StyleXStyles |  |  | StyleX styles for layout; must be stylex.create() value |

## Do
- Use subtle dividers between related content sections and strong dividers for high-contrast boundaries.
- Add a label to the divider when sections need a visible category heading.

## Do not
- Overuse dividers; rely on spacing and layout to separate content when possible.
