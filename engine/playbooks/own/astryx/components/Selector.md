# Selector
Group: Selector. Category: Form Controls.
Import: import { Selector } from '@astryxdesign/core';

A dropdown selector for choosing a single value from a list of options. Supports labels, validation, descriptions, and required/optional states. Use it in forms and settings when presenting a moderate number of options. Keyboard typeahead matches a native select: typing on the focused closed trigger selects the matching option directly, repeated presses cycle through options sharing a first letter, and spaces count as match characters ("new y" reaches "New York"). With the menu open, typing moves the highlight and Enter commits. With hasSearch, typing on the closed trigger opens the popup and seeds the search input.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | Label text for accessibility. |
| options | SelectorOption[] |  | yes | Array of items: strings, objects with value/label/description/icon/disabled, dividers ({type: "divider"}), or sections ({type: "section", title, options}). |
| value | string |  |  | Currently selected value. |
| onChange | (value: string) => void |  |  | Callback fired when the selection changes. |
| hasClear | boolean | false |  | Shows a clear (×) button when a value is selected. When true, onChange also accepts null to signal the user cleared the selection. |
| hasSearch | boolean | false |  | Whether to show a search input for filtering options. As the user types, the match count (or "No results found") is announced to screen readers via a polite live region. The search field has built-in affordances: a leading magnifier icon and, once a query is typed, a trailing clear (✕) button that resets the query and returns focus to the input. |
| searchPlaceholder | string | 'Search...' |  | Placeholder text for the search input. |
| emptyText | ReactNode | 'No options' |  | Content shown in the dropdown panel when there are no options to show, and announced in a polite live region when the panel opens. The announcement is the text this content renders, read from the DOM, so an element is announced as written and aria-hidden parts are left out of both. Not shown while isLoading. |
| emptySearchText | ReactNode | 'No results found' |  | Content shown in the dropdown panel when a search query matches no options, and announced in a polite live region at the same time. The announcement is the text this content renders, read from the DOM, so an element is announced as written and aria-hidden parts are left out of both. |
| placeholder | string | 'Select...' |  | Placeholder text shown when no value is selected. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | Size variant for the selector. |
| variant | 'input' \| 'secondary' \| 'ghost' | 'input' |  | Visual trigger style. input is the bordered input treatment for forms; secondary matches the secondary buttons of the active theme (borderless and neutral-filled by default) for navs and toolbars; ghost is borderless and transparent, matching ghost buttons for toolbar usage. |
| isDisabled | boolean | false |  | Disables the selector. |
| isReadOnly | boolean | false |  | Makes the selector read-only: the selected value stays visible, focusable, and included in form submission, and retains its combobox identity with aria-readonly. The selection surface, clear action, and disclosure indicator are removed. Unlike isDisabled, the control is not dimmed. isDisabled takes precedence when both are set. |
| htmlName | string |  |  | The HTML name attribute for form submissions. Renders a hidden input carrying the selected value, like a native select. |
| disabledMessage | string |  |  | Explains why the selector is disabled. With isDisabled, shows the reason as a tooltip on hover and keyboard focus of the trigger, which stays focusable (aria-disabled) like every disabled selector; activation stays blocked. Use this instead of wrapping a disabled Selector in Tooltip. |
| isLabelHidden | boolean | false |  | Visually hides the label while keeping it accessible. |
| description | string |  |  | Helper text displayed below the label. |
| isOptional | boolean | false |  | Marks the field as optional. |
| isRequired | boolean | false |  | Marks the field as required. |
| status | {type: 'error' \| 'warning' \| 'success', message?: string} |  |  | Validation status with an optional message. |
| statusVariant | 'attached' \| 'detached' \| 'tooltip' | 'attached' for input selectors; 'detached' for secondary and ghost selectors |  | How the status message is placed relative to the input. attached overlaps directly below the bordered input and is only valid for the input variant; secondary and ghost selectors detach attached status messages by default. Use tooltip for compact toolbar controls. |
| renderOption | (option: SelectorOptionData) => ReactNode |  |  | Custom render function for each selectable option in the dropdown. Use this instead of JSX children; dividers and sections are rendered by the selector. |
| renderValue | (option: SelectorOptionData) => ReactNode |  |  | Custom render function for the selected option inside the closed trigger. A one-line value follows the active size token, including compact or wide spacing scales with icons or a clear control. Padding accommodates the trigger line box, and each extra line grows the control by one line (28/32/36 for one line and 48/52/56 for two with the default tokens). Content inherits the trigger line height; content that sets a larger font should set its own line height so the trigger grows to fit it. Inside an InputGroup the group owns the row height: a SelectorOption folds onto one line and ellipsizes, and any taller node is cut off at the row. |
| indicatorPosition | 'start' \| 'end' | 'end' |  | Which logical edge of the option row carries a rendered selection mark. An empty mark consumes no space, so selected and unselected labels may shift or have different available width. end is the house convention shared with Typeahead and CommandPalette. |
| presentation | 'popover' \| 'bottom-sheet' \| 'adaptive' | 'popover' |  | How the option list is presented. adaptive uses a bottom sheet on compact touch screens and an anchored popover otherwise. |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. Without a width the field follows its displayed value and can shrink with its row (the value truncates) instead of overflowing it; use `<HStack wrap="wrap">` for filter bars so selectors move to a second line on phones. |
| startIcon | IconType \| ReactNode |  |  | Icon displayed at the start of the selector trigger. |
| isLoading | boolean | false |  | Shows a loading spinner in the trigger. |
| onClick | (event: MouseEvent) => void |  |  | Click handler on the trigger button. Runs before the selector toggles its surface; preventDefault() does not keep it closed. |
| onFocus | (event: FocusEvent) => void |  |  | Focus handler on the trigger button. Runs before the selector's own focus handling. |
| onKeyDown | (event: KeyboardEvent) => void |  |  | Key handler on the trigger button. Runs after the built-in keyboard model and is skipped for keys it handles and cancels. |
| containerXstyle | StyleXStyles |  |  | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| containerClassName | string |  |  | Class name for the field container. Same targeting as `containerXstyle`. |
| containerStyle | CSSProperties |  |  | Inline styles for the field container. Same targeting as `containerXstyle`. |
| controlXstyle | StyleXStyles |  |  | StyleX styles for the visual control box: the element that paints the border and background and holds the value, icons, and end controls. Never the trigger button itself. |
| controlClassName | string |  |  | Class name for the visual control box. |
| controlStyle | CSSProperties |  |  | Inline styles for the visual control box. |

