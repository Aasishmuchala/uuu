# useLinkComponent
Group: Link. Category: utilities.
Import: import { useLinkComponent } from '@astryxdesign/core';

Resolves which component renders a link: as arg, else nearest LinkProvider's component, else native anchor. Custom components' links follow the app router like Astryx links. Checks href/to under the Link href rule: rejected => anchor with no destination, router never invoked. Custom components get to={href} unless to given.

## Do
- Use for links inside custom components so a router LinkProvider reaches them.
- Pass as='a' for destinations the router cannot handle (downloads, pages outside the app).

## Do not
- Import the router link directly in shared components; that skips LinkProvider and the destination check.

## See also
- Link
- LinkProvider
- useLinkify
