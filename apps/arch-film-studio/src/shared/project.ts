/**
 * The project contract shared by the server (src/api.ts, src/pipeline.ts) and
 * the client. Pure TypeScript + zod — no Node or browser APIs — so both sides
 * import the same option lists, defaults and shapes.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-image settings (Phase 2 dropdowns A–G)
// ---------------------------------------------------------------------------

export const FIDELITY_MODES = ['strict', 'selective'] as const;
export type FidelityMode = (typeof FIDELITY_MODES)[number];

export const FIDELITY_LABELS: Record<FidelityMode, string> = {
  strict: 'Strict image-only',
  selective: 'Selective additions',
};

export const LIGHTING_OPTIONS = [
  'preserve',
  'natural-daylight',
  'bright-midday',
  'soft-morning',
  'golden-hour',
  'cinematic-sunset',
  'dusk',
  'blue-hour',
  'night',
  'custom',
] as const;
export type LightingOption = (typeof LIGHTING_OPTIONS)[number];
export const LIGHTING_LABELS: Record<LightingOption, string> = {
  preserve: 'Preserve original',
  'natural-daylight': 'Natural daylight',
  'bright-midday': 'Bright midday',
  'soft-morning': 'Soft morning',
  'golden-hour': 'Golden hour',
  'cinematic-sunset': 'Cinematic sunset',
  dusk: 'Dusk',
  'blue-hour': 'Blue hour',
  night: 'Night',
  custom: 'Custom',
};

export const PEOPLE_OPTIONS = [
  'none',
  'athletic-men',
  'athletic-women',
  'couples',
  'families',
  'children',
  'teenagers',
  'elderly',
  'wealthy',
  'luxury-lifestyle',
  'mixed',
  'custom',
] as const;
export type PeopleOption = (typeof PEOPLE_OPTIONS)[number];
export const PEOPLE_LABELS: Record<PeopleOption, string> = {
  none: 'No people',
  'athletic-men': 'Athletic men',
  'athletic-women': 'Athletic women',
  couples: 'Couples',
  families: 'Families',
  children: 'Children',
  teenagers: 'Teenagers',
  elderly: 'Elderly',
  wealthy: 'Wealthy individuals',
  'luxury-lifestyle': 'Luxury lifestyle',
  mixed: 'Mixed',
  custom: 'Custom',
};

export const ACTIVITY_OPTIONS = [
  'walking',
  'sitting',
  'relaxing',
  'socialising',
  'exercising',
  'swimming',
  'playing',
  'dining',
  'interacting',
  'custom',
] as const;
export type ActivityOption = (typeof ACTIVITY_OPTIONS)[number];
export const ACTIVITY_LABELS: Record<ActivityOption, string> = {
  walking: 'Walking',
  sitting: 'Sitting',
  relaxing: 'Relaxing',
  socialising: 'Socialising',
  exercising: 'Exercising',
  swimming: 'Swimming',
  playing: 'Playing',
  dining: 'Dining',
  interacting: 'Interacting',
  custom: 'Custom',
};

export const ADDITION_OPTIONS = ['animals', 'vehicles', 'lifestyle', 'other'] as const;
export type AdditionOption = (typeof ADDITION_OPTIONS)[number];
export const ADDITION_LABELS: Record<AdditionOption, string> = {
  animals: 'Animals / pets',
  vehicles: 'Vehicles',
  lifestyle: 'Lifestyle elements',
  other: 'Other',
};

export const ENHANCEMENT_KEYS = [
  'materialRealism',
  'texture',
  'reflections',
  'shadows',
  'vegetation',
  'exposure',
  'colourGrading',
  'finalPhotorealism',
] as const;
export type EnhancementKey = (typeof ENHANCEMENT_KEYS)[number];
export const ENHANCEMENT_LABELS: Record<EnhancementKey, string> = {
  materialRealism: 'Material realism',
  texture: 'Texture',
  reflections: 'Reflections',
  shadows: 'Shadows',
  vegetation: 'Vegetation',
  exposure: 'Exposure / dynamic range',
  colourGrading: 'Colour grading',
  finalPhotorealism: 'Final photorealism',
};

export const OUTPUT_OPTIONS = ['original', '4k', 'custom'] as const;
export type OutputOption = (typeof OUTPUT_OPTIONS)[number];
export const OUTPUT_LABELS: Record<OutputOption, string> = {
  original: 'Original resolution',
  '4k': '4K',
  custom: 'Custom resolution',
};

const customText = z.string().max(400, 'Keep custom text under 400 characters.');

export const imageSettingsSchema = z.object({
  mode: z.enum(FIDELITY_MODES),
  lighting: z.enum(LIGHTING_OPTIONS),
  lightingCustom: customText,
  people: z.array(z.enum(PEOPLE_OPTIONS)),
  peopleCustom: customText,
  activities: z.array(z.enum(ACTIVITY_OPTIONS)),
  activitiesCustom: customText,
  additions: z.array(z.enum(ADDITION_OPTIONS)),
  additionsOther: customText,
  enhancements: z.record(z.enum(ENHANCEMENT_KEYS), z.boolean()),
  output: z.enum(OUTPUT_OPTIONS),
  customLongEdge: z
    .number()
    .int()
    .min(1024, 'Custom resolution needs a long edge of at least 1024 px.')
    .max(8192, 'Custom resolution tops out at 8192 px on the long edge.'),
});
export type ImageSettings = z.infer<typeof imageSettingsSchema>;

/** Every image starts here: Strict mode, nothing added, nothing switched on. */
export function defaultSettings(): ImageSettings {
  return {
    mode: 'strict',
    lighting: 'preserve',
    lightingCustom: '',
    people: [],
    peopleCustom: '',
    activities: [],
    activitiesCustom: '',
    additions: [],
    additionsOther: '',
    enhancements: Object.fromEntries(ENHANCEMENT_KEYS.map((k) => [k, false])) as Record<
      EnhancementKey,
      boolean
    >,
    output: '4k',
    customLongEdge: 3840,
  };
}

