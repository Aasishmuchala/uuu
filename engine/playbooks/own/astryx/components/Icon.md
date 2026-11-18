# Icon
Category: Content.
Import: import { Icon } from '@astryxdesign/core';

Renders icons w/ Astryx design system colors + sizes. Supports direct SVG icon components + semantic icon names that adapt to active theme.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| icon | IconName \| NamespacedIconName \| ComponentType<SVGProps> |  | yes | Semantic icon name or SVG component. Valid names: close, chevronDown, chevronLeft, chevronRight, chevronsLeft, chevronsRight, check, success, error, warning, info, calendar, clock, externalLink, menu, moreHorizontal, search, upload, arrowUp, arrowDown, arrowsUpDown, funnel, eyeSlash, viewColumns, copy, checkDouble, wrench, stop, microphone. A namespaced key (`richtext:bold`) names a glyph a component or library registers; an unregistered one renders nothing. For others, pass an SVG component. |
| color | 'primary' \| 'secondary' \| 'tertiary' \| 'disabled' \| 'accent' \| 'info' \| 'success' \| 'error' \| 'warning' \| 'inherit' \| 'blue' \| 'red' \| 'green' \| 'gray' \| 'cyan' \| 'teal' \| 'yellow' \| 'orange' \| 'pink' \| 'purple' | 'inherit' |  | Color variant mapped to Astryx icon color tokens; inherit = surrounding text color. Web also accepts the non-semantic palette: blue, red, green, gray, cyan, teal, yellow, orange, pink, purple. |
| size | 'xsm' \| 'sm' \| 'md' \| 'lg' | Contextual; otherwise 'md' |  | xsm/sm/md/lg = 12/16/20/24px at a 16px root, scale w/ root font size; theme sets a size's glyph dimension via width + height (px or rem) on components.icon['size:sm'] etc. Explicit Icon size; otherwise nearest owning-component default, then 'md' when no contextual default exists |
| variant | IconVariant |  |  | Requests the active theme's alternate artwork (e.g. 'filled'); names from augmentable IconVariantMap. Reaches the entry only if the active theme's iconVariants lists it (and an inherited entry's defining theme does too); else normal artwork. Ignored by a directly passed component; never in the DOM; no theming selector. |
| label | string |  |  | Accessible name for a meaningful, standalone icon. Sets role="img" + aria-label and drops the default aria-hidden. Omit (default) for decorative icons (stays aria-hidden). Empty string = decorative. The accessible-name/alt-text prop for icons. |
| xstyle | StyleXStyles |  |  | StyleX styles (color, size, opacity) via stylex.create(); composes with the base color/size styles. |
| className | string |  |  | Class added to the rendered glyph beside astryx-icon. |
| style | CSSProperties |  |  | Inline styles merged after Icon's size and color styles. |
| ref | Ref<SVGSVGElement> |  |  | Reaches the rendered SVG for every icon value; null when a resolved glyph has no <svg>. |

## Do
- Use semantic icon names when available; they adapt to theme changes automatically.
- Override icons via theme, not globally: defineTheme({icons: {close: <XMarkIcon />}}) scopes the swap to the active <Theme>; extends shallow-merges into derived themes. registerIcons() mutates a global registry and warns in dev: app bootstrap only, not a library theming seam.
- Size-aware artwork: a theme/registered entry may be a pure sync function of {size, variant}, e.g. info: ({size}) => <InfoIcon weight={size === 'sm' ? 'bold' : 'regular'} />. Icon passes its rendered size; getIcon/useIcon/getIconRegistry/theme.icons read it at md. A null result draws nothing (no fallback). No hooks, DOM measurement, or browser/mutable state.
- Pair icons with text labels for accessibility; icon-only elements need an accessible label.
- For a meaningful standalone icon (no adjacent text), set an accessible name via `label`: sets role="img" + aria-label, unhides icon.
- Use color tokens for icon colors, not hardcoded hex values.
- Be mindful of context; decorative icons in compact components can distract rather than help.

## Do not
- Use icons as the sole means of conveying meaning; always provide a text alternative.
- Resize icons with arbitrary pixel values; use the provided size props.
- Mix icon styles (e.g. outline and filled) within the same context.
- Render raw SVG elements; always wrap in Icon for consistent sizing and color.
- `name` prop, which does not exist. Use `icon` to specify which icon to render.