## Do
- Provide a visible label so users understand what they are selecting.
- Use sections and dividers to organize options when the list exceeds ~8 items.
- Use renderOption for custom option rows. Do not pass SelectorOption directly as JSX children.
- Set a meaningful placeholder that hints at the expected selection (e.g. "Choose a country" not "Select...").
- Use inside InputGroup only when the selector needs a short prefix or suffix addon as part of one decorated input surface.
- Use variant="secondary" when a selector sits in a nav or toolbar beside secondary buttons or a segmented control, so it shares their treatment instead of reading as a form field. Use variant="ghost" when a selector sits in a toolbar with ghost buttons. If validation status is needed there, prefer statusVariant="tooltip" so the toolbar height stays compact.
- Use presentation="adaptive" when the selector should become a bottom sheet on compact touch screens.

## Do not
- Use for action menus; use Dropdown Menu for triggering commands or navigation.
- Use when there are only two options; use a SegmentedControl or radio buttons instead.
- Use Selector for navigation; links should be links, not dropdown options.
- Use for yes/no or on/off choices; use Switch or CheckboxInput instead.
- Put more than ~20 options without sections; consider Typeahead for large lists.
- Wrap a disabled Selector in Tooltip to explain why it is disabled. Use the disabledMessage prop, which attaches the reason to the trigger itself.

## Parts
- SelectorOption
