# AvatarGroupOverflow
Import: import { AvatarGroupOverflow } from '@astryxdesign/core';

overflow indicator for AvatarGroup; default +N or custom short count text

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| count | number |  | yes | hidden avatar count; drives default +N + aria label |
| children | ReactNode |  |  | optional custom short count text, e.g. +12 or 99+ |
| onClick | () => void |  |  | click handler; renders focusable button when set |
| ref | React.Ref<HTMLElement> |  |  | forwarded ref |
| xstyle | StyleXStyles |  |  | stylex.create() value — not an inline style object |

## Do
- Pass real hidden count to `count` for a11y.
- Keep custom text short: `+12`, `99+`.
- Use `onClick` to open member list/popover/details.

## Do not
- Don't let custom text disagree with `count`; `count` still labels the indicator for accessibility.
- Don't use long labels inside avatar-sized circle.

## Example
```jsx
<AvatarGroup size="lg">
  {users.slice(0, 3).map(user => (
    <Avatar key={user.id} src={user.src} name={user.name} />
  ))}
  <AvatarGroupOverflow count={users.length - 3} />
</AvatarGroup>
```
