# useSnapPaging
Group: Carousel. Category: motion & gestures.
Import: import { useSnapPaging } from '@astryxdesign/core';

iOS paging for Carousel on native snap's stops: hasSnap={useSnapPaging()}. Finger or trackpad swipe: one view per flick ({pages: 'item'}: one item); mouse wheel keeps native snap. Only that carousel loads the pager.

## Do
- Use for rows read one view at a time (onboarding, photo strip).
- {pages: 'item'} when several items show and a flick should move one.

## Do not
- Use for rows scanned quickly; plain hasSnap keeps native momentum.

## See also
- Carousel
