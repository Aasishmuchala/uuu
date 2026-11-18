# Arch Film Studio

Turns architectural renders into photoreal 4K stills, a storyboard and a film, in six stages:
Upload, Enhance, Review, 4K masters, Storyboard and Film. The app analyses and enhances each
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
app (`src/client/ui/FullSize.tsx`), a download stays a download, and
`src/client/no-popups.test.ts` fails if any client file calls `window.open` or names `_blank`.
Before adding or updating a package, read what it is and who publishes it.
