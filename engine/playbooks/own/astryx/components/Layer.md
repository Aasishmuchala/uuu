# Layer
Group: Utilities. Category: Utility.
Import: import { Layer } from '@astryxdesign/core';

Layer utilities provide the app-level provider used by overlay systems. Use LayerProvider at the app root for toast/layer configuration; use higher-level Popover, HoverCard, or Tooltip APIs for most overlay UI. Rendered layer content, not the provider’s application subtree, uses theme body text defaults and exits ancestor surface/group membership. Establish intentional groups and complete required providers inside each layer. Every anchored layer keeps a gutter from each viewport edge — the spacing-4 step or the device safe-area inset, whichever is larger — and is capped to the viewport, never to the room beside its trigger: an explicit width renders at its size, flips when it does not fit beside the trigger, and slides into view when it fits on neither side. An app that floats a persistent bar over a viewport edge declares it once as inset on LayerProvider (blockStart, blockEnd, inlineStart, inlineEnd); each edge adds to that edge’s gutter for every anchored layer and moves the toast viewport by the same amount, and defaults to zero. The inset is app configuration, not a theme value.

## Do
- Declare a persistent bar floating over the viewport once, as inset on LayerProvider; every anchored layer and toast then stays clear of it.
- Use LayerProvider once near the app root when you need shared toast/layer configuration.
- Build on higher-level components like Popover, HoverCard, and Tooltip for common overlay patterns.

## Do not
- Nest a LayerProvider to change toast settings: a nested provider keeps the outer toast configuration and mounts no second toast viewport.

## Parts
- LayerProvider
