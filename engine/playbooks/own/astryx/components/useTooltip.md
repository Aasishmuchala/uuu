# useTooltip
Group: Tooltip. Category: interaction.
Import: import { useTooltip } from '@astryxdesign/core';

Headless hover/focus tooltip hook. Builds on useLayer w/ hover intent, keyboard focus handling, aria-describedby. Use for custom triggers without wrapper component.

## Do
- Use for brief text labels describing icon buttons, truncated text, abbreviations, compact controls.
- Prefer Tooltip for standard wrapping; use hook when trigger is not simple child.
- Toggle-style trigger: own button calls show()/hide() per press, sets aria-describedby + aria-controls={describedBy}, aria-expanded (true while held), keeps its own name. Info icon: use InfoTip.

## Do not
- Put interactive content in tooltips: use Popover / HoverCard instead.

## See also
- Tooltip
- HoverCard
- Popover
- useLayer
- useHoverCard
- usePopover
