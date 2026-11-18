# LinkProvider
Group: Utilities. Category: Utility.
Import: import { LinkProvider } from '@astryxdesign/core';

Wraps app to replace default <a> tag w/ framework-specific link component (e.g. Next.js Link) for client-side routing across all Astryx components.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| component | LinkComponentType |  | yes | link component for all link elements in subtree (e.g. Next.js Link). Accepted href/to follow the Link href rule; structured fields including protocol are checked, preserving identity. Either rejected => inert content, no router invocation or fallback. |
| children | ReactNode |  | yes | Subtree; links rendered through useLinkComponent (Link, Button w/ href) use component unless they set `as` or a nearer provider applies; a disabled Link does not. |