// ---------------------------------------------------------------------------
// Project documents
// ---------------------------------------------------------------------------

/**
 * `queued` work waits for room on the visitor's Runway account (it runs a few
 * tasks at a time); `running` with no `taskId` yet is being submitted.
 */
export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed';

/** The fields every queued Runway job shares. */
export interface QueuedJob {
  state: TaskState;
  taskId?: string | undefined;
  error?: string | undefined;
  /** When a submitter claimed this job — guards against double submission. */
  claimedAt?: string | undefined;
  /** Which submitter claimed it, so two tabs never both submit one job. */
  claimId?: string | undefined;
  /** 0–1 while running, when Runway reports it. */
  progress?: number | undefined;
  /** What the door said this job costs, in US cents, set when the door accepts it. */
  cents?: number | null | undefined;
}

export interface ImageAnalysis {
  subject: string;
  spaceType: string;
  composition: string;
  camera: string;
  materials: string[];
  lighting: string;
  landscaping: string;
  notableElements: string[];
  peoplePresent: boolean;
  summary: string;
}

export interface AnalysisRun extends QueuedJob {
  result?: ImageAnalysis | undefined;
}

export interface EnhancementRun extends QueuedJob {
  id: string;
  /** "v1", "v2"… per image. */
  version: number;
  createdAt: string;
  /** Settings exactly as they were when this version ran. */
  settings: ImageSettings;
  prompt: string;
  /** Requested output size class ("1K" | "2K" | "4K"). */
  imageSize: string;
  revisionNote?: string | undefined;
  /** Copy of the result in the app's own storage, once saved. */
  storedKey?: string | undefined;
  /** Pixel size of the result, when Runway reports it. */
  outputSize?: { width: number; height: number } | undefined;
  decision: 'pending' | 'approved' | 'rejected' | 'revision';
  decisionNote?: string | undefined;
}

export interface MasterRun extends QueuedJob {
  /** The approved enhancement this master was made from. */
  sourceRunId: string;
  createdAt: string;
  targetLongEdge: number;
  /** Set once succeeded: masters are locked and never regenerated in place. */
  locked: boolean;
  /** True when the approved enhancement already met the target size. */
  reusedEnhancement?: boolean | undefined;
  /** Copy of the master in the app's own storage, once saved. */
  storedKey?: string | undefined;
  outputSize?: { width: number; height: number } | undefined;
}

