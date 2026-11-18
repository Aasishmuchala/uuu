# The journey, the grammar, the feeling and the signature move

Adapted from scroll-craft's skill and its pages on structure and feeling (MIT, Nate Herk). Plan in this order and
write each part into the goal's notes before you build. The goal and the company's files are the brief: read them,
and where they do not say, decide and say plainly that you decided.

## 1. The journey

Four to seven beats, each one a change in what the visitor knows or feels. For example:

| Beat | What changes |
|---|---|
| Recognition | They see their own situation |
| Tension | What it costs them, said plainly |
| Turn | The thing that changes it |
| Substance | Why it holds up |
| Range | What they can choose |
| Commitment | The one action |

Sections serve beats. A section that serves no beat is cut, however good its picture is. One action for the
visitor, with one label, used everywhere on the page.

## 2. The grammar

A grammar is how the page is organised: what a section is, how the visitor knows where they are, how it ends. Pick
one and keep to what it forbids; two pages in one grammar feel related whatever their colours.

- **Filmic one-shot.** One linear argument carried like a film. Pinned and scrubbed acts, a strong open, a close that
  holds. Forbids: a menu of sections, counters of where you are.
- **Chaptered editorial.** A printed feature: chapters with full-stop intertitles, long reading, grounds that change
  on a hard edge. Forbids: pinned spectacle in every chapter.
- **Live surface.** The page behaves like the product: panels fill, a list grows, driven by the scroll. For tools
  and software. Forbids: a picture of the product standing in for it.
- **Typographic poster.** Type is the imagery: scale, weight and placement do what photographs would. Right when the
  brand's asset is a sentence, or when there are no good pictures. Forbids: stock-looking pictures.
- **Gallery or catalogue.** Objects in a collection with short labels: a range, a portfolio, a menu, projects.
  Sideways travel suits it. Forbids: selling copy on every object.
- **Split stage.** Two columns held against each other the whole way (before and after, by hand and done for you),
  resolved by the scroll. Forbids: sections that drop one side.
- **Rhythmic cutlist.** Many short acts on hard cuts, no pinning, no lingering. For energy brands. Forbids: dwell,
  crossfades, long pins.

The "continuous world" grammar of the original (one fixed stage the whole page flies through) needs a chain of clips
and a fixed stage that cannot show every part when less motion is asked; it is not used here.

## 3. The feeling and the peak

Before choosing any device, write one line per act: the feeling, then what on the screen causes it. Two acts in a
row with the same feeling means one is filler: cut it now. Name the one moment the visitor should remember, the peak:
it gets the best pictures, the most scroll room and a quieter act before it. Then the tell-someone sentence: "It is
the site where ___", filled with an experience, not a device's name. The last screen resolves and holds; it never
fades to nothing or turns into a footer.

## 4. The signature move

One interaction that belongs to this page alone, written in the page's own code from the act's progress (each act
publishes `--sc-p`, 0 to 1, that CSS can read with `calc()`). A line drawing that draws itself as the visitor
scrolls; a small ledger that adds a line for every claim passed, with real figures only; one control that changes
every picture and ground at once. It is not a device's setting changed, a second spotlight, or more of a device the
page already has. Never change scroll-craft's files to get it.

## 5. The score

Give each beat a device and write it as a table: beat, device, why this one. Before building, check:

- four or more device families on the page, and never the same one twice in a row;
- at most two scrubbing acts (a clip is the heaviest thing on the page);
- the peak has the largest span by a visible margin;
- every act earns its scroll: never add pinned room to make a page longer;
- most of the page is ordinary sections, so the moving ones land.

## Never

| Never | Instead |
|---|---|
| A "scroll down" cue, arrow or mouse icon | Nothing: they know how to scroll |
| `01 / 06` counters of where they are | Leave them out |
| A small label above every heading | At most one in three sections |
| Centred copy in every act | Vary it: lead, trail, centre, split |
| The same device twice in a row | Score the journey again |
| Invented numbers in a counter | Real figures only; no figure, no counter |
| Words drawn into a picture | Real words in the page |
| A dark layer over the whole picture for contrast | A scrim only where the words sit |
| `transition: all`, or moving width, height, top or left | `transform` and `opacity`; `clip-path` for wipes |
| Gradient text, glow, coloured halos | Weight and size for emphasis |
| Sound of any kind | None |
