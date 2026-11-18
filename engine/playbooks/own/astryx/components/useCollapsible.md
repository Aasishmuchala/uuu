# useCollapsible
Group: Collapsible. Category: interaction.
Import: import { useCollapsible } from '@astryxdesign/core';

Encapsulates collapsible state machine. 3 modes: group-controlled (inside CollapsibleGroup), controlled (isOpen + onOpenChange), uncontrolled (self-managed w/ defaultIsOpen). Used internally by Card + Section.

## Do
- Use directly when building custom collapsible components needing Astryx collapsible behavior w/o Collapsible wrapper.
- For accordion behavior, wrap items in CollapsibleGroup + pass unique value props.

## Do not
- Pass local open state or callbacks expecting them to run for a value-bound group item; the group owns state + notifications.
- Implement your own open/close state when useCollapsible already provides it; hook handles group coordination automatically.

## See also
- Collapsible
- Card
- Section