export interface ProjectImage {
  id: string;
  /** Human-facing unique id, e.g. "IMG-003". */
  code: string;
  name: string;
  width: number;
  height: number;
  /** The untouched upload. Never modified, never overwritten. */
  originalKey: string;
  /** ≤2560px JPEG working copy sent to the models. */
  workKey: string;
  thumbKey: string;
  uploadedAt: string;
  settings: ImageSettings;
  /** Absent until the user asks for an analysis. */
  analysis?: AnalysisRun | undefined;
  enhancements: EnhancementRun[];
  master?: MasterRun | undefined;
}

export const SHOT_TYPES = [
  'Establishing wide',
  'Wide',
  'Medium',
  'Close-up',
  'Macro detail',
  'Lifestyle',
  'Hero',
] as const;

export const TRANSITIONS = ['cut', 'fade'] as const;
export type Transition = (typeof TRANSITIONS)[number];

export interface ShotVideo extends QueuedJob {
  /** Runway artifact id of the clip — what film assembly stitches. */
  artifactId?: string | undefined;
  durationSeconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** The prompt exactly as it was sent. */
  prompt: string;
  storedKey?: string | undefined;
  error?: string | undefined;
  createdAt: string;
  decision: 'pending' | 'approved' | 'rejected';
  /**
   * While a clip is made again: the kept clip it is to replace, put back if
   * the new one fails or is cancelled, dropped once it has succeeded.
   */
  previous?: ShotVideo | undefined;
}

export interface Shot {
  id: string;
  number: number;
  /** The master image this shot animates. */
  imageId: string;
  shotType: string;
  creativeDirection: string;
  cameraMovement: string;
  speed: string;
  lighting: string;
  humanActivity: string;
  purpose: string;
  videoPrompt: string;
  durationSeconds: number;
  transition: Transition;
  video?: ShotVideo | undefined;
}

export const FILM_FORMATS = ['16:9', '9:16', '1:1'] as const;
export type FilmFormat = (typeof FILM_FORMATS)[number];
export const FILM_FORMAT_LABELS: Record<FilmFormat, string> = {
  '16:9': 'Landscape 16:9',
  '9:16': 'Portrait 9:16',
  '1:1': 'Square 1:1',
};

export interface Storyboard extends QueuedJob {
  createdAt: string;
  brief: string;
  format: FilmFormat;
  /** Master images the storyboard was written from. */
  imageIds: string[];
  title: string;
  narrative: string;
  grade: string;
  musicDirection: string;
  shots: Shot[];
}

/** One Runway step of film assembly; `artifactId` feeds the next step. */
export interface FilmStep extends QueuedJob {
  /** Runway asset ids this step works on, fixed when it was queued. */
  inputIds?: string[] | undefined;
  /** Length of the inputs as the operation measures it, when known. */
  inputDuration?: number | undefined;
  artifactId?: string | undefined;
  durationSeconds?: number | undefined;
}

export interface FilmRun {
  /** `running` until the finished film (with or without music) is known. */
  state: TaskState;
  error?: string | undefined;
  createdAt: string;
  withMusic: boolean;
  musicPrompt: string;
  transition: Transition;
  shotIds: string[];
  /** Approved clips joined end to end. */
  stitch: FilmStep;
  /** The score, made alongside the stitch when music is on. */
  music?: FilmStep | undefined;
  /** The score cut to the film's length, when it runs longer. */
  trim?: FilmStep | undefined;
  /** The score laid under the stitched cut. */
  mix?: FilmStep | undefined;
  /** The task whose artifact is the finished film. */
  finalTaskId?: string | undefined;
  /** Copy of the finished film in the app's own storage, once saved. */
  finalStoredKey?: string | undefined;
  /** Set when music was asked for but couldn't be made or mixed. */
  musicError?: string | undefined;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Next number for an image code. */
  nextImageNumber: number;
  images: ProjectImage[];
  storyboard?: Storyboard | undefined;
  film?: FilmRun | undefined;
  /**
   * What the door has accepted for this project so far, in US cents, by kind.
   * Counted once when a job's id is saved; it never goes down.
   */
  spent?: { enhanceCents: number; masterCents: number; clipCents: number } | undefined;
}

