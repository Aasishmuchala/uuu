# Outline
Group: Outline. Category: Navigation.
Import: import { Outline } from '@astryxdesign/core';

Document outline/table-of-contents nav with sliding indicator track. Flat items array {id,label,level}; anchor links; density variant (default/compact); uncontrolled scroll-spy by scroll position (last heading past its resting line = offset + its own scroll-margin-top; first item at top, last at bottom); controlled with activeId; smooth-scroll on click that pins the active item until the next manual scroll. Each link is a Tab stop; Enter/Space activate; no arrow/Home/End movement. onNavigateStart/onNavigateEnd fire around the scroll. Scroll scoping via offset / scrollContainerRef / hasScrollOnClick.

## Do
- Pass a flat ordered list of headings and let level control indentation.
- Use activeId when custom scroll logic owns the active section.
- Use density="compact" in dense sidebars where vertical space is tight.
- Use useOutlineFromMarkdown or useOutlineFromDOM when headings are generated from content. For linkable Markdown headings, pass the same createMarkdownHeadingLinks() entry to Markdown and Outline; configure headingIdPrefix on that plugin for multiple roots.
- Pass scrollContainerRef when the content scrolls in a split pane, modal, or panel instead of the viewport.
- Set offset to the height of a fixed header that overlays the content, so headings land below it instead of underneath it.

## Do not
- Use Outline for application navigation - use SideNav or TopNav for routes.
- Use Outline for expandable hierarchy - use TreeList when nodes need expand and collapse.
- Rely on onNavigateEnd to mean "arrived" - it also fires when the user interrupts the scroll.

## Parts
- Outline
