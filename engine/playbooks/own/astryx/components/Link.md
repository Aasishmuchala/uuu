# Link
Category: Action.
Import: import { Link } from '@astryxdesign/core';

Styled anchor links w/ multiple variants + polymorphic link infra for custom link components (Next.js Link, React Router Link, etc.).

## Do
- Write descriptive, concise link text that clearly communicates the destination.
- Set `isStandalone` when the link appears outside of inline text, so it receives proper base font sizing.
- Put a Link inside a <Text maxLines> to truncate it with the surrounding text; inside a clamped Text the link flows in the text's lines.
- Only set `label` when the link content is not descriptive text (e.g. an icon-only link). For text links, the visible text is already the accessible name; adding `label` overrides it for screen readers, which is harmful.

## Do not
- Use Link for actions that do not navigate; use a Button instead.
- Use generic text like "click here" or "read more"; describe the destination.
- Set `label` on text links; `aria-label` prevents assistive technology from reading the actual link content.
- Give a Link inside a clamped Text its own `display` or `maxLines`, or render it as a button (`onClick` with no `href`), and expect the outer clamp to cut it; that Link keeps its own box.
- Put a Link with block-level content, such as an HStack with an icon, inside a clamped Text; block content breaks the clamp. Clamp a text-only Link, or place the composed Link outside the clamp.

## Parts
- Link
- LinkProvider
