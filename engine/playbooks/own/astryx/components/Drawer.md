# Drawer
Group: Drawer. Category: Overlay.
Import: import { Drawer } from '@astryxdesign/core';

side panel floating over content (native <dialog>): start/end edge, full height, Dialog-like container padding (--spacing-4 by default; padding prop or theme drawer padding)

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| isOpen | boolean |  | yes | Whether the drawer is open. Fully controlled; pair with onOpenChange. |
| onOpenChange | (isOpen: boolean) => void |  | yes | Called when the drawer requests an open-state change. Escape and a scrim click call it with false as purpose allows; a DrawerHeader given the same callback calls it from its close button. The caller owns the open state. With sibling drawers open, Escape only closes the last-opened one. |
| label | string |  | yes | Accessible label for the drawer. Required; the drawer has no built-in heading to derive a name from. |
| children | ReactNode |  | yes | Drawer content, rendered inside a full-height scrollable area. Compose your own header/body/footer; an element with data-autofocus is focused on open. Children stay mounted during the exit animation; keep the last-selected item rendered instead of nulling content on close. |
| side | 'start' \| 'end' | 'end' |  | Edge the drawer slides from: 'end' is right in LTR (the inspector convention), 'start' is left. Inline axis only; for a bottom sheet use BottomSheet. |
| width | number \| string | 400 |  | Desktop width budget. A number is pixels; a string is any CSS length ('50%', '32rem'). Below the 640px mobile breakpoint this remains the maximum while the drawer preserves a 56px reveal of the page behind. |
| experimental | {isFullWidthOnMobile?: boolean} |  |  | Experimental options: anything in this object may change or be removed in a patch release, and omitting it keeps the stable behavior. isFullWidthOnMobile (default false) covers the full viewport width below the 640px mobile breakpoint instead of preserving the default 56px reveal of the page behind, which makes the drawer read as an overlay, not a navigation. |
| hasScrim | boolean | true |  | Modal scrim behind the drawer. true uses showModal() (top layer, focus trap, scroll lock; clicking the scrim closes unless purpose prevents it; modal only); false uses the manual Popover API for a non-modal top-layer overlay that does NOT trap focus and keeps the page behind interactive. |
| purpose | 'required' \| 'form' \| 'info' | 'info' |  | Configures implicit dismissal, matching Dialog. info: Escape and a scrim click close. form: Escape closes, a scrim click does not. required: neither closes (Escape is consumed) and a modal drawer is exposed as an alertdialog, so give its content a way out. A non-modal drawer has no scrim, so form and info behave the same. |
| padding | 0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10 |  |  | Internal padding of the drawer content using the spacing scale, matching Dialog. When omitted, uses the theme default for drawers: --spacing-4 (16px) unless the theme sets padding on drawer. Pass 0 for a full-bleed content area. A lone Section child escapes the padding, bleed children such as Table and Divider compensate against it, and a Layout picks it up for its regions. The content area's block-end edge adds the home-indicator safe area on top in every mode. |

## Do
- Use for contextual detail views (row inspectors, entity details) where the user should keep the underlying list in sight.
- Keep the caller as the source of truth: derive isOpen from selection state and clear the selection in onOpenChange.
- Use hasScrim={false} for master-detail flows; non-modal drawers do not trap focus and the page behind stays interactive.
- Keep the last-selected item rendered on close: children stay mounted during the exit animation, so nulling content mid-close blanks the panel while it slides out.
- Give every drawer a visible close action, usually DrawerHeader with onOpenChange; a non-modal drawer has no scrim to click.
- Use purpose="form" when a stray scrim click would discard unsaved input.

## Do not
- Use a Drawer for short confirmations or small forms; use Dialog or AlertDialog instead.
- Reach for a Drawer when the content should push the page aside; a Drawer floats over content, so use a docked panel or layout column instead.
- Use a Drawer as a bottom or top sheet; it is inline-axis only, so use BottomSheet for block-axis sheets.
- Nest a Drawer inside another Drawer; render drawers as siblings; the last-opened stacks on top and Escape closes it first.

## Example
```jsx
const [isOpen, setIsOpen] = useState(false);
<>
  <Button label="Open drawer" onClick={() => setIsOpen(true)} />
  <Drawer
    isOpen={isOpen}
    onOpenChange={setIsOpen}
    label="Details"
    width={360}>
    <Layout
      header={<DrawerHeader title="Details" onOpenChange={setIsOpen} />}
      content={
        <LayoutContent>
          <Text type="body">Close with Escape, the scrim, or the close button.</Text>
        </LayoutContent>
      }
    />
  </Drawer>
</>
// Modal by default: the scrim dims the page and focus is trapped. Escape, a
// scrim click, or the header's close button closes it, and focus returns to
// the trigger.
```
