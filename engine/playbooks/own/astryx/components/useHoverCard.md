# useHoverCard
Group: HoverCard. Category: interaction.
Import: import { useHoverCard } from '@astryxdesign/core';

Headless hover-triggered floating cards. Builds on useLayer w/ hover/focus intent, delays, safe hover behavior, aria-describedby. Use for rich previews when trigger/content rendering needs full control.

## Do
- Use for rich previews: profiles, entity summaries, link previews.
- Prefer HoverCard for standard trigger-content pairs; use hook for custom trigger patterns.

## Do not
- Use for simple text hints: use Tooltip / useTooltip instead.

## See also
- HoverCard
- Tooltip
- Popover
- useLayer
- useTooltip
- usePopover
