# DrawerHeader
Import: import { DrawerHeader } from '@astryxdesign/core';

drawer header w/ title, optional subtitle, close button, start/end content slots; same API as DialogHeader

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | ReactNode |  | yes | drawer title node, rendered as h2; inline, non-interactive; does not name the drawer |
| subtitle | ReactNode |  |  | subtitle node below title; inline content ok (e.g. Link), no block elements |
| onOpenChange | (isOpen: boolean) => unknown |  |  | close button callback, called with false (omit=no button); pass the Drawer's onOpenChange |
| startContent | ReactNode |  |  | content before title (e.g. back button) |
| endContent | ReactNode |  |  | content after title, before close button |
| endContentEdgeCompensation | 'inline' \| 'block' \| 'all' |  |  | end-content slot axes: inline \| block \| all; omit=automatic close-action compensation |
| hasDivider | boolean |  |  | bottom border; default = parent Layout defaultHasDividers |

## Example
```jsx
import {useState} from 'react';
import {Drawer, DrawerHeader} from '@astryxdesign/core/Drawer';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';

function Inspector() {
  const [isOpen, setIsOpen] = useState(true);

  // Passing onOpenChange renders a close button that calls it with false.
  return (
    <Drawer isOpen={isOpen} onOpenChange={setIsOpen} label="Details">
      <Layout
        header={<DrawerHeader title="Details" onOpenChange={setIsOpen} />}
        content={<LayoutContent>Content</LayoutContent>}
      />
    </Drawer>
  );
}
```
