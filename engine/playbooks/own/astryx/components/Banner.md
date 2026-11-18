# Banner
Category: Feedback & Status.
Import: import { Banner } from '@astryxdesign/core';

persistent message for errors, updates, warnings, or confirmations

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| status | 'info' \| 'warning' \| 'error' \| 'success' |  | yes | controls icon+color |
| title | ReactNode |  | yes | title text/ReactNode in header |
| description | ReactNode |  |  | text below title in header |
| icon | ReactNode |  |  | override default status icon |
| isDismissable | boolean | false |  | user can dismiss banner |
| onDismiss | () => void |  |  | dismiss callback; banner self-hides regardless |
| dismissLabel | string |  |  | a11y name + visible tooltip for dismiss; defaults to "Dismiss <title>" |
| endContent | ReactNode |  |  | end-aligned action in header, typically button/link; wraps to its own row when the header is too narrow |
| container | 'card' \| 'section' | 'card' |  | card=border-radius; section=full-width no radius for page-level |
| elevation | 'none' \| 'low' \| 'med' \| 'high' | 'none' |  | resting shadow depth: none\|low\|med\|high; raise for a floating banner |
| children | ReactNode |  |  | content in card-bg area below colored header; behind a toggle unless collapsible={false} |
| collapsible | boolean \| {defaultIsOpen?: boolean; isOpen?: boolean; onOpenChange?: (isOpen: boolean) => void} | true |  | children behind a header toggle; default true=collapsed. false=always visible, no toggle. {defaultIsOpen:true}=starts open, {isOpen,onOpenChange}=controlled |
| xstyle | StyleXStyles |  |  | StyleX layout customization via stylex.create() |

## Do
- Pick a status that matches the message: info for updates, warning for caution, error for problems, success for confirmations.
- Use the card container inside page content and the section container for full-width messages that span the entire page.
- Make info and success banners dismissable. Keep error banners visible until the user fixes the issue.
- Keep titles short and scannable: "Payment failed" not "There was a problem processing your most recent payment."
- Set collapsible={false} when the user needs the content to act on the message, like the list of fields that failed validation. Keep the default toggle when the detail is long enough to bury the banner's own message.
- Banner status controls color and icon only; it does not create a live region. Announce async outcomes from the transition handler with useAnnounce. Pass role="alert" only for an urgent message the person must act on now: Banner puts it on the title and description, so controls, endContent and supporting content are not read as part of the alert. Do not also announce that message with useAnnounce.

## Do not
- Use Banner for short-lived messages that disappear on their own; use Toast instead.
- Stack multiple banners with the same status; combine related messages into one banner.
- Rely on the status color or icon alone to carry meaning; say which status it is in the title text, because the icon is decorative to a screen reader.

## Example
```jsx
import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {useAnnounce} from '@astryxdesign/core/hooks';

function SaveSettings() {
  const announce = useAnnounce();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  async function handleSave() {
    try {
      await saveSettings();
      setResult('success');
      announce('Settings saved');
    } catch {
      setResult('error');
      announce('Settings could not be saved');
    }
  }

  return (
    <>
      <Button label="Save settings" onClick={handleSave} />
      {result != null ? (
        <Banner
          status={result}
          title={result === 'success' ? 'Settings saved' : 'Save failed'}
        />
      ) : null}
    </>
  );
}
```
