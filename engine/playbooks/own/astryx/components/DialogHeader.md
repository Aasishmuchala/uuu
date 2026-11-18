# DialogHeader
Import: import { DialogHeader } from '@astryxdesign/core';

dialog header w/ title, optional subtitle, close button, start/end content slots

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | ReactNode |  |  | dialog title node inside focusable h2 (focused on open; text content labels dialog via aria-labelledby); inline, non-interactive, non-empty |
| subtitle | ReactNode |  |  | subtitle node below title; inline content ok (e.g. Link), no block elements |
| onOpenChange | (isOpen: boolean) => unknown |  |  | close button callback (omit=no button) |
| startContent | ReactNode |  |  | content before title (e.g. back button) |
| endContent | ReactNode |  |  | content after title, before close button |
| endContentEdgeCompensation | 'inline' \| 'block' \| 'all' |  |  | end-content slot axes: inline \| block \| all; omit=automatic close-action compensation |
| hasDivider | boolean | true |  | bottom border |

## Example
```jsx
import {DialogHeader} from '@astryxdesign/core/Dialog';

<DialogHeader title="Delete file?" subtitle="This action cannot be undone." />;
```
