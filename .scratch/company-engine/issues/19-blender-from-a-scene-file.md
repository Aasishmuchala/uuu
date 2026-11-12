# 19: Blender from a scene file

**What to build:** Property reveals and simple 3D clips made by Blender, run outside the fence on the owner's side, from a data-only scene file (boxes, materials, a camera path) written by an agent. Blender cannot start inside the fence (decision record 0009). A script of ours reads the scene file with limits and runs Blender with automatic scripts off. No agent Python ever runs. This reads agent files with the owner's rights, so it must follow decision record 0007.

**Blocked by:** none

**Status:** needs-triage

**Plan tasks:** none (left for later by version 3, 12 November 2026)

- [ ] The scene file format is fixed, bounded and checked before anything runs
- [ ] No text from the scene file is run as code
- [ ] The result lands in the room's video folder and shows in the Studio
- [ ] A hidden check tries a planted link and an oversize scene
- [ ] The proof still holds
