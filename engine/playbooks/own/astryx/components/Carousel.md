# Carousel
Category: Container.
Import: import { Carousel } from '@astryxdesign/core';

horizontal scroll container w/ fade edges, nav buttons, scroll-snap

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | carousel items in horizontal scroll |
| gap | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 | 1 |  | item spacing via spacing token scale |
| hasButtons | boolean | true |  | prev/next buttons when content is scrollable |
| hasEdgeFade | boolean | true |  | gradient edge-fade mask on overflow |
| hasLoop | boolean | false |  | wrap-around: next at end -> start, prev at start -> end; buttons stay visible; only when overflowing |
| hasSnap | boolean \| SnapPaging | false |  | scroll-snap; children snap to start edge. hasSnap={useSnapPaging()}: iOS paging under a finger or trackpad swipe, one view per flick ({pages: 'item'}: one item); only that value loads the pager |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | inline padding; scroll-padding keeps snap points on content edge |
| aria-label | string | 'Carousel' |  | accessible label for carousel region |
| ref | React.Ref<HTMLDivElement> |  |  | Ref forwarded to the root element. |
| handleRef | React.Ref<CarouselHandle> |  |  | imperative handle: scrollNext/scrollPrev/scrollTo(index)/canScrollNext/canScrollPrev |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value. |
| className | string |  |  | CSS class name for the root element. Prefer xstyle for styling. |
| style | CSSProperties |  |  | Inline styles for the root element. Prefer xstyle. |
| data-testid | string |  |  | test selector for automated testing frameworks |

## Do
- Enable scroll-snap when each item should land precisely at the start edge, like a gallery or product list.
- For iOS paging under a finger and on a trackpad swipe, pass hasSnap={useSnapPaging()} from @astryxdesign/core/SnapPaging. A flick moves one view, or one item with useSnapPaging({pages: 'item'}). A mouse wheel keeps native snapping. Only a carousel given it loads the paging code.
- Reach for hasLoop on small, cyclable sets like a photo gallery, where wrapping past the last item back to the first feels natural.
- Always provide an aria-label that describes what the carousel contains, like "Featured products" or "Team members".
- Carousel implements the WAI-ARIA APG carousel pattern ([address left out] without auto-rotation: the region is labelled and carries aria-roledescription="carousel", each item is a group named "Slide N of M", and the scroll container is a tab stop while its content overflows, so keyboard users can pan it with the arrow keys; while everything fits it stays out of the tab order.
- Use a consistent gap and item width so the carousel looks intentional, not like content overflowing by accident.
- Trust the built-in navigation: trackpad users can swipe horizontally, and mouse users can hold Shift while scrolling the wheel to move through items.

## Do not
- Use a carousel for content every user must see. Not everyone scrolls horizontally, so put critical content above the fold.
- Auto-advance items. Let the user scroll at their own pace.
- Nest carousels. A carousel inside a carousel is confusing and breaks keyboard navigation.
