# Render to Film: design system

How this app looks, what it is made of, and the rules a change to `src/client/` follows. Where
this file and the code disagree, fix one of them in the same change. The plan behind it is
PLAN-APPS-ASTRYX ("The shared look" and "Render to Film: what it is and its new layout").

## The look

A dark screening room: graphite surfaces, white type, the owner's pictures as the only colour.

- **The kit draws everything.** Buttons, fields, menus, dialogs, tabs, navigation, toasts and
  tooltips are Astryx parts, imported from `src/client/kit.ts` (never from the package by name).
  The kit is served from `public/astryx/`; the page is dark by `<html data-theme="dark">`.
- **Colour comes only from the kit's tokens** (`--color-*`). No hex, `rgb(` or `hsl(` in any
  file but `styles/studio.css`, which holds the face and the two scrims for text over a picture
  (`--studio-scrim`, `--studio-scrim-strong`). No gradient. The kit's accent marks the one
  primary action and what is selected, nothing else.
- **One face, Geist.** No mono face anywhere. Sentence case everywhere, no label above a
  heading, no upper-case labels, no 01/02/03 counters, no em dashes, no emoji. Times, sizes and
  prices use tabular figures (`.num` or `hasTabularNumbers`).
- **Motion** is 120 to 160 ms, opacity and position only, and off under
  `prefers-reduced-motion`.

`src/client/no-banned.test.ts` holds the banned list in the source and fails, naming the file
and line, on any of it.

## The shell

`App.tsx`: the kit's `AppShell` with a `SideNav` in three groups (Make: Director, Stills, Video,
Close-ups, Location; Finish: Edit; Collect: Library, Favourites, History) and a slim top bar: a
plain breadcrumb, "Jump to" (`Cmd+K`, the command palette over screens and pictures), Shortcuts
(`?`) and the allowance chip. The address keeps the screen (`#stills`; `#surroundings` still
means Location). Every screen fills the content area inside an error boundary.

## The workbench

The Make screens share one pattern, `parts/Workbench.tsx`, in three zones:

- **Controls** on the left, resizable: the choices in order as `BenchGroup`s (a plain heading,
  one line on what it does, the fields), ending in a sticky foot with the price and the one
  button.
- **The stage** in the middle, `parts/Stage.tsx`: the darkest surface, a small toolbar (title,
  how it was made, then compare, full size, star, download, reuse, "Make a video"), and the
  picture in a `StageFrame` at its true ratio, as large as the window allows. `StageWorking`
  shows progress on the picture's own frame; `StageEmpty` is one sentence and one action.
- **The take strip** along the bottom, `parts/TakeStrip.tsx`: every take of the session, newest
  first, click to put one on the stage, tick two to four to compare (`parts/CompareBoard.tsx`).

How each screen uses it:

| Screen | Controls | Stage | Strip |
|---|---|---|---|
| Director | The brief (images, story, model); a frame's light, camera, people and direction; or the film's settings | The board of frames in story order, ending in the film card; one frame large with "Compare with your image"; or the film's clips | The open frame's takes |
| Stills | Render, model, look, camera, people, direction | The take, with "Compare with render"; people check and upscale open beside it | The session's takes |
| Video | The picked still, model, camera, frames, direction | The player | The session's clips |
| Close-ups | The details found (cards), source, shots, model | The close-up picked | The search's close-ups |
| Location | Screenshot, place, view and light, model, upscale | The photograph over the screenshot; upscale opens beside it | Every location take |

**Edit** is its own layout: the viewer on top, the timeline full width below it (width is time,
a ruler in seconds, each cut a block with its picture), and a right panel with two tabs, Look
(the picked cut's trim, the looks drawn on its own picture, the adjustments, its version) and
Editor (the conversation and the memory). Export sits in Edit's top bar with its words.

## The parts

Own parts live in `src/client/parts/` and exist only where the kit has none:

| Part | What it does |
|---|---|
| `Workbench`, `BenchGroup`, `Note` | The Make screens' three zones and their groups |
| `Stage`, `StageFrame`, `StageWorking`, `StageEmpty` | The stage and its states |
| `TakeStrip` | Takes at their own shape, state as a dot with a word on hover |
| `CompareSlider` | Before and after in one frame, the divider a native range |
| `CompareBoard` | Two to four stills under one zoom and pan, or two clips in step |
| `MediaGrid` | A contact sheet; also the picker for stills, clips and looks to match |
| `FilterBar`, `DetailsPanel` | The Library's filters and inspector |
| `StarButton`, `useStar` | The favourite: the `favourite` tag through `setTags` |
| `OptionSelect` | The kit's selector over the app's own option lists |
| `ErrorNote` | A failed call's own sentence, beside the thing that failed |
| `RefField.module.css` | The cast sheet and lighting reference fields |

`ui/` keeps what is not a kit part: `ImageDropZone`, `MaskPainter`, `FullSize` (the kit's
`Lightbox`, inside the app), `ErrorBoundary`, and the money parts `Price` and `SpendingChip`.
The mask painter and the edit timeline keep their own pointer logic.

## The rules

- **The picture is the hero.** Pictures are shown whole at their true ratio, never cropped in a
  work view, on a surface one step darker than the page.
- **One primary button a view.** The price sits to the left of every spending button, on the
  same line, the same size of text (`Buy` with `useSpend` from `ui/Price.tsx`). A button that
  spends is held while its call is in flight, while its work runs, and while the allowance or
  the model says no; the reason shows under it.
- **No shortcut spends.** Keys never fire while a field has focus, and Enter in a field never
  starts a paid step: that takes a click, or Enter on the focused priced button. Every key is
  listed in the Shortcuts dialog.
- **Every state is designed.** Empty: one sentence and the one action. Loading: a `Skeleton` in
  the shape of the content. Working: progress on the picture's own frame. Error: a `Banner`
  beside what failed, one sentence, the next step in it.
- **Plain words.** A non-technical studio owner reads every label and sentence: no "pipeline",
  "job id" or "mutation".
- **Nothing leaves the app.** No address but the app's own `/trpc`, `/api` and `/files`; no
  window of its own (`no-popups.test.ts`); "Reuse settings", "Use again" and "Open in Edit"
  pass values through `sessionStorage`, checked before use, and only fill a form.
