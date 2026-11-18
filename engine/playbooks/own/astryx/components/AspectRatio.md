# AspectRatio
Category: Layout.
Import: import { AspectRatio } from '@astryxdesign/core';

maintains specific aspect ratio for children

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| ratio | number |  | yes | width/height ratio (e.g. 16/9, 1); class-level declaration (never inline) so xstyle/unlayered-CSS @container overrides win |
| shape | 'rectangle' \| 'ellipse' | 'rectangle' |  | container shape: 'rectangle' (default) \| 'ellipse' (circle at ratio 1) |
| fit | 'cover' \| 'contain' \| 'center' |  |  | child layout: 'cover' fill+crop \| 'contain' fill+letterbox \| 'center' natural size; omitted = child styles itself |
| children | ReactNode |  | yes | content positioned absolutely to fill container |
| xstyle | StyleXStyles |  |  | StyleX layout customization via stylex.create() |

## Do
- Express the ratio as a fraction for readability — `ratio={16 / 9}` rather than `ratio={1.78}`. It is a number, so the string form `ratio="16/9"` is a type error.
- Use for media that needs consistent proportions across screen sizes.
- Use `fit="cover"` for images and video so the component sizes the child; the child should not repeat `width`/`height`/`objectFit` styles.
- Pass one child. With `fit` set, every direct child is stretched to fill the box, so put an overlay or caption inside a single wrapper child rather than passing it as a second child.
- Describe media children with `alt`, or `alt=""` when the image is decorative. AspectRatio adds no role and no accessible name of its own, so the child carries the whole accessible description.
- For a breakpoint-dependent ratio, override the ratio responsively: pass an `aspectRatio` rule via `xstyle` (StyleX), or override `aspect-ratio` from your own unlayered CSS under a `@media`/`@container` rule; component styles live in the `astryx-base` cascade layer, so unlayered consumer CSS wins. Give an `xstyle` rule a `default` branch alongside the conditional one (`{default: 3, '@container ...': '3 / 2'}`); with only the conditional branch the ratio is unset outside the query and the box collapses.

## Do not
- Use for general layout containers; use standard layout components instead.
- Nest AspectRatio containers; one level is sufficient.
- Constrain the height on its own. The width comes from the container, so a `height` or `maxHeight` by itself clamps the box off ratio; pair it with `width: "auto"` to size from the height instead.
- Place it in a shrink-to-fit parent such as `inline-flex`, `width: fit-content` or a floated box. It contributes no intrinsic width there and collapses to zero.