/** Everything the door has accepted for a project, in US cents. */
export function projectSpentCents(p: Pick<Project, 'spent'>): number {
  const s = p.spent;
  return s ? s.enhanceCents + s.masterCents + s.clipCents : 0;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  imageCount: number;
  masterCount: number;
  thumbKeys: string[];
  /** Spent on this project so far, in US cents. */
  spentCents: number;
  /** A finished film exists. */
  filmReady: boolean;
}

export const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp'] as const;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/**
 * Storage keys for one uploaded image. The browser makes the working copy
 * (≤2560px JPEG, what the models see) and the thumbnail (≤640px JPEG) with a
 * canvas, then PUTs all three straight to storage with the signed URLs
 * `project.uploadUrls` returns.
 */
export function imageKeys(projectId: string, imageId: string, ext: ImageExtension) {
  const base = `p/${projectId}/img/${imageId}`;
  return {
    originalKey: `${base}/original.${ext}`,
    workKey: `${base}/work.jpg`,
    thumbKey: `${base}/thumb.jpg`,
  };
}

/** Matches exactly the keys `imageKeys` produces — the upload route's allowlist. */
export const UPLOAD_KEY_PATTERN =
  /^p\/[a-z0-9-]{8,64}\/img\/[a-z0-9-]{8,64}\/(original\.(jpg|png|webp)|work\.jpg|thumb\.jpg)$/;

/** URL of a stored object (originals, working copies, thumbnails). */
export function mediaUrl(key: string): string {
  return `/files/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Where the browser loads a generated result: the app's stored copy, or
 * nothing while the job has not been kept yet. `download` asks to save it:
 * `true` under the stored name, a string under that readable name
 * (src/server/files.ts cleans it and keeps the file's own ending).
 */
export function outputUrl(
  run: { storedKey?: string | undefined },
  download: boolean | string = false
): string | undefined {
  return run.storedKey ? downloadUrl(mediaUrl(run.storedKey), download) : undefined;
}

/** The film's file name: the project's name, then the film's title when it says more. */
export function filmFileName(projectName: string, title?: string | undefined): string {
  const p = projectName.trim();
  const t = (title ?? '').trim();
  if (!t || t.toLowerCase() === p.toLowerCase()) return p ? `${p} film` : 'Film';
  return p ? `${p} - ${t}` : t;
}

/** A master's file name: the project, the picture's code and its own name when it has one. */
export function masterFileName(projectName: string, image: { code: string; name?: string | undefined }): string {
  const name = (image.name ?? '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return [projectName.trim(), image.code, name && name !== image.code ? name : '', 'master'].filter(Boolean).join(' ');
}

/** `url` asking to be saved: `?download`, with `=<name>` when a readable name is given. */
export function downloadUrl(url: string, download: boolean | string = true): string {
  if (download === false) return url;
  return typeof download === 'string' && download.trim() ? `${url}?download=${encodeURIComponent(download.trim())}` : `${url}?download`;
}

export function latestEnhancement(image: ProjectImage): EnhancementRun | undefined {
  return image.enhancements[image.enhancements.length - 1];
}

export function approvedEnhancement(image: ProjectImage): EnhancementRun | undefined {
  return [...image.enhancements].reverse().find((r) => r.decision === 'approved');
}

/** True while anything in the project is still waiting on Runway. */
export function projectHasRunningWork(p: Project): boolean {
  const busy = (j: { state: TaskState } | undefined) =>
    j?.state === 'running' || j?.state === 'queued';
  return (
    p.images.some(
      (i) => busy(i.analysis) || i.enhancements.some(busy) || busy(i.master)
    ) ||
    busy(p.storyboard) ||
    (p.storyboard?.shots ?? []).some((s) => busy(s.video)) ||
    p.film?.state === 'running'
  );
}
