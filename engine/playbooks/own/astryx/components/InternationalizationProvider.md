# InternationalizationProvider
Group: Utilities. Category: Utility.
Import: import { InternationalizationProvider } from '@astryxdesign/core';

Wraps app to set active locale and (optionally) merge translation catalogs + per-locale overrides. Astryx components resolve strings against this context; missing keys fall back to shipped English.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| locale | string |  | yes | BCP 47 language tag (e.g. "en", "pt-BR"); regional tags fall back to base language then "en" |
| messages | ProviderMessagesByLocale |  |  | map of BCP 47 tag to a rich Catalog or generated RuntimeCatalog; "en" is always available |
| overrides | Overrides |  |  | sparse per-locale key overrides applied on top of shipped defaults |
| dir | 'ltr' \| 'rtl' |  |  | Explicit text-direction override for the context. When omitted, direction is derived from `locale` via `Intl.Locale.getTextInfo()`. This sets the direction Astryx reads, but it does NOT set the DOM `dir` attribute; you must set `dir` on `<html>` (or a wrapping element) yourself, since Astryx components mirror layout and directional icons from the DOM `dir`, not from this prop. Set both to the same value and keep them in sync. |
| calendar | 'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura' |  |  | calendar system for Calendar, DateInput, DateRangeInput, DateTimeInput, Timestamp, PowerSearch, and Schedule dates (default: gregory; a -u-ca- keyword in locale does not select it); values stay Gregorian ISO; non-Gregorian-aligned calendars need Temporal |
| children | ReactNode |  | yes | Content to render with the internationalization provider. |

## Do
- Use shipped Astryx locale catalogs from `@astryxdesign/core/locales/*` when one exists for your target locale.
- Use a same-shape local catalog only when Astryx has not shipped that locale yet or you are testing in-progress translations.
- Use real BCP 47 tags such as `fr-FR`, `pt-BR`, or `ar-SA`; regional locales fall back to their base language before English.
- Set the `dir` attribute on `<html>` (or a wrapping element) yourself; the provider does not set it. Astryx components mirror layout and directional icons from the DOM `dir`, so an RTL locale won't visually mirror without it. Use `getLocaleDirection(locale)` to derive the value for both the provider and the DOM.
- Set `calendar` to show `Calendar`, `DateInput`, `DateRangeInput`, and `DateTimeInput` in another calendar system and write Timestamp, PowerSearch, and Schedule dates in it. A locale never selects the calendar: `fa-IR` shows Gregorian dates until you set `calendar="persian"`, and a `-u-ca-` keyword in `locale`, as in `th-TH-u-ca-buddhist`, keeps Gregorian dates too. Date values stay Gregorian ISO strings.

## Do not
- Cast custom catalog maps to `any`; the i18n package exports `ProviderMessagesByLocale`, `MessagesByLocale`, `Catalog`, and `RuntimeCatalog` for local catalog typing.

## Example
```jsx
import type {ReactNode} from 'react';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import frFR from '@astryxdesign/core/locales/fr-FR.generated.js';

export function AppI18n({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider locale="fr-FR" messages={{'fr-FR': frFR}}>
      {children}
    </InternationalizationProvider>
  );
}
```
