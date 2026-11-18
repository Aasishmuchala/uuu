# DateTimeInput
Group: DateInput. Category: Form Controls.
Import: import { DateTimeInput } from '@astryxdesign/core';

combined date + time picker with calendar popover and time input

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | label text |
| isLabelHidden | boolean | false |  | visually hide label |
| description | string |  |  | helper text below label |
| isOptional | boolean | false |  | show "(optional)" indicator |
| isRequired | boolean | false |  | mark field required |
| isDisabled | boolean | false |  | disable input+picker |
| disabledMessage | string |  |  | reason shown in a tooltip on hover/focus when disabled; describes the fields |
| value | ISODateTimeString |  |  | selected datetime ISO 8601 |
| onChange | (value: ISODateTimeString \| undefined) => void |  | yes | callback on datetime change |
| changeAction | (value: ISODateTimeString \| undefined) => void \| Promise<void> |  |  | async action after onChange; drives optimistic UI |
| isLoading | boolean | false |  | loading state; disables interaction, shows spinner |
| min | ISODateTimeString |  |  | min selectable datetime (ISO) |
| max | ISODateTimeString |  |  | max selectable datetime (ISO) |
| dateConstraints | Array<(date: Date) => boolean> |  |  | custom constraint fns to disable specific dates |
| hasSeconds | boolean | false |  | include seconds; retains Astryx time field because iOS native picker has no seconds wheel |
| hourFormat | '12h' \| '24h' | the locale's hour cycle |  | display format. '12h' shows the locale's day period; '24h' uses 24-hour. Unset follows the provider locale's hour cycle (a -u-hc- tag carries a user preference) |
| timeIncrement | 1 \| 5 \| 10 \| 15 \| 30 | 1 |  | minute step for Astryx typed field; non-default retains Astryx time field in native modes because iOS native step is validation-only |
| timeOptionInterval | 5 \| 10 \| 15 \| 30 \| 60 |  |  | preset-time combobox cadence; setting it retains Astryx time field because native pickers have no equivalent list |
| hasClear | boolean | false |  | Shows clear button when datetime is set |
| placeholder | string | 'Select a date' |  | date-portion placeholder when empty |
| calendar | 'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura' | the InternationalizationProvider's calendar, else 'gregory' |  | calendar for typed + committed date text, the popover, and the sheet's Date panel (months, leap months, era years; an era-change year follows the shown month, e.g. 平成31 in Jan 2019, 令和元 in Jul) (default: provider's, else 'gregory'); values stay Gregorian ISO; years are the calendar's, so set min/max on buddhist/roc fields; non-Gregorian-aligned calendars need Temporal (native or app-loaded polyfill), else Gregorian; non-gregory/iso8601 never shows native controls: popovers fine / sheet coarse |
| timePlaceholder | string | 'Select a time' |  | time-portion placeholder when empty; shown on touch closed time segment |
| timeLabel | string |  |  | accessible label for the time input; defaults to "{label} time" |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | input control size |
| status | {type: 'warning' \| 'error' \| 'success', message?: string} |  |  | error/warning/success status w/ message; a rejected date (typed or native) or kept unreadable/unfinished text shows its own error instead, unless onEntryErrorChange is set and status is an error w/ message; a rejected typed time (complete, or at Enter/blur, text kept) shows its own error unless the date message shows or status is an error w/ message |
| onEntryErrorChange | (error: {kind: 'unreadable' \| 'incomplete' \| 'nonexistent' \| 'outOfRange' \| 'unavailable', text: string, date?: ISODateString} \| null) => void |  |  | (error\|null) on each typed-rejection change: kind 'unreadable'\|'incomplete'\|'nonexistent'\|'outOfRange' (min/max)\|'unavailable' (dateConstraints), text, date (Gregorian ISO, outOfRange/unavailable); also on new min/max/dateConstraints/value, calendar pick, disable, Enter/blur; never twice for one rejection; null when the typed field leaves mid-rejection (presentation/pointer switch); with it an error status w/ message replaces the field's own message, re-announced once if unchanged when a rejection starts; never a rejection on native/touch pickers |
| entryErrorBehavior | 'complete' \| 'blur-or-enter' | the nearest FormLayout's defaultEntryErrorBehavior, else 'complete' |  | 'complete'\|'blur-or-enter': when both segments' own rejections show (not when validation runs; not React Aria validationBehavior; never changes status). complete: complete nonexistent/out-of-range date, complete out-of-range time and native out-of-range time at once, other text at Enter/blur. blur-or-enter: message, aria-invalid, styling, announcement and date onEntryErrorChange report all wait for Enter/blur in that segment. Accepted or emptied entry clears at once; still-wrong edit keeps a shown error (blur-or-enter). Native date refusals wait for Enter/blur under both. Default: nearest FormLayout defaultEntryErrorBehavior, else complete |
| labelTooltip | string |  |  | tooltip text via info icon at label end |
| numberOfMonths | 1 \| 2 | 1 |  | Astryx pointer-calendar months shown simultaneously; ignored by native date controls and the mobile touch sheet |
| weekStartsOn | 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 'sun' \| 'mon' \| 'tue' \| 'wed' \| 'thu' \| 'fri' \| 'sat' | 0 |  | first day of week in Astryx calendars (0=Sunday, or name e.g. "mon"); ignored by native date controls |
| presentation | 'popover' \| 'bottom-sheet' \| 'native' \| 'adaptive-bottom-sheet' \| 'adaptive-native' | 'adaptive-native' |  | date+time surfaces: 'adaptive-native' (default) = Astryx popovers fine / browser/OS coarse w/ per-segment fallbacks (seconds/timeIncrement/timeOptionInterval); 'native' = browser/OS always, no fallback; 'adaptive-bottom-sheet' = popovers fine / coordinated sheet coarse; 'popover'/'bottom-sheet' force Astryx. every value opens pickers (no typed-only value; that is TimeInput's). non-gregory/iso8601 calendar: native + adaptive-native become popovers fine / sheet coarse; explicit 'native' warns in dev. |
| nativePicker | 'touch' \| 'always' \| 'never' | 'touch' |  | deprecated, use presentation: 'touch'='adaptive-native', 'always'='native', 'never'='adaptive-bottom-sheet'. still works as released, except that a calendar other than gregory or iso8601 never shows the native control; presentation wins if both set. |
| width | SizeValue |  |  | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| containerXstyle | StyleXStyles |  |  | Field box (label+control+status); also containerClassName/containerStyle. no effect in InputGroup or horizontal-labels FormLayout |
| controlXstyle | StyleXStyles |  |  | visual control box = the row holding the date and time segments, never a native input; also controlClassName/controlStyle. no root xstyle/className/style |

## Do
- Base props such as ref, id, data-*, aria-*, and DOM event handlers go to the date input, the element that is focused and announced. A DOM handler runs after DateTimeInput's own handler for the same event and still receives events it handled (including ones it called preventDefault on), so it cannot cancel built-in behavior.
- Provide clear labels + descriptions so users understand what datetime is expected.
- Use min and max to restrict selectable datetimes to valid ranges.
- Set min and max on a Buddhist or Minguo calendar field, so a Gregorian year typed by mistake shows an error instead of a date centuries away.
- Use hasClear when the datetime is optional so the user can reset it.
- Leave hourFormat unset so the field follows the InternationalizationProvider locale's hour cycle (12-hour in en-US, 24-hour in en-GB or de-DE). Set it only when the field itself needs a fixed format, and carry a person's own 12/24-hour preference on the provider locale (e.g. 'en-US-u-hc-h23') rather than on each field.

## Do not
- Use DateTimeInput when only a date is needed; use DateInput instead.
- Use DateTimeInput when only a time is needed; use TimeInput instead.
- Hide the label without surrounding context that makes the field purpose obvious.
- Wrap a disabled DateTimeInput in Tooltip to explain why it is disabled. Use the disabledMessage prop instead, which ties the reason to the field.
