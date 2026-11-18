# SideNavHeading
Import: import { SideNavHeading } from '@astryxdesign/core';

Product/suite/account heading w/ smart interaction boundary logic for links + menu popover.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| heading | string |  | yes | Product/app name. |
| icon | ReactNode |  |  | Product/app icon. |
| headingHref | string |  |  | Link for heading. |
| superheading | string |  |  | Text above heading. |
| superheadingHref | string |  |  | Link for superheading. |
| subheading | string |  |  | Text below heading. |
| subheadingHref | string |  |  | Link for subheading. |
| menu | ReactNode |  |  | Menu content rendered inside popover. |
| headerEndContent | ReactNode |  |  | Content at trailing edge of heading row. For badges, status indicators, action buttons. Hidden when collapsed. |
