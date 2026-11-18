# useLocale
Category: utilities.
Import: import { useLocale } from '@astryxdesign/core';

Returns the active InternationalizationProvider locale, falling back to 'en' without a provider.

## Do
- Thread this locale into pure helpers requiring an explicit locale.

## Do not
- Fall back to navigator.language or a hardcoded display locale.

## See also
- InternationalizationProvider
- useCollator
- useTranslator
- useDirection
