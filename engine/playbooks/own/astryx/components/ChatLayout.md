# ChatLayout
Import: import { ChatLayout } from '@astryxdesign/core';

layout shell for full chat; msgs in page flow, composer fixed bottom w/ frosted glass dock; density prop (default balanced); scrollRef delegates to parent/body; in Chrome on Android (Gboard) the composer rides the software keyboard in step; in Safari on iOS and Firefox for Android it moves above the keyboard once reported (Chrome with interactive-widget=resizes-content: the page resizes, no move); transcript stays at newest msg, on a touch screen in a top-level page every focus route (tap, prev/next, Tab, focus()) w/o page scroll and Done rests focus on the composer group (no name, ring after keyboard input only, no tab stop); under a mouse or in an iframe: plain wrapper, browser focus

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | msg content; typically ChatMessageList |
| composer | ReactNode |  | yes | composer element; typically ChatComposer; fixed bottom w/ frosted glass |
| emptyState | ReactNode |  |  | content when children empty |
| scrollButton | ReactNode \| null |  |  | scroll-to-bottom btn; defaults to ChatLayoutScrollButton; pass null to hide |
| scrollRef | React.RefObject<HTMLElement \| null> |  |  | external scroll container ref; targets parent/body instead of layout root |
| density | 'compact' \| 'balanced' \| 'spacious' | 'balanced' |  | visual density; dock padding, message max-width, blur height |

## Do
- Pass ChatMessageList as children and ChatComposer as composer prop for complete chat.
- Provide emptyState so new conversations show a prompt, not blank screen.
- Use scrollRef when chat is embedded in a page where a parent element handles scrolling.
- full-page: container 100dvh not 100vh (100vh = viewport w/ phone toolbar hidden; composer starts below screen edge)
- Markdown prose keeps 680px measure; code/tables span column. One right edge: pass contentWidth="100%" to Markdown.

## Do not
- Apply fixed height on layout; let it fill container with flex: 1.
- Render multiple ChatLayout instances in same scroll container; each expects to own its scroll context.
