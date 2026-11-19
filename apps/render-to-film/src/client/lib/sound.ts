// The pure half of the lightbox's sound button (ui/LightboxSound.tsx), so a test can run it on plain Node.

/** What `startMuted` needs of a video (a test passes a plain object). */
export type Playable = { muted: boolean; defaultMuted: boolean; paused: boolean; play(): Promise<void> | void };

/**
 * Start a clip with its sound off, so it plays without a click: WebKit, and
 * so the Mac app's web view, holds back a clip that would start with sound.
 */
export function startMuted(video: Playable) {
  video.defaultMuted = true;
  video.muted = true;
  if (video.paused) void Promise.resolve(video.play()).catch(() => {});
}

/**
 * On a press or a key in the lightbox, ask a playing clip to play: WebKit
 * lets a clip that started muted by itself have its sound only after a play
 * asked for inside a person's gesture, so after this its own speaker control
 * (or anything else) can turn the sound on. A paused clip is left alone, so a
 * press on its own Play is not undone.
 */
export function blessPlaying(video: Playable | null) {
  if (video && !video.paused) void Promise.resolve(video.play()).catch(() => {});
}

/** The words on the sound button, by whether the clip is muted. */
export function soundLabel(muted: boolean): string {
  return muted ? 'Turn sound on' : 'Turn sound off';
}
