# Render to Film

Turns a render into cinematic stills, clips and a finished film. The app plans shots, makes
stills and clips through the engine's generation door, and cuts and exports the film with
ffmpeg on this Mac. It keeps its pictures and documents on local disk.

It came from a hosted app and is now part of this repo. It runs only through
`engine/apps/app-exec`, inside the App Studio fence, never by hand (`npm start` and
`node .build/index.mjs` outside the fence are not supported). Its manifest is `app.json`; its
dependencies are installed once into the state folder and linked in as `node_modules`.

`design.md` describes the screens. `src/local/` holds the local layer that replaces the
hosted platform.
