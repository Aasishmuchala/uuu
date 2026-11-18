# useContainerReveal
Category: interaction.
Import: import { useContainerReveal } from '@astryxdesign/core';

Headless hover/focus reveal primitive. Gives a container a scoped trigger that reveals (or conceals) content inside it on hover / keyboard focus: the "row actions appear on hover" pattern. CSS-only: no hover state in React, no re-render on hover. Caller authors no StyleX; hook hands out container + content styles; a nested container shadows its ancestor, so nested containers never leak hover/focus. Accessible: revealed content visually hidden at rest via position + opacity (never display:none), stays mounted + in tab order + announced; reveals on :focus-within, stays visible under a coarse primary pointer, honors prefers-reduced-motion.

## Do
- Destructure getContainerProps + getContentRevealProps; spread getContainerProps() on container (via mergeProps w/ your stylex.props) + getContentRevealProps() on content to reveal.
- Use for secondary affordances: reveal-on-hover row actions (edit/copy/remove on list / table rows) + overlay controls on card / media tile (e.g. Thumbnail remove button).
- Gate reveal w/ isEnabled when a consumer prop decides revealed-on-hover vs always shown; can change at any time.
- Pass isLayoutPreserved for absolutely-positioned / overlay content to reserve its box + avoid layout shift.
- Set hoverDelay (100-250ms) on rows in a long list so a travelling cursor does not light up every row; keyboard + touch still reveal immediately.
- forceState when something else owns the interaction (drag, scroll / motion gate, open row menu); forceVisibility when one element should ignore the container.

## Do not
- Reach past the API into private custom properties (--_reveal-opacity etc) to suppress a reveal; use forceState / forceVisibility.
- Use to hide content that must always be discoverable; keep essential actions visible instead of gating behind hover.

## See also
- Thumbnail
- useClickableContainer
