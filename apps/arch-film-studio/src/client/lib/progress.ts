/**
 * Where a project stands: each of the six stages as "done of total" with its
 * lock, the one thing to do next, and the next picture still to decide. Built
 * on `stageLock` (stages.ts). Pure, for plain Node (`progress.test.ts`).
 */
import {
  approvedEnhancement,
  latestEnhancement,
  type Project,
  type ProjectImage,
  projectHasRunningWork,
  type Shot,
  type TaskState,
} from '../../shared/project.ts';
import { type Screen, SCREEN_STAGE } from './route.ts';
import { stageLock } from './stages.ts';

export type WorkScreen = Exclude<Screen, 'overview'>;

export type StageProgress = {
  screen: WorkScreen;
  done: number;
  total: number;
  locked: boolean;
  lockWhy: string | null;
};

const busy = (j: { state: TaskState } | undefined) => j?.state === 'queued' || j?.state === 'running';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** An image whose newest version is finished and not yet approved or rejected. */
export function toDecide(image: ProjectImage): boolean {
  const last = latestEnhancement(image);
  return !!last && last.state === 'succeeded' && last.decision === 'pending';
}

/** An image the owner has settled: a version approved, or the newest one rejected. */
export function isDecided(image: ProjectImage): boolean {
  if (approvedEnhancement(image)) return true;
  return latestEnhancement(image)?.decision === 'rejected';
}

/** An image with no version made, being made or waiting: what "Enhance" still has to do. */
export function notEnhanced(image: ProjectImage): boolean {
  return !image.enhancements.some((r) => r.state === 'queued' || r.state === 'running' || r.state === 'succeeded');
}

/** An approved image whose master can be asked for: none yet, or the last one failed. */
export function wantsMaster(image: ProjectImage): boolean {
  return !!approvedEnhancement(image) && (!image.master || image.master.state === 'failed');
}

/** A shot that "Make clips" takes: no clip yet, or the last one failed or was rejected. */
export function wantsClip(shot: Shot): boolean {
  const v = shot.video;
  return !v || v.state === 'failed' || v.decision === 'rejected';
}

function clipMade(shot: Shot): boolean {
  return shot.video?.state === 'succeeded' && !!shot.video.storedKey;
}

/** The six stages in order, each as done of total, with its lock and the reason. */
export function stageProgress(p: Project): StageProgress[] {
  const images = p.images;
  const shots = p.storyboard?.shots ?? [];
  const made = images.filter((i) => i.enhancements.some((r) => r.state === 'succeeded'));
  const approved = images.filter((i) => approvedEnhancement(i));
  const counts: Record<WorkScreen, [number, number]> = {
    renders: [images.length, images.length],
    enhance: [made.length, images.length],
    review: [made.filter(isDecided).length, made.length],
    masters: [approved.filter((i) => i.master?.locked).length, approved.length],
    storyboard: [shots.filter((s) => clipMade(s) && s.video?.decision === 'approved').length, shots.length],
    film: [p.film?.state === 'succeeded' && p.film.finalStoredKey ? 1 : 0, 1],
  };
  return (Object.keys(SCREEN_STAGE) as WorkScreen[]).map((screen) => {
    const lockWhy = stageLock(p, SCREEN_STAGE[screen]);
    const [done, total] = counts[screen];
    return { screen, done, total, locked: lockWhy !== null, lockWhy };
  });
}

/** "9 of 14" beside a stage's name; the renders' plain count; "Ready" for a finished film. */
export function progressWords(s: Pick<StageProgress, 'screen' | 'done' | 'total'>): string {
  if (s.screen === 'renders') return s.total > 0 ? String(s.total) : '';
  if (s.screen === 'film') return s.done > 0 ? 'Ready' : '';
  return s.total > 0 ? `${s.done} of ${s.total}` : '';
}

export type NextStep = {
  screen: WorkScreen;
  /** The one thing to do, as a sentence. */
  sentence: string;
  /** `spend`: the step costs money (priced on its screen); `free`: no charge; `wait`: work is being made. */
  kind: 'free' | 'spend' | 'wait';
  /** How many pictures or shots the step is about. */
  count: number;
};

