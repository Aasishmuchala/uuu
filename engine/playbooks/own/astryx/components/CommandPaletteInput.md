# CommandPaletteInput
Import: import { CommandPaletteInput } from '@astryxdesign/core';

search input; auto-focus on mount; wires to context inside CommandPalette

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| placeholder | string | 'Search…' |  | input placeholder text |
| label | string |  |  | accessible label for the query field; default "Search commands", never the placeholder |
| hasAutoFocus | boolean | true |  | auto-focus on mount; auto-disabled in inline mode |
| endContent | ReactNode |  |  | trailing content after spinner |
| value | string |  |  | search value; reads context when omitted inside palette |
| onValueChange | (value: string) => void |  |  | called on change; writes context when omitted inside palette |
| xstyle | StyleXStyles |  |  | StyleX layout styles; must be stylex.create() value |

## Do
- Pass a concise label that identifies what can be searched when "Search commands" does not describe it; the placeholder is never the field's name.
- Use endContent for short supporting controls or shortcut hints at the trailing edge.

## Do not
- Override combobox role or popup state. CommandPaletteInput owns those semantics when connected to CommandPalette.
