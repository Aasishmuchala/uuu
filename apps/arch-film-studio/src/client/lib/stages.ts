/**
 * The six stages as the strip shows them, which are unlocked, and how often
 * the page asks for the project. Pure, for plain Node (`stages.test.ts`).
 */
import {
  approvedEnhancement,
  type Project,
  projectHasRunningWork,
  type QueuedJob,
  type Shot,
} from '../../shared/project.ts';
import { NEEDS_MASTER } from './words.ts';

export const STAGES = [
  { key: 'upload', label: 'Upload' },
  { key: 'enhance', label: 'Enhance' },
  { key: 'review', label: 'Review' },
  { key: 'masters', label: '4K masters' },
  { key: 'storyboard', label: 'Storyboard' },
  { key: 'film', label: 'Film' },
] as const;
export type StageKey = (typeof STAGES)[number]['key'];

export function isStageKey(v: unknown): v is StageKey {
  return STAGES.some((s) => s.key === v);
}

/** Whether a stage has anything to work on yet, and if not, the sentence that says what comes first. */
export function stageLock(p: Project | undefined, stage: StageKey): string | null {
  if (stage === 'upload') return null;
  if (!p || p.images.length === 0) return 'Upload a render first.';
  if (stage === 'enhance') return null;
  if (stage === 'review') {
    return p.images.some((i) => i.enhancements.length > 0) ? null : 'Enhance an image first.';
  }
  if (stage === 'masters') {
    return p.images.some((i) => approvedEnhancement(i)) ? null : 'Approve a version in Review first.';
  }
  const masters = p.images.some((i) => i.master?.locked && i.master.storedKey);
  if (stage === 'storyboard') return masters ? null : NEEDS_MASTER;
  if (!masters) return NEEDS_MASTER;
  return (p.storyboard?.shots.length ?? 0) > 0 ? null : 'Write a storyboard first.';
}

/** A short count beside a stage's name ("3"), or nothing. */
export function stageCount(p: Project | undefined, stage: StageKey): number | null {
  if (!p) return null;
  switch (stage) {
    case 'upload':
      return p.images.length || null;
    case 'enhance':
      return p.images.filter((i) => i.enhancements.length > 0).length || null;
    case 'review':
      return p.images.filter((i) => approvedEnhancement(i)).length || null;
    case 'masters':
      return p.images.filter((i) => i.master?.locked).length || null;
    case 'storyboard':
      return p.storyboard?.shots.length || null;
    case 'film':
      return p.film?.state === 'succeeded' ? 1 : null;
  }
}

/** The project is asked every 3 seconds while work is running, else only on focus. */
export const POLL_MS = 3000;
export function pollEvery(p: Project | undefined): number | false {
  return p && projectHasRunningWork(p) ? POLL_MS : false;
}

/** The allowance chip is asked again every 15 seconds. */
export const ALLOWANCE_MS = 15_000;

/** One job's state in words, for the line beside the thing it was for. */
export function jobWords(job: QueuedJob | undefined, made = 'Ready'): { busy: boolean; words: string; error: string | null } {
  if (!job) return { busy: false, words: '', error: null };
  switch (job.state) {
    case 'queued':
      return { busy: true, words: 'Waiting for a free place', error: null };
    case 'running': {
      const pct = typeof job.progress === 'number' && job.progress > 0 && job.progress < 1 ? ` ${Math.round(job.progress * 100)}%` : '';
      return { busy: true, words: `Being made${pct}`, error: null };
    }
    case 'failed':
      return { busy: false, words: 'Failed', error: job.error || 'This did not finish.' };
    case 'succeeded':
      return { busy: false, words: made, error: null };
  }
}

/** How many of the project's paid jobs are still waiting to be sent: what "Cancel waiting" ends. */
export function waitingCount(p: Project | undefined): number {
  if (!p) return 0;
  const jobs: Array<QueuedJob | undefined> = [
    ...p.images.flatMap((i) => [...i.enhancements, i.master]),
    ...(p.storyboard?.shots ?? []).map((s) => s.video),
  ];
  return jobs.filter((j) => j?.state === 'queued').length;
}

/** "3 jobs are waiting to be sent. Nothing is spent on them until they go." */
export function waitingWords(n: number): string {
  return `${n} ${n === 1 ? 'job is' : 'jobs are'} waiting to be sent. Nothing is spent on ${n === 1 ? 'it' : 'them'} until ${n === 1 ? 'it goes' : 'they go'}.`;
}

/** The shots holding a kept clip: what writing the storyboard again drops. */
export function keptClips(shots: readonly Shot[]): number {
  return shots.filter((s) => s.video?.state === 'succeeded' && !!s.video.storedKey).length;
}

/** The question before the storyboard is written again over kept clips. */
export function droppedClipsWords(n: number): string {
  const clips = n === 1 ? '1 clip already made is' : `${n} clips already made are`;
  return `The new storyboard replaces every shot. ${clips} dropped when it arrives, and the film can no longer use ${n === 1 ? 'it' : 'them'}. Making ${n === 1 ? 'it' : 'them'} again costs money again.`;
}

/** A picture's words for its alternative text: its code and name. */
export function altOf(image: { code: string; name: string }, what = ''): string {
  return `${image.code} ${image.name}${what ? `, ${what}` : ''}`;
}

/** "3840 × 2160 px". */
export function sizeWords(size: { width: number; height: number } | undefined): string {
  return size ? `${size.width} × ${size.height} px` : '';
}
