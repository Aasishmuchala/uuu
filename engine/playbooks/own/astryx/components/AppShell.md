# AppShell
Group: AppShell. Category: Layout.
Import: import { AppShell } from '@astryxdesign/core';

app-level layout shell w/ header, side nav, main content; composes Layout internally, replaces Page+PageLayout

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  |  | main content area, rendered inside <main> |
| contentPadding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 | 0 |  | main content area padding. 4 (16px) for forms/settings/text, 0 for dashboards/maps/tables. Override per-section via Section. |
| topNav | ReactNode |  |  | top nav slot, typically TopNav |
| sideNav | ReactNode |  |  | side nav slot, typically SideNav |
| mobileNav | ReactNode |  |  | mobile nav config: false \| ReactNode \| config with theme-resolved sm\|md\|lg\|xl\|2xl\|none breakpoint (exclusive upper edge); none is always non-mobile and ignores defaultIsMobile |
| banner | ReactNode |  |  | slot for system-wide announcements above topNav |
| height | 'fill' \| 'auto' | 'fill' |  | fill=viewport 100dvh w/ independent scroll; auto=content-driven w/ sticky nav |
| variant | 'wash' \| 'surface' \| 'section' \| 'elevated' | 'elevated' |  | nav bg style: wash=wash bg, surface=surface bg, section=dividers, elevated=wash nav w/ elevated surface content+radius |
| xstyle | StyleXStyles |  |  | StyleX layout customization via stylex.create() |

## Do
- Choose the right height: use "fill" for dashboards with internal scrolling and "auto" for pages that grow with content.
- Set `contentPadding` based on content type: 4 for forms and settings, 0 for tables and dashboards.
- Give every nav slot an accessible name: TopNav and SideNav are separate navigation landmarks. Pass `label` to TopNav; SideNav has a translated default name, and `aria-label` renames it.
- Phones: add `viewport-fit=cover` to the viewport meta; the header then reaches under the status bar while its items and the content end stay in the safe area. Landscape: only the header is inset (not an inline SideNav or the content sides). No header region or phone top bar: no top inset, so keep top padding. Installed web apps: `apple-mobile-web-app-status-bar-style` `black-translucent`.
- Start the page heading inside `children`: AppShell owns the skip link, banner, and main landmarks but renders no heading, so the first content heading is the page h1.

## Do not
- Nest one AppShell inside another; it's the outermost layout frame.
- Use for sub-page layouts; use Layout for content areas within AppShell.
- Add your own skip link or <main>; AppShell renders both, and a second main landmark makes the first ambiguous.
