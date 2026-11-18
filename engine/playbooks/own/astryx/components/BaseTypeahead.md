# BaseTypeahead
Import: import { BaseTypeahead } from '@astryxdesign/core';

Composable combobox engine providing a bare input and a styled result dropdown. Callers own input chrome and selected-value presentation.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| searchSource | SearchSource<T> |  | yes | Data source w/ search+bootstrap methods. |
| value | T \| null |  | yes | Currently selected item. |
| onChange | (item: T \| null) => void |  | yes | Fired on selection change. |
| renderItem | (item: T) => ReactNode |  |  | Custom dropdown item render. |
| placeholder | string | 'Search…' |  | Input placeholder. |
| hasEntriesOnFocus | boolean | false |  | Bootstrap results on focus. |
| maxMenuItems | number | 10 |  | Max dropdown items. |
| menuWidth | number |  |  | Requested px width before viewport clamping. |
| minQueryLength | number | 1 |  | Min query length before searching. Menu stays closed below it. |
| emptySearchText | ReactNode | 'No results found' |  | Content when the query matched nothing. ReactNode. |
| isDisabled | boolean | false |  | Whether input disabled. |
| isFocusableDisabled | boolean | false |  | Keeps disabled input focusable; blocks text entry, opening and picking, also from an already-open list (Escape/Tab close it). |
| hasAutoFocus | boolean | false |  | Auto-focus on mount. |
| debounceMs | number | 150 |  | Search debounce ms. 0 for sync. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Dropdown option padding size. |
| anchorRef | RefObject<HTMLElement \| null> |  |  | Anchor for dropdown positioning. Defaults to input. |
| inputXStyle | StyleXStyles |  |  | Additional StyleX styles for input. |
| xstyle | StyleXStyles |  |  | Standard BaseProps StyleX styles for input. |
| inputTabIndex | number |  |  | Legacy tabIndex alias; defined alias wins, otherwise native tabIndex passes through. |
| onKeyDown | (e: React.KeyboardEvent<HTMLInputElement>) => void |  |  | Keydown before internal nav. preventDefault() skips internal handling. |
| onChangeQuery | (query: string) => void |  |  | Fired on query text change. |
| onOpenChange | (isOpen: boolean) => void |  |  | Fired on dropdown open/close. |
| menu | BaseTypeaheadMenu |  |  | Menu content: {role:'listbox', render?({listbox,query,isBusy,isEmptySearch,close})} (info around the list; actions stay results) \| {role:'dialog', label, render({query,close})} (takes focus; close returns focus to opener, else input). Astryx owns the layer. open() from onChange keeps it open across a role switch. |
| handleRef | React.Ref<BaseTypeaheadHandle> |  |  | Handle: open(), close(). No controlled isOpen; onOpenChange reports. |
| inputId | string |  |  | Legacy id alias; defined alias wins, otherwise native id passes through. |
| ariaDescribedBy | string |  |  | Legacy aria-describedby alias; defined alias wins, otherwise native attribute passes through. |
| ariaLabelledBy | string |  |  | Legacy aria-labelledby alias; defined alias wins, otherwise native attribute passes through. |

## Do
- Use Typeahead or Tokenizer for standard fields; they add the input chrome and selected-value rendering BaseTypeahead omits.
- Provide a visible label or aria-label plus a custom wrapper with focus treatment, border, and layout.
- Pass anchorRef to your wrapper so the dropdown positions against your input chrome, not the bare input.

## Do not
- Expect input chrome or selected-value rendering. The caller owns those visible parts.
- Use BaseTypeahead when Typeahead or Tokenizer suffice; extra work only pays off for custom compositions.
- Treat Escape as pending-work cancellation. It hides the popup, but a late response can reopen it.
