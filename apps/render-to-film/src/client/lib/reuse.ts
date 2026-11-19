/**
 * "Use again" (History) and "Reuse settings" (Library, the stage) pass a take's settings to
 * Stills or Video through `sessionStorage`, as the picked still already travels. They only
 * fill the form: nothing is sent until the owner presses the priced button there.
 *
 * A preset is read once, then removed, and every value is checked against the app's own option
 * lists before use. Anything unknown is dropped, and the form keeps its own value for it.
 */
import type { Clip, Still } from '../../api.ts';
import { ACTIVITIES, AGES, ANGLES, CROWDS, ETHNICITIES, LOOKS, WARDROBES } from '../../looks.ts';
import {
  IMAGE_MODELS,
  imageAspectOptions,
  imageResolutions,
  MATCH_RENDER,
  MOTIONS,
  MOVE_STYLES,
  SPEEDS,
  VIDEO_MODELS,
  videoDurations,
  videoResolutions,
  type ImageModelId,
  type VideoModelId,
} from '../../models.ts';

/** Longest extra direction the server takes, in characters (src/api.ts). */
const DIRECTION_MAX = 600;
/** Longest people note the Stills form takes. */
const PEOPLE_MAX = 400;

export type StillPreset = {
  imageModel: string;
  resolution?: string | undefined;
  aspectRatio: string;
  look: string;
  angle: string;
  crowd: string;
  people: string;
  ethnicity?: string | undefined;
  age?: string | undefined;
  wardrobe?: string | undefined;
  activity?: string | undefined;
  direction: string;
  /** The render the take was made from: a kept upload of this app, at its own size. */
  source?: { url: string; width: number; height: number } | undefined;
};

export type ClipPreset = {
  stillId: string;
  videoModel: string;
  resolution?: string | undefined;
  motion: string;
  moveStyle?: string | undefined;
  speed?: string | undefined;
  seconds?: number | undefined;
  direction: string;
};

/** The form values a still was made with. */
export function stillPreset(still: Still): StillPreset {
  return {
    imageModel: still.imageModel,
    resolution: still.resolution,
    aspectRatio: still.aspectRatio ?? MATCH_RENDER,
    look: still.look,
    angle: still.angle,
    crowd: still.crowd,
    people: still.people,
    ethnicity: still.ethnicity,
    age: still.age,
    wardrobe: still.wardrobe,
    activity: still.activity,
    direction: still.direction,
    source: { url: still.sourceUrl, width: still.width, height: still.height },
  };
}

/** The form values a clip was made with, and the still it started on. */
export function clipPreset(clip: Clip): ClipPreset {
  return {
    stillId: clip.stillId,
    videoModel: clip.videoModel,
    resolution: clip.resolution,
    motion: clip.motion,
    moveStyle: clip.moveStyle,
    speed: clip.speed,
    seconds: clip.seconds,
    direction: clip.direction,
  };
}

type Kind = 'still' | 'clip';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (kind: Kind) => `render-to-film:preset:${kind}`;

function defaultStore(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function savePreset(kind: 'still', preset: StillPreset, store?: Store | null): void;
export function savePreset(kind: 'clip', preset: ClipPreset, store?: Store | null): void;
export function savePreset(kind: Kind, preset: StillPreset | ClipPreset, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(key(kind), JSON.stringify(preset));
  } catch {
    // Private mode: "Use again" then opens the screen without filling it.
  }
}

export function takePreset(kind: 'still', store?: Store | null): Partial<StillPreset> | null;
export function takePreset(kind: 'clip', store?: Store | null): Partial<ClipPreset> | null;
export function takePreset(
  kind: Kind,
  store: Store | null = defaultStore()
): Partial<StillPreset> | Partial<ClipPreset> | null {
  let raw: unknown;
  try {
    const text = store?.getItem(key(kind)) ?? null;
    store?.removeItem(key(kind));
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return kind === 'still' ? checkStill(raw as Record<string, unknown>) : checkClip(raw as Record<string, unknown>);
}

const oneOf = (list: ReadonlyArray<{ id: string }>, v: unknown): string | undefined =>
  typeof v === 'string' && list.some((o) => o.id === v) ? v : undefined;

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined;

/** Only this app's own kept uploads: `/files/` and a plain path, nothing that leaves the app. */
const FILES_PATH = /^\/files\/[A-Za-z0-9._~/-]{1,400}$/;

function checkSource(v: unknown): StillPreset['source'] {
  if (typeof v !== 'object' || v === null) return undefined;
  const { url, width, height } = v as Record<string, unknown>;
  if (typeof url !== 'string' || !FILES_PATH.test(url) || url.split('/').includes('..')) return undefined;
  const size = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20_000;
  return size(width) && size(height) ? { url, width: width as number, height: height as number } : undefined;
}

/** Drops keys whose value is undefined, so a partial preset holds only what it fills. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function checkStill(r: Record<string, unknown>): Partial<StillPreset> {
  const imageModel = oneOf(IMAGE_MODELS, r.imageModel) as ImageModelId | undefined;
  return defined<StillPreset>({
    imageModel: imageModel as string,
    resolution: imageModel ? oneOf(imageResolutions(imageModel), r.resolution) : undefined,
    aspectRatio: (imageModel ? oneOf(imageAspectOptions(imageModel), r.aspectRatio) : undefined) as string,
    look: oneOf(LOOKS, r.look) as string,
    angle: oneOf(ANGLES, r.angle) as string,
    crowd: oneOf(CROWDS, r.crowd) as string,
    people: text(r.people, PEOPLE_MAX) as string,
    ethnicity: oneOf(ETHNICITIES, r.ethnicity),
    age: oneOf(AGES, r.age),
    wardrobe: oneOf(WARDROBES, r.wardrobe),
    activity: oneOf(ACTIVITIES, r.activity),
    direction: text(r.direction, DIRECTION_MAX) as string,
    source: checkSource(r.source),
  });
}

function checkClip(r: Record<string, unknown>): Partial<ClipPreset> {
  const videoModel = oneOf(VIDEO_MODELS, r.videoModel) as VideoModelId | undefined;
  const seconds =
    videoModel && typeof r.seconds === 'number' && videoDurations(videoModel).includes(r.seconds)
      ? r.seconds
      : undefined;
  return defined<ClipPreset>({
    stillId: (typeof r.stillId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(r.stillId) ? r.stillId : undefined) as string,
    videoModel: videoModel as string,
    resolution: videoModel ? oneOf(videoResolutions(videoModel), r.resolution) : undefined,
    motion: oneOf(MOTIONS, r.motion) as string,
    moveStyle: oneOf(MOVE_STYLES, r.moveStyle),
    speed: oneOf(SPEEDS, r.speed),
    seconds,
    direction: text(r.direction, DIRECTION_MAX) as string,
  });
}
