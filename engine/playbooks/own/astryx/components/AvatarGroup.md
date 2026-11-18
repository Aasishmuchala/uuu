# AvatarGroup
Group: Avatar. Category: Content.
Import: import { AvatarGroup } from '@astryxdesign/core';

compositional overlapping avatar row w/ +N overflow or custom slot

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | Avatar children, optionally followed by one AvatarGroupOverflow. Consumers handle slicing to the desired visible count. |
| size | 'xsm' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| 16 \| 20 \| 24 \| 32 \| 36 \| 40 \| 48 \| 60 \| 64 \| 72 \| 96 \| 128 \| 144 \| 180 | 'md' |  | Size applied to all avatars: named sizes are 'xsm' (20px), 'sm' (24px), 'md' (36px), 'lg' (48px), and 'xl' (128px); numeric sizes must be one of the pixel values listed in the type. The group's size always overrides each child Avatar's size, including when the group uses its default size. |
| shape | 'circle' \| 'rounded' \| 'square' | 'circle' |  | Shape applied to all avatars via context, overriding each avatar's own shape prop. Also applied to AvatarGroupOverflow's "+N" indicator. |
| ref | React.Ref<HTMLDivElement> |  |  | Ref forwarded to the root element. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. |
| data-testid | string |  |  | Test selector for automated testing frameworks. |

## Do
- Slice the list yourself; pass only visible avatars (3-5 typical). No auto-slicing.
- Use AvatarGroupOverflow for custom overflow (popover, add button).
- Pass status dots / click handlers directly on each Avatar.
- Avatars may be wrapped in HoverCard/Tooltip; overlap kept. Set tooltip={false} on the wrapped Avatar.
- Interactive avatars (href/onClick) share one Tab stop; arrows rove between them + the overflow button (APG roving tabindex).

## Do not
- Don't nest AvatarGroups.
- Don't set size on children; the group's size always wins, default included.

## Parts
- AvatarGroupOverflow
