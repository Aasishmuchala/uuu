# Lightbox
Category: Overlay.
Import: import { Lightbox } from '@astryxdesign/core';

Fullscreen overlay for viewing images and videos at full resolution with gallery navigation and zoom.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isOpen | boolean |  | yes | Whether the lightbox is open. |
| onOpenChange | (isOpen: boolean) => void |  | yes | Callback when open state changes (including a photo dragged down). |
| media | LightboxMedia \| LightboxMedia[] |  | yes | Single media object or array for gallery mode. |
| index | number |  |  | Current index in gallery mode. |
| onIndexChange | (index: number) => void |  |  | Callback when gallery index changes (buttons, keys or a swipe). |
| hasZoom | boolean | false |  | Enable zoom (pinch or ctrl-wheel, double-tap or double-click, Enter/Space, or +/-; 0 resets) and pan (drag, trackpad scroll, or arrow keys) for images. |
| defaultIndex | number | 0 |  | Initial image index in gallery mode for uncontrolled usage. |
| hasAutoPlay | boolean | false |  | Automatically start video playback when a video media item is shown. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. |

## Do
- Always provide alt text for every image.
- Use gallery mode with onIndexChange for multi-image sets.
- Enable hasZoom only when viewing high-resolution images that benefit from close inspection.

## Do not
- Use for content other than images and videos; one media item at a time.
- Nest interactive content inside captions; keep them plain text.
