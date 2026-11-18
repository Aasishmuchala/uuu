# CommandPalette
Group: CommandPalette. Category: Overlay.
Import: import { CommandPalette } from '@astryxdesign/core';

searchSource-driven command palette dialog; filtering, keyboard nav, grouping, selection; same SearchSource interface as Typeahead

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isOpen | boolean |  | yes | Whether the command palette dialog is visible. |
| onOpenChange | (isOpen: boolean) => void |  | yes | Called when the palette visibility changes. |
| searchSource | SearchSource<T> |  | yes | Search source providing items via search(query) and bootstrap(). Use createStaticSource for static lists. |
| input | ReactNode | <CommandPaletteInput /> |  | Input slot. Defaults to CommandPaletteInput with standard behavior. |
| footer | ReactNode | <CommandPaletteFooter /> |  | Footer slot. Defaults to CommandPaletteFooter showing keyboard hints. |
| renderItem | (item: T, isSelected: boolean) => ReactNode |  |  | Per-item render function for non-interactive presentation content such as labels, icons, descriptions, and shortcut hints. Do not return buttons or links inside the option. Auto-grouping by auxiliaryData.group is preserved. When omitted, renders label text. |
| emptySearchText | ReactNode | 'No results' |  | Content shown when a search query returns no results. |
| emptyBootstrapText | ReactNode | 'Type to search' |  | Content shown when there is no search query and bootstrap() returns nothing. |
| value | string |  |  | Controlled selected value for picker mode. |
| onValueChange | (value: string) => void |  |  | Called when the selected value changes in picker mode. |
| label | string | 'Command palette' |  | Accessible label for the command palette dialog. |
| width | number \| string | 640 |  | Width of the dialog. |
| maxHeight | number \| string | 480 |  | Maximum height of the dialog. |
| isInline | boolean | false |  | Renders command palette content inline without modal behavior. Automatically disables input auto-focus and initial highlighted-item auto-scroll. For documentation previews and showcases only. |

## Do
- Provide a searchSource with bootstrap results so users see useful options before typing.
- Use auxiliaryData.group on items to automatically organize results into labeled sections.
- Provide a specific label when more than one command palette can appear in the same product surface.
- Keep renderItem content non-interactive; each rendered row is one option, so buttons and links cannot be nested inside it.

## Do not
- Intercept query-field keyboard events without preserving active IME composition and native Home/End caret movement.
- Use CommandPalette for simple dropdowns or menus; use Menu or Selector for inline selections.
- Add too many groups or items; curate results to keep the palette fast and scannable.

## Parts
- CommandPaletteInput
- CommandPaletteList
- CommandPaletteItem
- CommandPaletteGroup
- CommandPaletteFooter
- CommandPaletteEmpty
