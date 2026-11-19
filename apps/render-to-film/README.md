# Render to Film

Turns a render into cinematic stills, clips and a finished film. The app plans shots, makes
stills and clips through the engine's generation door, and cuts and exports the film with
ffmpeg on this Mac. It keeps its pictures and documents on local disk.

It came from a hosted app and is now part of this repo. It runs only through
`engine/apps/app-exec`, inside the App Studio fence, never by hand (`npm start` and
`node .build/index.mjs` outside the fence are not supported). Its manifest is `app.json`; its
dependencies are installed once into the state folder and linked in as `node_modules`.

`design.md` describes the look and the parts. `src/local/` holds the local layer that replaces
the hosted platform.

## Screens

- **Make**
  - **Director**: add a project's images and a story; the app plans a storyboard. The board
    shows every frame in story order, ending in the film. Open a frame to set its light, camera
    and people, shoot it, compare it with your image and pick among its takes; open the film to
    turn the chosen frames into clips.
  - **Stills**: one render into a film still, with a look, a camera move, people, a marked area
    to change, a people check and upscaling.
  - **Video**: a still into a clip, with camera moves and extra frames.
  - **Close-ups**: the app finds the most cinematic details in a video, a still or an image
    and shoots each one as a close-up.
  - **Location**: a Google Earth screenshot into a photograph of the same place, with an
    optional upscale.
- **Finish**
  - **Edit**: the viewer over a timeline where width is time; trim, give each cut a look,
    talk to the AI editor, and export the film on this Mac.
- **Collect**
  - **Library**: everything made, with filters, tags, compare and delete.
  - **Favourites**: the starred stills and clips, by the render they came from.
  - **History**: every direction written, with "Use again".

Every Make screen shows takes along the bottom: tick two to four to compare them side by side,
star the ones to keep. Every button that spends shows its price first. `?` lists the keys;
`Cmd+K` jumps to any screen or picture.

## What the fence does not cover

The app has two halves. Its server runs inside the App Studio fence: it reaches no internet, no
port and none of the owner's files, and only the engine's socket gets out. Its page, built into
`dist/`, runs in the owner's own browser, and a page in a browser can still reach the internet,
as any web page can.

That is where the risk comes from. The app brought 164 packages from the public registry, and
the page is built from some of them. If one of them is bad, it can send what the page holds (the
renders, prompts, stills and clips the owner works with) off this Mac from the browser, in some
ways without a click. See docs/adr/0016, "What the fence does not protect".

What the app does about it: it opens no window of its own. "Open full size" is a view inside the
app (`src/client/ui/FullSize.tsx`), a download stays a download, and
`src/client/no-popups.test.ts` fails if any client file calls `window.open` or names `_blank`.
Before adding or updating a package, read what it is and who publishes it.
