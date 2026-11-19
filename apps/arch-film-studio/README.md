# Arch Film Studio

Turns architectural renders into photoreal 4K stills, a storyboard and a film, in six stages:
Renders, Enhance, Review, Masters, Storyboard and Film. The app analyses and enhances each
render, keeps the ones you approve as locked masters, writes a storyboard from them, makes a clip
per shot, and cuts the approved clips into a film with ffmpeg on this Mac. It keeps its pictures
and documents on local disk, and makes stills and clips through the engine's generation door.

It came from a zip that held the contract (the project's data shapes and the prompts) and a
static picture of the six stages, and no pipeline. The six stages are written here, on that
contract and on the local layer Render to Film already proved. It is now part of this repo. It
runs only through `engine/apps/app-exec`, inside the App Studio fence, never by hand (`npm start`
and `node .build/index.mjs` outside the fence are not supported). Its manifest is `app.json`; its
dependencies are installed once into the state folder and linked in as `node_modules`, with
nothing downloaded: they are a copy of Render to Film's packages (same `pnpm-lock.yaml`).

`src/shared/project.ts` is the project contract, `src/server/prompts.ts` the prompts, and
`src/local/` the local layer that stands in for a hosted platform. Films are silent: the engine
has no music model, so the storyboard's music direction is kept as words.

## The screens

The page is drawn with the Astryx kit (`public/astryx/`, through `src/client/kit.ts`), dark, with
the owner's pictures as the only colour. A side bar lists the screens of the open project, each
with how far it has got ("9 of 14") or a lock and the reason. The address keeps the place
(`#/p/<project>/<screen>`), so a reload or Back lands where you were.

- **Projects**: every project as a card with its first four pictures, how many renders and
  masters it has, what it has cost so far, and "Film ready" once there is a film.
- **Overview**: the project's best picture, the six stages in a row, the one thing to do next,
  and the cost: what this project has spent (what the door accepted, by kind) and about what is
  left to finish. Below, every picture with its state; a click opens it where it needs you.
- **Renders**: drop the whole set of renders anywhere on the screen. Click a picture to see what
  the analysis saw and set its settings at the right; pick several to set them all at once.
- **Enhance**: pick pictures, choose the model, see the price beside the button, enhance. One
  press sends at most 20.
- **Review**: one picture large, the render and the made version side by side on a slider, every
  picture in a strip below, the versions and the three decisions at the right. The grid view
  approves several at once.
- **Masters**: the approved pictures and their sizes. Tick the ones to make; click one to see it
  full size and zoom to 100%. A locked master has its download beside it.
- **Storyboard**: the brief, then the shots as a strip as long as the film, each block as wide as
  its seconds. Drag a shot to move it. Below, the shot in front with its details and its clip.
- **Film**: plays the approved clips one after the other before anything is made, then
  "Assemble film" joins them on this Mac at no charge.

Every button that costs money shows its price first, on the same line, and stays held while its
call is out or while the pictures it would send are already being made. Jobs waiting to be sent
show a strip with "Cancel waiting" above every screen.

## The keys

Keys never act while you type in a field, and no key spends money.

- Everywhere: Cmd+K goes to any screen, picture or project by name; ? shows every key.
- Contact sheets: Shift-click picks a run, Cmd-click adds or takes away one, Cmd+A picks all in
  view, Escape lets go.
- Review: A approve, R reject, V write a revision note, Left and Right (or J and K) the previous
  and next picture, 1 to 9 a version, hold Space to see the render, F full size, U the next
  picture to decide, G the grid. "Make revised version" costs money, so it has no key.
- Storyboard: Alt+Left and Alt+Right move the shot in front; Left and Right move between shots.

## What the fence does not cover

The app has two halves. Its server runs inside the App Studio fence: it reaches no internet, no
port and none of the owner's files, and only the engine's socket gets out. Its page, built into
`dist/`, runs in the owner's own browser, and a page in a browser can still reach the internet,
as any web page can.

That is where the risk comes from. The app uses the same packages from the public registry
that Render to Film does, and the page is built from some of them. If one of them is bad, it can
send what the page holds (the renders, prompts, stills and clips the owner works with) off this
Mac from the browser, in some ways without a click. See docs/adr/0016, "What the fence does not
protect".

What the app does about it: it opens no window of its own. "Open full size" is a view inside the
app (`src/client/parts/FullSize.tsx`), a download stays a download, and
`src/client/no-popups.test.ts` fails if any client file calls `window.open` or names `_blank`.
Before adding or updating a package, read what it is and who publishes it.
