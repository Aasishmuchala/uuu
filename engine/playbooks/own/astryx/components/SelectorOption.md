# SelectorOption
Import: import { SelectorOption } from '@astryxdesign/core';

Helper component for custom item rendering inside Selector renderOption prop.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | ReactNode |  | yes | Primary label text for item. |
| icon | IconType |  |  | Icon displayed before label. |
| description | ReactNode |  |  | Secondary description text below label. |
| layout | 'stacked' \| 'inline' | 'stacked' |  | How the label and description sit together. 'stacked' puts the description on its own line; 'inline' keeps both on one line so the row fits a fixed-height host. Inside a Selector trigger the trigger's padding sizes itself to whichever layout you pick, so both land on the 4px rhythm; an InputGroup pins the row height and forces 'inline'. |
| endContent | ReactNode |  |  | Additional content after label+description. |
