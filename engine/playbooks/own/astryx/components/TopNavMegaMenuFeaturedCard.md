# TopNavMegaMenuFeaturedCard
Import: import { TopNavMegaMenuFeaturedCard } from '@astryxdesign/core';

Standard featured card for mega menu featured slot. Optional image, title, description, CTA link.

## Props
| Prop | Type | Default | Needed | What it does |
|---|---|---|---|---|
| title | string |  | yes | Card title. |
| description | string |  |  | Description below title. |
| image | string |  |  | Image URL above body. |
| imageAlt | string |  |  | Image alt text. Omitted → explicitly decorative (hidden from screen readers); usually correct since card has visible title. |
| linkLabel | string |  |  | CTA link text. |
| linkHref | string |  |  | CTA link URL. |
| children | ReactNode |  |  | Custom content below standard body. |
