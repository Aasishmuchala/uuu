# Timestamp
Category: Content.
Import: import { Timestamp } from '@astryxdesign/core';

formatted timestamp with relative/absolute/auto modes, live updates, timezone display, and a copyable multi-zone hover card (default single full-time row, customized via tooltipEntries)

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string \| number |  | yes | date/time as unix seconds or ISO string |
| format | 'relative' \| 'relative_short' \| 'auto' \| 'date' \| 'date_long' \| 'date_weekday' \| 'date_time' \| 'time' \| 'system_date' \| 'system_date_time' \| 'system_time' \| 'unix_seconds' | 'auto' |  | display mode: 'relative' (locale-native long wording), 'relative_short' (locale-native narrow wording), 'auto', 'date', 'date_long', 'date_weekday', 'date_time', 'time', 'system_date', 'system_date_time', 'system_time', 'unix_seconds'; date-bearing formats use the provider calendar, system_* and time do not |
| timezoneID | string |  |  | IANA time zone the absolute formats render in, such as 'UTC' or 'America/Los_Angeles'. Omit (or pass 'local') for the viewer's own zone. An explicit zone renders identically on the server and the client, so it is the way to show an absolute time without a hydration mismatch; relative formats' visible text ignores it, while configured tooltipEntries rows still follow it. An unknown identifier warns once in development and falls back to the viewer's zone. |
| autoThreshold | number | 604800 |  | seconds threshold for auto relative→date_time switch |
| hasTooltip | boolean | true |  | show copyable full-time hover card on hover or keyboard focus (relative mode, or any format with tooltipEntries) |
| tooltipEntries | ReadonlyArray<{timezoneID?: string; format?: TimestampTooltipFormat; label?: string; isCopyable?: boolean}> |  |  | hover rows across zones/formats: [{timezoneID?, format?, label?}]; an entry without timezoneID follows the Timestamp timezoneID when set, else the viewer zone ('local' always means the viewer zone), format defaults to 'full'; the hover surface is always a copy-to-clipboard card, these customize its rows (default: a single full-time row), and configuring entries enables the card on absolute formats |
| isTimezoneShown | boolean | false |  | append timezone abbreviation to visible text (date_time and time only) |
| isLive | boolean | false |  | live-update relative time |
| type | 'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit' | 'supporting' |  | Text semantic type |
| size | '4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl' |  |  | font size override |
| color | 'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit' | 'secondary' |  | text color |
| weight | 'normal' \| 'medium' \| 'semibold' \| 'bold' |  |  | font weight override |

## Do
- Use the auto format in feeds and lists so recent items show "2 hours ago" and older items show the full date automatically.
- Keep formatting consistent within the same list or table; mixing relative and absolute timestamps in the same column confuses scanning.
- Enable isTimezoneShown when the audience spans multiple time zones, like a global team calendar or audit log.
- Use tooltipEntries when readers must compare zones, such as an incident log where the reader's time and the event's origin zone both matter.
- Pass timezoneID when an absolute time must read the same for every viewer and on the server, like an incident log timestamp or anything server-rendered; without it the server markup depends on the server zone.
- Label every entry once a tooltip shows more than one zone; a bare abbreviation is not always recognizable (Tokyo renders as "GMT+9", not "JST").
- Use isLive for active dashboards or real-time feeds so the relative time stays accurate without a page refresh.
- Reach for tooltipEntries when readers need to grab an exact value: an incident log or deploy record where someone pastes the UTC time or Unix seconds elsewhere; configuring entries turns the hover into copy-to-clipboard rows.

## Do not
- Don't display raw Unix timestamps or ISO strings to users; always pass them through Timestamp to get a human-readable format.
- Avoid system_date or system_time formats in user-facing UI; they are meant for developer tools, logs, and machine-readable contexts.
- Don't disable the hover card on relative timestamps; users expect to hover for the full date when they see "3 hours ago".
- Don't stack many zones into one card; it is capped at 300px wide and long labelled lines wrap. Two or three entries read well.
- Don't pass a fixed-offset abbreviation like "EST" as timezoneID; it is a valid identifier but never observes daylight saving, so it reads an hour wrong for half the year. Use the region id, "America/New_York".
