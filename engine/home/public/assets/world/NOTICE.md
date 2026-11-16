# The world's assets: where each came from and under what licence

Everything the Map and Needs you draw in 3D is served from this tree. Nothing is fetched at run time from anywhere else.

The set in `v1/` is listed file by file, with its size and SHA-256, in `v1/manifest.json`. A file in `v1/` is never edited in place: a changed set is a new folder (`v2`).

## three.js 0.169.0 (MIT)

In `vendor/three-0.169.0/`: `three.module.min.js`, `jsm/GLTFLoader.js` and `jsm/BufferGeometryUtils.js`, from the three 0.169.0 npm package, with its `LICENSE` beside them.

Copyright © 2010-2024 three.js authors. Released under the MIT License.

## Poly Haven assets (CC0 1.0)

Got from Poly Haven on 16 November 2026 with the owner's yes. Each is dedicated to the public domain under CC0 1.0 Universal. Listed by their Poly Haven names.

Textures (`v1/tex/1k/`, `v1/tex/512/`):
- `wood_floor`
- `wood_floor_deck`
- `concrete_floor_02`
- `planks_brown_10`
- `white_plaster_02`
- `forest_ground_04`
- `forrest_ground_01`

Skies (`v1/sky/`):
- `belfast_sunset_puresky` (dusk, the dark theme)
- `kloppenheim_06_puresky` (golden morning, the light theme)

Models (`v1/models/`, glTF with their own `.bin` and textures):
- `fern_02`
- `grass_medium_01`
- `modern_arm_chair_01`
- `modern_coffee_table_01`

## Tree atlases (CC0 1.0)

`v1/trees/trees_color.webp`, `trees_color_half.webp`, `trees_normal_half.webp` and `trees.json` were baked by us from Poly Haven's `fir_tree_01` and `fir_sapling_medium` (both CC0 1.0). They are offered under CC0 1.0 as well.

## Wall prints (our own)

`v1/prints/` holds our own renders of the Lake House prototype.
