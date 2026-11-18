# Tab
Import: import { Tab } from '@astryxdesign/core';

Individual tab; renders as button or anchor w/ selected-state styling + optional icons.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| value | string |  | yes | Unique value matched against TabListContext.value. |
| label | string |  | yes | Accessible label; visible by default, aria-label when isLabelHidden. |
| isLabelHidden | boolean | false |  | Visually hide label for icon-only tabs; label becomes aria-label. |
| href | string |  |  | URL; renders as <a> when provided. |
| panelId | string |  |  | Id of the panel this tab controls, wired up as aria-controls where the TabList speaks the tabs pattern. Put the same id on the panel element. No effect under the navigation pattern, and a development warning says so. |
| as | LinkComponentType |  |  | Custom link component overriding LinkProvider; only w/ href. |
| icon | ReactNode |  |  | Icon shown when not selected. |
| selectedIcon | ReactNode |  |  | Icon shown when selected; falls back to icon. |
| endContent | ReactNode |  |  | Non-interactive content after the label (badge, status dot). No focusable control: explain a tab with a Tooltip anchored on the Tab (anchorRef, rendered after TabList) + a decorative info Icon here. |
| xstyle | StyleXStyles |  |  | StyleX styles for layout customization. Must be stylex.create() value, not inline style. |

## Example
```jsx
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Theme, defineTheme, useTheme} from '@astryxdesign/core/theme';
import {appTheme} from './theme';

// Without a nested Theme, the selected indicator spans the tab's content and
// stops at its inline padding. An editor-style strip can run it edge to edge by restyling
// the tab-indicator target in a nested Theme. Only this strip changes: every
// other TabList keeps the app theme's indicator. insetInline is not a
// guaranteed property of the tab-indicator target, so treat this override as
// best effort across releases.
const fullWidthIndicatorTheme = defineTheme({
  name: 'full-width-tab-indicator',
  extends: appTheme,
  components: {
    'tab-indicator': {
      base: {insetInline: '0'},
    },
  },
});

// An open-files bar switches views, so it uses TabList's navigation pattern
// (no role="tablist"). The nested Theme takes the app's color mode.
function EditorTabs() {
  const {mode} = useTheme();
  return (
    <Theme theme={fullWidthIndicatorTheme} mode={mode}>
      <TabList value="app" onChange={() => {}} aria-label="Open files" size="sm" hasDivider>
        <Tab value="app" label="App.tsx" />
        <Tab value="styles" label="styles.css" />
      </TabList>
    </Theme>
  );
}
```
