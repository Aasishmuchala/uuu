# TreeList
Group: TreeList. Category: Table & List.
Import: import { TreeList } from '@astryxdesign/core';

Data-driven tree list for hierarchical data w/ expand/collapse, branch lines, interactive items. Flat items array w/ recursive children, no composition, no cloneElement.

## Do
- Provide meaningful labels and icons for each node to make the hierarchy easy to scan.
- Pre-expand important branches so users see key content immediately.
- Leaf rows reserve space for a chevron column whenever the tree has any expandable item to line up under; only a fully flat tree (no expandable items at all) renders its rows flush. Rely on this rather than nudging indentation with custom CSS.

## Do not
- Nest more than 4–5 levels deep; flatten the structure or use a different pattern.
- Use a tree for flat, non-hierarchical data; use a List instead.

## Parts
- TreeList
