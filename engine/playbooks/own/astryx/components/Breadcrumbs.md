# Breadcrumbs
Group: Breadcrumbs. Category: Navigation.
Import: import { Breadcrumbs } from '@astryxdesign/core';

link trail from root to current page for wayfinding

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | BreadcrumbItem elements to render inside the breadcrumb trail. |
| separator | ReactNode | '/' |  | Separator rendered between breadcrumb items. The built-in slash mirrors automatically in RTL. |
| variant | 'default' \| 'supporting' | 'default' |  | Visual variant: supporting is smaller with secondary text styling. |
| label | string | 'Breadcrumb' |  | Accessible label for the nav landmark (aria-label). |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Do
- Place above the page heading so user sees location before reading content.
- Keep labels short + matching page titles they link to: "Settings" not "Application Settings Page".
- Use supporting variant in dense UIs where the breadcrumb should be subtle.
- Last item plain text, not a link; represents current page; done automatically when you set isCurrent.
- Implements APG Breadcrumb: labelled nav landmark + ol + aria-current="page". A menu crumb also implements APG Menu Button (Enter/Space/ArrowDown to open, Escape to close).
- Give each trail its own label when a page renders more than one.
- Built-in / mirrors automatically in RTL. Leave bidi-mirrored › alone; mirror custom arrows and Icons once.

## Do not
- Use as primary navigation; breadcrumbs supplement, not replace, a main nav.
- Show on top-level pages with no parent.
- Let the trail exceed 5 levels; simplify the hierarchy instead.
- Mirror a separator that already mirrors itself: › is Bidi_Mirrored and flips under RTL on its own. → and Icon separators are not, so those need rtlStyles.mirror via xstyle.

## Parts
- BreadcrumbItem
