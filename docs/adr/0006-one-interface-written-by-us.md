# 0006: One interface written by us

## Context

The owner likes LobeHub and asked us to study Open WebUI, Cherry Studio, Jan, Kestra and MetaGPT as well. We could run one of them, or write our own and borrow their ideas. Licences differ and none of the apps is built for this engine's gate and fence.

## Decision

One interface, written by us. We borrowed ideas and layout. We copied no code, no logo and no artwork.

- **LobeHub**: Needs you, tasks with states, acceptance by evidence, the Home order, the calm design language. Its community licence forbids derivative works of its code without a commercial licence.
- **Open WebUI**: approval as a stop with Allow and Deny, grouped inbox, run history. Licence with a branding clause.
- **Cherry Studio**: the work view, file cards, approval cards in the stream. AGPL.
- **Jan**: approval inside the item's own card, plan first. Apache-2.0.
- **Kestra**: a timeline of steps, one small file per routine, a gallery of ready-made goals. Apache-2.0. Not run (about 4 GB of memory).
- **MetaGPT** (MIT): see 0005.

The font is Geist, SIL Open Font Licence 1.1, by Vercel with basement.studio. The ten avatars are Microsoft Fluent Emoji in the 3D style, MIT, scaled to 128 px. Licence files sit beside them in `engine/home/public/assets/`. Preact and htm are vendored with their licences (see 0003).

Aseprite is not installed. Its licence lets one person compile it for personal use, and does not let the engine ship or run it. The Artist draws with its own Python and Pillow instead. Sprite data follows Aseprite's `json-array` shape, which is a file format, not code.

## Consequences

- We own the interface and must keep it up to date.
- Running the others as extra chat windows stays a later option (see the owner's guide).
- If the owner later buys or compiles Aseprite for their own use, previews of its files can be added.

## Rejected

- Running LobeHub: its licence forbids derivative works, and its stack does not fit this Mac.
- Copying any code or artwork.
- Running Kestra now: paperclip already has routines.
