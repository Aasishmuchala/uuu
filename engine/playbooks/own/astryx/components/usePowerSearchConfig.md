# usePowerSearchConfig
Group: PowerSearch. Category: utilities.
Import: import { usePowerSearchConfig } from '@astryxdesign/core';

Memoizes PowerSearch config from typed field definitions + returns applyFilters for client filtering. Automatically maps types (string, number, date, enum) to canonical operators.

## Do
- Declare definitions with as const outside component.
- Pass config to PowerSearch and use applyFilters for Table/List data.

## Do not
- Recreate field definitions inline on every render.

## See also
- PowerSearch
- Table
- useTableFilterState
- useTableFiltering
