# Collapsible
Group: Collapsible. Category: Container.
Import: import { Collapsible } from '@astryxdesign/core';

hide/reveal content behind a trigger; group for accordion behavior

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| trigger | ReactNode |  | yes | Content shown in the trigger area (always visible). |
| children | ReactNode |  |  | Content that collapses and expands. |
| defaultIsOpen | boolean | true |  | Default open state for standalone uncontrolled usage. Ignored when value binds the item to a surrounding CollapsibleGroup. |
| isOpen | boolean |  |  | Controlled open state for standalone usage. Ignored when value binds the item to a surrounding CollapsibleGroup. |
| isDisabled | boolean | false |  | Disable the item so its trigger can't be toggled (dimmed, aria-disabled, and out of the tab order). Doesn't collapse an already-open item. |
| onOpenChange | (isOpen: boolean) => void |  |  | Callback invoked when standalone open state changes. A surrounding CollapsibleGroup owns grouped state and calls its onChange instead. |
| chevronPosition | 'start' \| 'end' | 'end' |  | Logical position of Collapsible's disclosure chevron. `end` (default) follows the label, pointing down when collapsed and up when expanded. `start` precedes the label, pointing inward toward content when collapsed (mirrored under RTL) and down when expanded. Inside a CollapsibleGroup this defaults to the group's chevronPosition. |
| value | string |  |  | Identifier used for group coordination. When set inside a CollapsibleGroup, the group owns open state and its onChange is the notification callback. |
| animatedLayout | AnimatedLayout |  |  | The handle from useAnimatedLayout({containerRef}). With it, opening and closing glides the content after this Collapsible, up to that container, on one shared motion role instead of jumping, and the revealed content and the chevron move on the same motion. Without it, the content after it takes its place at once. |
| ref | React.Ref<HTMLDivElement> |  |  | Ref forwarded to the root collapsible element. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be a stylex.create() value. |
| className | string |  |  | CSS class name for the root element. Prefer xstyle for styling. |
| style | CSSProperties |  |  | Inline styles. Prefer xstyle for StyleX-optimized styling. |
| data-testid | string |  |  | Test selector for automated testing frameworks. |

## Do
- Give every trigger a meaningful accessible name; add VisuallyHidden text when custom visuals do not.
- Use hasDividers on CollapsibleGroup for FAQ-style lists: built-in row hairlines, no hand-rolled borders.
- Wrap each Collapsible in an Card for visual separation, or use CollapsibleGroup's hasDividers for flat lists; not both.
- Use CollapsibleGroup with type="single" for settings or FAQ pages where only one section should be open at a time.
- Use type="multiple" when users need to compare across sections.
- Start sections open (defaultIsOpen) when content is needed on first view.

## Do not
- Hide critical content behind a collapsible; users may not discover it.
- Nest collapsibles more than two levels deep; makes content hard to find and navigate.
- Use a collapsible for a single short paragraph; just show the text directly instead.

## Parts
- CollapsibleGroup
