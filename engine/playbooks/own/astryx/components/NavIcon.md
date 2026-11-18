# NavIcon
Group: Navigation. Category: Navigation.
Import: import { NavIcon } from '@astryxdesign/core';

Circular icon container w/ accent background for navigation headers.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| icon | ReactNode |  | yes | Icon element inside circular background. Should be Icon or similar. |

## Do
- Use in navigation headers to provide a recognizable visual anchor for the section.
- Pass an Icon or similarly sized icon component to ensure proper proportions.

## Do not
- Use NavIcon for interactive purposes; it is a display-only container, not a button.
