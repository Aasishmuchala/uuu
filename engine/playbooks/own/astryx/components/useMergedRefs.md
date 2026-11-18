# useMergedRefs
Category: utility.
Import: import { useMergedRefs } from '@astryxdesign/core';

Combines object/callback refs into one stable callback ref. Identity changes only when an input ref changes, avoiding detach/attach churn from inline mergeRefs calls.

## Do
- Use for a forwarded ref plus internal measurement, focus, or anchor refs.

## Do not
- Call mergeRefs inline in JSX; it forces ref detach/attach on every render.
