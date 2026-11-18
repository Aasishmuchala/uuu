# useLayer
Group: Utilities. Category: interaction.
Import: import { useLayer } from '@astryxdesign/core';

Core positioning hook for overlay content via CSS Anchor Positioning + Popover API. Foundation for custom popovers, hover cards, tooltips, fixed-position layers. Both modes use theme body defaults and end ancestor surface/group membership as a whole. Explicit props and unrelated contexts remain unchanged; establish intentional groups and complete required providers inside the rendered layer.

## Do
- Use context mode for trigger-anchored overlays; fixed mode for explicit coordinates.
- Build on Popover/HoverCard/Tooltip for common overlay patterns.
- Rely on the Popover API top layer to escape clipping/stacking; host the layer near its trigger (not in the body) to inherit the trigger theme cascade and natural focus order.

## Do not
- Implement ARIA directly in Layer unless you own full accessibility behavior.

## See also
- LayerProvider
- Popover
- HoverCard
- Tooltip
- usePopover
- useHoverCard
- useTooltip
