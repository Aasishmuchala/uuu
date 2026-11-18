# Badge
Category: Feedback & Status.
Import: import { Badge } from '@astryxdesign/core';

highlights a status or category tag, NOT for general metadata

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| variant | 'neutral' \| 'info' \| 'success' \| 'warning' \| 'error' \| 'blue' \| 'cyan' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow' | 'neutral' |  | visual style variant |
| label | ReactNode |  | yes | badge text content; over-wide labels clip with an ellipsis, full text in title |
| icon | ReactNode |  |  | optional leading icon |

## Do
- Every badge steals attention. Only badge states where the user needs to act. If no follow-up is needed, use plain text.
- Use success/warning/error ONLY for system status requiring attention (Failed, Degraded, Action Required). These are visually loud: solid colored backgrounds.
- Use color variants (blue, purple, teal) for category tags that classify items: team names, content types, priority levels.
- Keep labels to one or two words. If more detail is needed, put it in surrounding text instead of the badge.
- Add an icon when it helps identify the badge type quickly, but always include a text label alongside it.
- A string or number label keeps its character order under right-to-left, so `+3` and `@alice` read as written. When a rich label mixes directions, mark the direction on your own content, for example with `dir` or `<bdi>`.

## Do not
- Apply "success" badges to every healthy/normal item. If most rows are green "Active", none stand out. Skip the badge for the default state; only highlight exceptions that need attention.
- Use badges for metadata. Durations, counts, dates, descriptions → use Text with type="supporting" instead.
- Use status variants for non-status info. "6h window", "12 types", category names are NOT statuses.
- Repeat loud badges in every row. Common/default states should be plain text; reserve badges for the exceptional.
- Make badges clickable; they are read-only. Use a button or link for actions.
