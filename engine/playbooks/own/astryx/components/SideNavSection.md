# SideNavSection
Import: import { SideNavSection } from '@astryxdesign/core';

Section grouping w/ optional title, subtitle, end content.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | string |  | yes | Section title. |
| subtitle | string |  |  | Section subtitle. |
| children | ReactNode |  |  | Section items. |
| endContent | ReactNode |  |  | Right-side content in section header. |
| isHeaderHidden | boolean | false |  | Visually hides section header while keeping accessible to screen readers. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. |
