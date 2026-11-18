# Avatar
Group: Avatar. Category: Content.
Import: import { Avatar } from '@astryxdesign/core';

person/team avatar w/ photo → initials → icon fallback chain

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| src | string |  |  | primary image source URL |
| fallbackSrc | string |  |  | fallback image when primary fails |
| name | string |  |  | user name for initials and alt text |
| alt | string |  |  | alt text; falls back to name |
| size | 'xsm' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| 16 \| 20 \| 24 \| 32 \| 36 \| 40 \| 48 \| 60 \| 64 \| 72 \| 96 \| 128 \| 144 \| 180 | 'md' |  | named sizes: 'xsm' 20px, 'sm' 24px, 'md' 36px, 'lg' 48px, 'xl' 128px; numeric px restricted to values listed in the type. AvatarGroup's size always wins, default included. |
| shape | 'circle' \| 'rounded' \| 'square' | 'circle' |  | Shape variant of the avatar. 'circle' (default) stays fully round. 'rounded' uses the element radius token so it matches UI corner rounding and can be set globally via theme. 'square' has no radius. Status dot positioning adapts automatically: 4-o'clock on circle, bottom-right corner on rounded/square. |
| status | ReactNode |  |  | corner content for status indicators; AvatarStatusDot reports its `label`, composed into the avatar accessible name ("Jane Doe, Online"), at any nesting depth |
| tooltip | string \| boolean | true |  | hover/focus tooltip. true/omitted → name; string → that text; false → none. Owns its tooltip; set false when wrapping in your own Tooltip/HoverCard. Default true. |
| href | string |  |  | renders avatar as a link (<a>/custom). Needs alt/name for an accessible name; warns in development without one. Button-style element swap. |
| as | ElementType |  |  | custom link component for href (e.g. Next Link). Only with href. |
| target | string |  |  | link target. Only with href. |
| rel | string |  |  | link rel. Only with href. |
| onClick | (e: MouseEvent) => void |  |  | click handler → renders <button> when no href. Needs alt/name; warns in development without one. |

## Do
- Always pass a name for initials fallback and screen reader alt text.
- Match size to context: xsm/sm inline, md/lg in lists, xl for profiles.
- Add a status dot in chat or team views where availability matters.
- When wrapping Avatar in your own Tooltip or HoverCard, set tooltip={false} so the built-in name tooltip does not overlap yours.
- Interactive avatars (href/onClick) need name or alt; without one they warn in development.

## Do not
- Rely on a status label to name an interactive avatar. "Online" says nothing about where the link goes.
- Use for logos or product images. Use an image or icon instead.
- Force a square or custom shape. Avatars are always circular.

## Parts
- AvatarStatusDot
