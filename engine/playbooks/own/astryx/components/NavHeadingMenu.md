# NavHeadingMenu
Group: Navigation. Category: Navigation.
Import: import { NavHeadingMenu } from '@astryxdesign/core';

Accessible menu container + items for nav heading popovers. NavHeadingMenu = role="menu" w/ keyboard nav; NavHeadingMenuItem renders selectable items.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| children | ReactNode |  | yes | Menu items. |
| size | 'sm' \| 'md' \| 'lg' | 'md' |  | controls min-width + item padding |
| minWidth | number \| string |  |  | minimum width override |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |
