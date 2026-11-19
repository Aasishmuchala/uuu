import { z } from 'zod';

// zod tries `new Function` once, when the first schema is built, to see whether it may compile
// its checks. App Studio's policy (script-src 'self') refuses it, and the refusal shows as a
// policy violation on every load. Told here not to try; main.tsx imports this module before any
// module that builds a schema. Checks run the same, without compiling.
z.config({ jitless: true });
