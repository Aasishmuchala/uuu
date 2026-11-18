# DateRangeInput
Group: DateInput. Category: Form Controls.
Import: import { DateRangeInput } from '@astryxdesign/core';

date range picker with dual-month calendar popover and preset ranges

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | label text |
| isLabelHidden | boolean | false |  | visually hide label |
| description | string |  |  | helper text below label |
| isOptional | boolean | false |  | show "(optional)" indicator |
| isRequired | boolean | false |  | mark field required |
| isDisabled | boolean | false |  | disable trigger+picker |
| disabledMessage | string |  |  | reason shown in a tooltip on hover/focus when disabled; describes the trigger |
| value | DateRange \| null |  | yes | selected range {start, end} or null; import DateRange type from @astryxdesign/core/DateRangeInput (do not redeclare) |
| onChange | (value: DateRange \| null) => void |  | yes | callback on range change; null on clear |
| changeAction | (value: DateRange \| null) => void \| Promise<void> |  |  | async action fired after onChange; drives optimistic UI updates via useTransition |
| isLoading | boolean | false |  | loading state; disables interaction + shows a spinner |
| min | ISODateString |  |  | min selectable date: ISODateString template literal type (YYYY-MM-DD); use string literal or cast `as ISODateString` |
| max | ISODateString |  |  | max selectable date: ISODateString template literal type (YYYY-MM-DD); use string literal or cast `as ISODateString` |
| dateConstraints | Array<(date: Date) => boolean> |  |  | custom constraint fns to disable dates |
| maxRangeSpan | number |  |  | max days a range may span, both endpoints counted (7 = a 7-day window); caps the window from the picked start. Selection-only; does not rewrite an over-wide value |
| minRangeSpan | number |  |  | min days a range must span, both endpoints counted (2 forbids a single-day range); repeated start click commits one day when allowed, otherwise cancels; default 1 |
| presets | Array<DateRangePreset> |  |  | preset ranges as quick-select options; disabled when an endpoint or span violates the corresponding constraints |
| hasClear | boolean | true |  | clear button when range is set (default true) |
| placeholder | string | 'Select date range' |  | placeholder when empty |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | trigger size |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | error/warning/success status |
| statusVariant | 'attached' \| 'detached' \| 'tooltip' | 'attached' |  | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| labelTooltip | string |  |  | tooltip via info icon at label end |
| numberOfMonths | 1 \| 2 | 2 |  | months in calendar (default 2) |
| weekStartsOn | 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 'sun' \| 'mon' \| 'tue' \| 'wed' \| 'thu' \| 'fri' \| 'sat' | 0 |  | first day of week in calendar (0=Sunday, or name e.g. "mon") |
| calendar | 'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura' | the InternationalizationProvider's calendar, else 'gregory' |  | calendar for the trigger text + popover calendar (default: provider's, else 'gregory'); values and presets stay Gregorian ISO; no typed entry; non-Gregorian-aligned calendars need Temporal (native or app-loaded polyfill), else Gregorian |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| containerXstyle | StyleXStyles |  |  | Field box (label+control+status); also containerClassName/containerStyle. no effect in InputGroup or horizontal-labels FormLayout |
| controlXstyle | StyleXStyles |  |  | visual control box (border/bg/icons), never the native input; also controlClassName/controlStyle. no root xstyle/className/style |

## Do
- Base props such as ref, id, data-*, aria-*, and DOM event handlers go to the range trigger, the element that is focused and announced. A DOM handler runs after DateRangeInput's own handler for the same event and still receives events it handled (including ones it called preventDefault on), so it cannot cancel built-in behavior.
- Use presets for common ranges like "Last 7 days" to speed up selection.
- Use min/max to constrain selectable dates to valid ranges.
- Keep hasClear enabled (default) so users can reset the filter.
- Provide clear labels + descriptions so users understand what the range controls.

## Do not
- Use DateRangeInput when only a single date is needed; use DateInput instead.
- Hide the label without surrounding context that makes the purpose obvious.
- Wrap a disabled DateRangeInput in Tooltip to explain why it is disabled. Use the disabledMessage prop instead, which ties the reason to the field.