/** The single next thing this project needs from the owner, or what it is waiting for. */
export function nextStep(p: Project): NextStep {
  const images = p.images;
  if (images.length === 0) {
    return { screen: 'renders', sentence: 'Add the renders of this project to begin.', kind: 'free', count: 0 };
  }
  const deciding = images.filter(toDecide);
  if (deciding.length > 0) {
    return {
      screen: 'review',
      sentence: `${plural(deciding.length, 'new version is', 'new versions are')} waiting for your decision.`,
      kind: 'free',
      count: deciding.length,
    };
  }
  const fresh = images.filter((i) => notEnhanced(i) && !i.master?.locked);
  if (fresh.length > 0) {
    return {
      screen: 'enhance',
      sentence: `${plural(fresh.length, 'render is', 'renders are')} ready to enhance.`,
      kind: 'spend',
      count: fresh.length,
    };
  }
  const masters = images.filter(wantsMaster);
  if (masters.length > 0) {
    return {
      screen: 'masters',
      sentence: `${plural(masters.length, 'approved picture needs', 'approved pictures need')} a 4K master.`,
      kind: 'spend',
      count: masters.length,
    };
  }
  const sb = p.storyboard;
  const hasMaster = images.some((i) => i.master?.locked && i.master.storedKey);
  if (sb?.state === 'running') {
    return { screen: 'storyboard', sentence: 'The storyboard is being written. This page updates by itself.', kind: 'wait', count: 0 };
  }
  if (hasMaster && (!sb || sb.shots.length === 0)) {
    return { screen: 'storyboard', sentence: 'Write the storyboard from your masters.', kind: 'free', count: 0 };
  }
  const shots = sb?.shots ?? [];
  const clipDecide = shots.filter((s) => clipMade(s) && s.video?.decision === 'pending');
  if (clipDecide.length > 0) {
    return {
      screen: 'storyboard',
      sentence: `${plural(clipDecide.length, 'clip is', 'clips are')} waiting for your decision.`,
      kind: 'free',
      count: clipDecide.length,
    };
  }
  const clips = shots.filter((s) => wantsClip(s) && !busy(s.video));
  if (clips.length > 0) {
    return {
      screen: 'storyboard',
      sentence: `${plural(clips.length, 'shot needs', 'shots need')} a clip.`,
      kind: 'spend',
      count: clips.length,
    };
  }
  if (projectHasRunningWork(p)) {
    const making = images.filter((i) => i.enhancements.some(busy) || busy(i.master)).length + shots.filter((s) => busy(s.video)).length;
    return {
      screen: p.film?.state === 'running' ? 'film' : making > 0 && shots.some((s) => busy(s.video)) ? 'storyboard' : 'enhance',
      sentence:
        p.film?.state === 'running'
          ? 'The film is being joined on this Mac. This page updates by itself.'
          : `${plural(making, 'thing is', 'things are')} being made. This page updates by itself.`,
      kind: 'wait',
      count: making,
    };
  }
  const approvedClips = shots.filter((s) => clipMade(s) && s.video?.decision === 'approved');
  const film = p.film;
  if (approvedClips.length > 0 && !(film?.state === 'succeeded' && film.finalStoredKey)) {
    return { screen: 'film', sentence: 'Assemble the film from the approved clips.', kind: 'free', count: approvedClips.length };
  }
  if (film?.state === 'succeeded' && film.finalStoredKey) {
    return { screen: 'film', sentence: 'The film is ready to watch and download.', kind: 'free', count: 1 };
  }
  if (!hasMaster) {
    return { screen: 'review', sentence: 'Approve a version of a picture to make its master.', kind: 'free', count: 0 };
  }
  return { screen: 'storyboard', sentence: 'Approve at least one clip to make the film.', kind: 'free', count: 0 };
}

/** The pictures Review moves through, in project order: those with a version. */
export function reviewOrder(p: Project): ProjectImage[] {
  return p.images.filter((i) => i.enhancements.length > 0);
}

/** The next picture after `fromImageId` (going round) whose newest version waits for a decision, or null. */
export function nextUndecided(p: Project, fromImageId: string | null): string | null {
  const order = reviewOrder(p);
  if (order.length === 0) return null;
  const at = fromImageId === null ? -1 : order.findIndex((i) => i.id === fromImageId);
  for (let step = 1; step <= order.length; step++) {
    const image = order[(at + step + order.length) % order.length]!;
    if (image.id !== fromImageId && toDecide(image)) return image.id;
  }
  return null;
}

/** Where a picture needs the owner now, for a click on it in the overview. */
export function attentionScreen(image: ProjectImage): WorkScreen {
  if (image.master || approvedEnhancement(image)) return 'masters';
  return notEnhanced(image) ? 'enhance' : 'review';
}

/** The word for a picture's state, and its dot, wherever a picture is shown. */
export type PictureState = { words: string; dot: 'success' | 'warning' | 'error' | 'accent' | 'neutral'; working: boolean };

export function pictureState(image: ProjectImage): PictureState {
  const m = image.master;
  if (m?.locked) return { words: 'Master made', dot: 'success', working: false };
  if (busy(m)) return { words: m?.state === 'queued' ? 'Master waiting to be sent' : 'Master being made', dot: 'accent', working: true };
  if (m?.state === 'failed') return { words: 'Master failed', dot: 'error', working: false };
  const last = latestEnhancement(image);
  if (busy(last)) return { words: last?.state === 'queued' ? 'Waiting to be sent' : 'Being made', dot: 'accent', working: true };
  if (approvedEnhancement(image)) return { words: 'Approved', dot: 'success', working: false };
  if (!last) return { words: 'Not enhanced', dot: 'neutral', working: false };
  if (last.state === 'failed') return { words: 'Failed', dot: 'error', working: false };
  if (last.decision === 'rejected') return { words: 'Rejected', dot: 'error', working: false };
  if (last.decision === 'revision') return { words: 'Revision asked', dot: 'warning', working: false };
  return { words: 'To decide', dot: 'warning', working: false };
}
