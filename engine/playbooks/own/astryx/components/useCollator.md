# useCollator
Category: utilities.
Import: import { useCollator } from '@astryxdesign/core';

Returns a memoized Intl.Collator bound to the active InternationalizationProvider locale.

## Do
- Reuse collator.compare in custom Table comparators and string sorting.

## Do not
- Construct raw Intl.Collator or call localeCompare directly.

## See also
- InternationalizationProvider
- Table
- useLocale
