# Stack
Group: Layout. Category: Layout.
Import: import { Stack } from '@astryxdesign/core';

Stack layout primitives for horizontal/vertical sequences using flexbox w/ themed spacing tokens.

## Do
- Use the gap prop for spacing between items; don't add margins manually.
- Use StackItem with size="fill" to make one item stretch and fill the leftover space.

## Do not
- Nest stacks inside stacks; try wrap="wrap" first to let items flow to the next line.

## Parts
- Stack
- HStack
- VStack
- StackItem
