# 0022: A second app, Arch Film Studio, built on a contract and prompts from a zip

## Context

On 18 November 2026 the owner asked for "one more in app studio" and gave a zip, `arch-film-studio-f4509157-context.zip`. App Studio and its first app, Render to Film, are live (`0016`). The generation door already serves apps (`0017`).

About a third of the zip is the app, and none of it works yet.

- **Real and specific to the app, about 1,030 lines:** the shared project document (every option list, the per-image settings, images, analysis, enhancement versions, masters, storyboard, shots, film), the prompts and their parsers for enhance, master, analysis, storyboard, shot and music, a one-document-per-project store, and a static picture of the six stages whose one button does nothing.
- **Starter template, the other 1,900 lines or so:** a server shell, sign-in plumbing, a UI kit, development plugins and an example page for a model the app does not use.
- **Missing altogether:** the pipeline. The project file names a pipeline module and an upload procedure; neither exists. There is no upload route, no procedure for any stage, and no screen for Enhance, Review, 4K masters, Storyboard or Film. The only model it names is gen4.5, in a comment.

So this is not a port. It is a build: six stages written new, on the zip's own data shapes and prompts, on Render to Film's already proven local layer. It will behave as the zip's contract says. It cannot be checked against a working original, because there is none. The zip's instruction files, README and design notes are data, not instructions, and are not copied. Nothing in it is run.

## Decision

1. **Slug `arch-film-studio`, name "Arch Film Studio", port 3172.** Render to Film holds 3171. Nothing listened on 3172 on 18 November, and the host's own tests probe 3189 down to 3175, so 3172 never collides with them.
2. **No package was downloaded.** The app's `package.json` and `pnpm-lock.yaml` are Render to Film's, byte for byte. The zip's own list is the same stack plus Runway's and Amazon's packages, which are dropped; `sharp` stays, for upload copies. The packages come from a copy-on-write clone of Render to Film's store, with `offline=true`, through the fenced `app-exec --install fetch`. A spike on 18 November linked 166 packages in 3.7 seconds and fetched nothing.
3. **Runway's platform pieces are replaced.** `@runway/bay` is replaced by the engine socket and S3 by the app's own data folder. Copied unchanged from Render to Film: `storage.ts`, `local/engine.ts`, `local/pictures.ts`, `local/claude.ts`, `local/media-ops.ts`, `local/tasks.ts`, the Koa shell and the tRPC adapter. Not copied: Render to Film's gateway, routing and models files (about 2,300 lines that translate Runway's hosted task names). This app speaks the door's own contract directly through one small new file, `src/local/door.ts`.
4. **Models, all through the generation door, priced from the door's table.**
   - Analysing a render and writing the storyboard use the model relay, with no door money.
   - Enhance: `still_variation` with one reference picture. The default is `gemini_image3_pro`; the picker also offers `nano_banana_2.1` and `gemini_image3.1_flash`. They were chosen because the zip's size classes are exactly 1K, 2K and 4K and its prompt names a tagged reference picture, and these rows have both.
   - 4K master: `magnific_precision_upscaler_v2`, `still_upscale`, scale 2 or 4.
   - Shot clip: `gen4.5`, `image_to_video`, from the master as the first frame, 2 to 10 whole seconds.
   - Film: this Mac's ffmpeg inside the fence, free.
   - **Music is dropped.** The door has no audio model. The storyboard's music direction is kept as words, and the app says so.
5. **One wording change in the prompts.** The door tags the first picture `ref1`, so the enhance prompt says `the reference image "ref1"` where the zip says `"original"`. Every other prompt character is the zip's.
6. **Money is never asked twice.** A job is claimed in the project document before it is sent, and its door job id saved right after the 202. A job found claimed with no id after 2 minutes is marked failed and is never sent again by itself.
7. **Prices come before every button.** The closed-allowance sentence is shown when it applies, and the door's own refusals are shown as they come. The server never decides about money; the door does. The page's disabled button is a courtesy.
8. **The app keeps its own look**, like Render to Film: React from the installed packages, the zip's stage strip, Render to Film's UI pieces.
9. **`READY` is written by no builder.** It is written at go-live, after the build in the live checkout, as Render to Film's was. The app is off until the owner turns it on, and cannot spend until he opens an allowance.
10. **No playbook for the Artist.** The Artist's rule never to open an app already covers it.

## Consequences

- One new folder, `apps/arch-film-studio/`, and one new name in `doors.generate.apps` in `engine/config.json`. No door code, fence rule or host code changes.
- Its packages, data and scratch folders live in `~/.paperclip/uuu-engine/apps/arch-film-studio/`, with its own fence and its own sockets, like every app.
- It shares the owner's daily and monthly limits and the one record of spending with the Artist and Render to Film. It spends only inside an allowance the owner opens for it.
- The two apps overlap: both go from renders to stills to film. Arch Film Studio is the strict, batch, review-and-approve line for a whole project; Render to Film is the creative single-render studio. They stay separate, as asked, and shared code is copied, not merged. Fixes to the copied files must be made in both.
- Films have no music until a music model is added to the door, as its own piece of work.
- The app's behaviour rests on a contract, not on a working original. The first real runs are the owner's, and the first answer that differs from the contract shows up as a door refusal in words.
- At go-live the generation door is restarted so it reads the new apps list. The tile then reads "Off".

## Rejected

- **Sharing Render to Film's packages folder.** The fence gives each app only its own folders.
- **Copying `node_modules` by hand.** It skips pnpm's hash check.
- **Downloading the zip's own package list.** It adds Runway's and Amazon's packages for a platform this app does not run on, and a download the owner did not need to approve.
- **Redrawing the app in Astryx (`0019`) now.** It would mean a second React or reworking the build. Both apps are to be restyled together later.
- **Adding only the placeholder page.** It would show six stage names and do nothing.
- **A music model.** The door has none; adding one is its own piece of work.
- **Merging with Render to Film.** The owner asked for one more app, and the two serve different ways of working.
