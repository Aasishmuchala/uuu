// The pure half of the lightbox's sound button (ui/LightboxSound.tsx), so a test can run it on plain Node.

/** What `startMuted` needs of a video (a test passes a plain object). */
export type Playable = { muted: boolean; defaultMuted: boolean; paused: boolean; ended?: boolean; loop?: boolean; play(): Promise<void> | void };

/**
 * Start a clip with its sound off, so it plays without a click: WebKit, and
 * so the Mac app's web view, holds back a clip that would start with sound.
 * A take is a few seconds long, so it loops while it is on show.
 */
export function startMuted(video: Playable) {
  video.defaultMuted = true;
  video.muted = true;
  video.loop = true;
  if (video.paused) void Promise.resolve(video.play()).catch(() => {});
}

/**
 * On a press or a key in the lightbox, ask a playing clip to play: WebKit
 * lets a clip that started muted by itself have its sound only after a play
 * asked for inside a person's gesture, so after this its own speaker control
 * (or anything else) can turn the sound on. A clip paused part way is left
 * alone, so a press on its own Play is not undone; one at its end starts again.
 */
export function blessPlaying(video: Playable | null) {
  if (video && (!video.paused || video.ended)) void Promise.resolve(video.play()).catch(() => {});
}

/** The words on the sound button, by whether the clip is muted. */
export function soundLabel(muted: boolean): string {
  return muted ? 'Turn sound on' : 'Turn sound off';
}
