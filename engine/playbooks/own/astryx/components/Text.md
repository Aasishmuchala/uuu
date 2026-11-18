# Text
Category: Content.
Import: import { Text } from '@astryxdesign/core';

semantic body text + headings w/ theme-driven type scale, truncation, tabular numbers

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| type | 'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit' | 'body' |  | Semantic text type. Determines size, weight, and line-height from the theme. 'inherit' takes all three from the surrounding text instead. Themes may add custom types. Note: this prop is called `type`, not `variant`. |
| children | ReactNode |  | yes | Text content. |
| size | '4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl' |  |  | Explicit font size override. Overrides the size from `type` but preserves other type properties. Prefer using `type` alone. |
| color | 'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit' |  |  | Text color. Defaults to 'secondary' for the 'supporting' type, 'primary' for all others. Themes may add custom colors. |
| weight | 'normal' \| 'medium' \| 'semibold' \| 'bold' |  |  | Font weight override. |
| display | 'inline' \| 'block' | 'inline' |  | Display type. Silently overridden to 'block' when maxLines > 0 or hasCapsize is true. |
| as | 'span' \| 'p' \| 'div' \| 'label' | 'span' |  | HTML element to render. |
| maxLines | number | 0 |  | Maximum lines before truncation. 0 means no truncation. When set, shows a tooltip on hover if content is truncated. |
| hasTruncateTooltip | boolean \| 'above' \| 'below' \| 'start' \| 'end' | true |  | Controls tooltip behavior for truncated text. true shows the tooltip at the default position, false disables it, or a placement string ('above' \| 'below' \| 'start' \| 'end') sets a specific position. |
| wordBreak | 'break-word' \| 'break-all' |  |  | Word break behavior when truncating. Defaults to 'break-all' for single-line truncation, 'break-word' otherwise. Without truncation, a token longer than its line (a URL, an ID) wraps (`overflow-wrap: break-word`), so in ordinary flow text does not make the page scroll sideways. Inside a flex row, give the flex child `min-width: 0` so it can shrink. A container you style with `overflow-wrap: anywhere` does not reach this text; Astryx's own containers pass their wrap through. |
| textWrap | 'wrap' \| 'nowrap' \| 'balance' \| 'pretty' |  |  | Text wrapping behavior. |
| justify | 'start' \| 'center' \| 'end' | 'start' |  | Text alignment (justification). Uses logical values (start/end) for i18n/RTL compatibility. |
| hasCapsize | boolean | false |  | Enable optical alignment using text-box-trim. Forces block display. |
| hasStrikethrough | boolean | false |  | Apply strikethrough text decoration. |
| hasTabularNumbers | boolean | false |  | Use tabular (monospace) numbers for aligned numeric data. |
| id | string |  |  | HTML id attribute. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Do
- Semantic type (body, label, supporting, large, code) instead of manual size/weight.
- accessibilityLevel on Heading when visual level differs from document outline.
- maxLines for truncation; tooltip shows full text on hover.
- hasTabularNumbers for aligned numeric columns.

## Do not
- Override size/weight when a semantic type already matches.
- Skip heading levels; sequential h1 → h2 → h3.
- Raw <p>/<h1>/<span>; use Text/Heading for theme tokens.
- `variant` prop, which does not exist. Use `type` for text styling or Heading for headings.
- Text for headings: use Heading with level (1–6).

## Parts
- Heading
