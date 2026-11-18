# Indicator
Group: Indicator. Category: Form Controls.
Import: import { Indicator } from '@astryxdesign/core';

Decorative selection visuals: the mark on a chosen option, the checkbox box, the radio circle. Rendered by Selector/CheckboxInput/RadioList/menu rows. Replace one by name via defineTheme({indicators}) and every component drawing it follows.

## Do
- Prefer the canonical `components['checkbox-indicator']` override first. Replacing the component is the heavier path, for when the shape itself is wrong.
- Match the shipped replacement-content branch with `isRenderable(children)`, not `children != null` or `children ?? mark`. The helper is shallow: it excludes nullish values, booleans, and the empty string, while React elements and containers take the replacement path even when their descendants render nothing. The owner passes `children={isBusy && <Spinner/>}`, so a nullish check deletes the state mark whenever the value is `false` (#4893).
- A replacement must set aria-hidden. The owner supplies role and accessible name; a visible indicator would be announced twice.
- Use theme tokens for every color, radius, and border width in a replacement. Run `astryx docs tokens` for the set.
- Render a single root ELEMENT with the border-radius the focus ring should follow. The owner paints the standard ring onto the indicator at focus time (useIndicatorFocusRing) and outline picks up its radius; the ring is never missing (WCAG 2.4.7), only mis-shaped if the root lacks a radius. Do not draw a focus ring yourself.

## Do not
- Thread hover or pressed state in as props. Interaction state reaches an indicator through the owner's CSS ancestor marker.
- Assume you are only mounted when selected. The host renders the indicator unconditionally and passes `state` in every state; that is what lets a replacement draw where the default draws nothing (a radio's empty circle on an unchosen row).

## Parts
- CheckboxIndicator
- CheckIndicator
- RadioIndicator

## Example
```jsx
// Indicators render the same stable class targets wherever they appear, so
// one component override reaches the form control, the menu row, and any
// selection slot themed to use it. No indicator-specific API needed.
defineTheme({
  name: 'brand',
  components: {
    'checkbox-indicator': {
      base: {borderRadius: 'var(--radius-full)', borderWidth: '2px'},
      checked: {
        backgroundColor: 'var(--color-accent)',
        borderColor: 'var(--color-accent)',
      },
      'checked+disabled': {backgroundColor: 'var(--color-background-muted)'},
    },
    'radio-indicator': {base: {borderWidth: '2px'}},
    'radio-indicator-dot': {base: {borderRadius: '2px'}},
  },
});
```
