# Check it here

A scroll page has no single state: every position is a different frame. Check it with what this engine has, and say
plainly what that did not cover.

## The page viewer

Render the site with the page viewer as for any page. It opens the page at 1280 px and at 390 px, takes its whole-page
pictures with less motion asked (every part shown, as `motion.md` says) and measures the page again with no motion
preference, as most visitors have it. In `report.json`, for each page:

- `errors` empty. A scroll-craft warning that a stage will not pin is a sign that something sets `position` on it.
- `blocked` empty: the page asked for nothing outside itself. `missing` empty: every picture, clip and file is there.
- `wider` empty at both widths: nothing runs past the screen with less motion asked. A rail that does is not
  wrapping: check its items' widths.
- `drawn_late` false on an Astryx page.
- The colours are the brand kit's, the faces are the kit's two, and no text is under the kit's smallest size.

Then look at both pictures: every act is there, in order, readable, with its scrim where the words sit on a
picture.

## The brand check

Run it before you report. On a scroll-craft site it also compares `scrollcraft/` with the kit's list
(`kit_file_changed`) and refuses `data-sc-drift` and `sc-grain` (`colour_not_token`). Every other rule reads the
page's own files as usual; on an Astryx page the words in `app.js` are checked like any words.

## What the pictures cannot show

The pictures are the page with less motion asked. The moving page is only measured, not pictured, so check these by
reading the page's code against `devices.md`, and say in the report that you did:

- the opening act's first cue greets, so the first screen has its heading;
- every act but the last ends its last cue at 1; the last one holds;
- cue windows overlap, so no pinned screen is ever empty;
- each rail is wider than the screen at 1280 px by at least half a screen, so it has somewhere to travel;
- no magnet, parallax and cue share one element;
- each pinned act has a ground or a greeting cue from its first pixel.

## The report

Say the grammar and why, the journey, the feeling curve and its peak, the score (device per beat), the signature
move, the pictures and clips you used and where they came from, what the viewer and the brand check said, and what
you could not check (the moving page by eye, a real phone).
