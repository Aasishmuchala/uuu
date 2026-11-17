# The loft's pictures: where they came from

Everything the Map and Needs you show as their stage is served from this tree. Nothing is fetched at run time from anywhere else.

The owner's own generated images (made with Higgsfield for the owner, 17 November 2026; the owner chose photographs over 3D on 18 Nov 2026). They belong to the owner and are used here by the owner's choice; no third-party licence applies.

- `loft-dusk`: an isometric cutaway of a two-level brick warehouse loft studio at dusk (the Map, dark theme).
- `loft-morning`: the same loft and camera in golden morning light (the Map, light theme).
- `desk-dusk`: the owner's oak desk on the loft's mezzanine at dusk (Needs you, dark theme).
- `desk-morning`: the same desk in golden morning light (Needs you, light theme).

The set in `v1/` is listed file by file, with its size, its pixels and its SHA-256, in `v1/manifest.json`. A file in `v1/` is never edited in place: a changed set is a new folder (`v2`). Each picture was made from the 5504 x 3072 PNG with cwebp only: 2560 and 1600 px wide at quality 88 (desktop), 900 px wide at quality 86 (phone), `-m 6 -sharp_yuv -metadata none`. Each `-ground.webp` is 3 x 3 pixels, lossless: for the loft the plain backdrop's colour sampled at the picture's corners and edges, for the desk the picture made tiny.

A 5 second loop of the dusk loft (`loop-dusk.mp4`) may join the set later; it is not here yet, and no page asks for it until it is (office/assets.js `VIDEO`).
