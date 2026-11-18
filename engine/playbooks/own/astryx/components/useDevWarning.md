# useDevWarning
Category: utility.
Import: import { useDevWarning } from '@astryxdesign/core';

Dev-only "Component: message" console warning, once per mount while condition holds. Ref + effect, so it never repeats per render nor causes a re-render. Outside a component, use the imperative devWarn utility.

## Do
- Say what is wrong + what to do instead; the message is the value.
- Warn about combinations types cannot express (mutually exclusive props set together).

## Do not
- Use for user-visible problems / runtime error handling; it is dev-only.
