# Button
Group: Button. Category: Action.
Import: import { Button } from '@astryxdesign/core';

action trigger w/ 4 variants, 3 sizes, loading state

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| label | string |  | yes | accessible label; visible text by default, aria-label when isIconOnly |
| variant | 'primary' \| 'secondary' \| 'ghost' \| 'destructive' | 'secondary' |  | visual style variant |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | size variant |
| elevation | 'none' \| 'low' \| 'med' \| 'high' | 'none' |  | resting shadow depth for floating buttons/FABs: none\|low\|med\|high; ignored inside ButtonGroup |
| type | 'button' \| 'submit' \| 'reset' | 'button' |  | HTML button type; defaults to "button" |
| name | string |  |  | HTML name for form submission |
| value | string \| number \| readonly string[] |  |  | HTML value for form submission |
| form | string |  |  | associates button with form element by ID |
| isLoading | boolean | false |  | shows spinner, blocks re-activation but stays focusable (aria-disabled, not native disabled); announces via live region |
| isInterruptible | boolean | false |  | Keep the button clickable while a clickAction is pending: the spinner and aria-busy still show, but the button is not disabled and the action is not deduped, so a re-click lands and interrupts the in-flight action with a fresh one. |
| isDisabled | boolean | false |  | disables button; uses aria-disabled instead of native disabled |
| icon | ReactNode |  |  | icon element rendered before label text; unsized Astryx Icon defaults to sm for sm/md buttons and md for lg |
| isIconOnly | boolean | false |  | when true, renders square icon-only button; label becomes aria-label |
| width | SizeValue |  |  | Width of button. Numbers=pixels, strings=as-is (e.g. '100%' for full-width). Default: content width, capped at the container; label truncates w/ ellipsis in a narrow row; icon-only stays square. |
| children | ReactNode |  |  | optional visible override; label is still required for a11y. Prefer <Button label="Save" /> over using children |
| endContent | ReactElement<IconProps> \| ReactElement<BadgeProps> |  |  | trailing icon/badge after label; ignored when isIconOnly; color inherited |
| tooltip | string |  |  | tooltip on hover |
| onClick | (e: MouseEvent) => void |  |  | standard click handler; fires before clickAction |
| clickAction | (e: MouseEvent) => void \| Promise<void> |  |  | async click handler; shows loading while promise pending |
| href | string |  |  | When provided, renders the button as a link element (<a> or custom link component). The destination follows the shared navigation rule described on the Link `href` prop. |
| as | ComponentType |  |  | Custom link component to use when href is provided (e.g. Next.js Link). |
| target | string |  |  | HTML target attribute when rendered as a link (e.g. "_blank"). |
| rel | string |  |  | HTML rel attribute when rendered as a link (e.g. "noopener noreferrer"). |

## Do
- Primary for the single most important action. Secondary or ghost for the rest.
- Labels that describe the action: "Save changes" not "OK" or "Click here".
- Show loading state for async actions so the user knows it is working.
- Icon-only buttons need a label for screen readers and a tooltip for sighted users.
- For dedicated icon-only buttons, use IconButton from @astryxdesign/core/IconButton. Separate component, not exported from @astryxdesign/core/Button.

## Do not
- Multiple primary buttons in one view; dilutes hierarchy.
- Destructive without confirmation for irreversible actions.
- Button for navigation; use a link if it only takes the user to another page.
- xstyle or className on ::before: under a coarse primary pointer it is the touch press layer while a press is on or fading (z-index -1, opacity animated); nothing at rest.

## Example
```jsx
import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {StackItem} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';

// On a phone (or any card narrower than its actions), a labelled Button
// shrinks with its row and truncates its label with an ellipsis instead of
// overflowing or being clipped by the card. The full label stays the
// accessible name. Icon-only buttons keep their square size.
function ReviewersCard() {
  const [emails, setEmails] = useState('');
  return (
    <Card maxWidth={560}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Heading level={3} maxLines={1}>
              Design review
            </Heading>
          </StackItem>
          <Button label="Request review from the design team" size="sm" />
          <IconButton
            label="More review options"
            icon={<Icon icon="moreHorizontal" />}
            variant="ghost"
            size="sm"
          />
        </HStack>
        <TextInput
          label="Reviewer emails"
          placeholder="name@example.com"
          value={emails}
          onChange={setEmails}
        />
        {/* In a 320px form footer the long primary action truncates.
            StackItem size="static" keeps the short Cancel label whole. */}
        <HStack gap={2} hAlign="end">
          <StackItem size="static">
            <Button label="Cancel" variant="secondary" />
          </StackItem>
          <Button label="Send invitations to all 12 reviewers" variant="primary" />
        </HStack>
      </VStack>
    </Card>
  );
}
```
