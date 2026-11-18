# HoverCard
Group: HoverCard. Category: Overlay.
Import: import { HoverCard } from '@astryxdesign/core';

Hover/focus triggered overlay for displaying rich, interactive content anchored to trigger element.

## Do
- Keep content supplementary; hover cards should enhance understanding without blocking the primary workflow.
- Provide a dashed underline on text triggers so users know the element is hoverable.
- Use the hook API (useHoverCard) when you need more control over timing or placement.
- Leave touchTrigger on auto so a tap opens the card on triggers that do nothing else, and stays out of the way on triggers that perform an action.
- Prefer a block context over a direct <p>, heading, or link placement. Those placements work when necessary through a corrective portal, but DOM/tab order may differ.

## Do not
- Place critical actions or required information inside a hover card; users may miss content that only appears on hover.
- Use a hover card when a simple Tooltip or Popover would suffice.
- Use a HoverCard for content the user must interact with; it disappears when the cursor leaves.
- Put the trigger inside SVG <foreignObject>: Chromium cannot anchor to it, so the card opens at the viewport corner. Use an HTML trigger positioned over the SVG node.

## Parts
- HoverCard
