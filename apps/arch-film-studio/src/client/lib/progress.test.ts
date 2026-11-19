import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultSettings,
  type EnhancementRun,
  type MasterRun,
  type Project,
  type ProjectImage,
  type Shot,
  type ShotVideo,
} from '../../shared/project.ts';
import {
  attentionScreen,
  isDecided,
  nextStep,
  nextUndecided,
  pictureState,
  progressWords,
  stageProgress,
  toDecide,
} from './progress.ts';

const at = '2026-11-18T00:00:00.000Z';
let n = 0;

function run(over: Partial<EnhancementRun> = {}): EnhancementRun {
  n += 1;
  return { id: `run-${String(n).padStart(5, '0')}`, version: 1, createdAt: at, settings: defaultSettings(), prompt: 'p', imageSize: '4K', state: 'succeeded', storedKey: 'media/a.png', decision: 'pending', ...over };
}

function image(id: string, over: Partial<ProjectImage> = {}): ProjectImage {
  return { id, code: id.toUpperCase(), name: `${id}.jpg`, width: 2000, height: 1125, originalKey: 'k', workKey: 'k', thumbKey: 'k', uploadedAt: at, settings: defaultSettings(), enhancements: [], ...over };
}

function master(over: Partial<MasterRun> = {}): MasterRun {
  return { state: 'succeeded', sourceRunId: 'r', createdAt: at, targetLongEdge: 3840, locked: true, storedKey: 'media/m.png', ...over };
}

function shot(id: string, video?: Partial<ShotVideo>): Shot {
  return {
    id,
    number: 1,
    imageId: 'img-a0000',
    shotType: 'Wide',
    creativeDirection: '',
    cameraMovement: '',
    speed: '',
    lighting: '',
    humanActivity: '',
    purpose: '',
    videoPrompt: '',
    durationSeconds: 5,
    transition: 'cut',
    video: video ? { state: 'succeeded', prompt: 'p', createdAt: at, decision: 'pending', storedKey: 'media/c.mp4', ...video } : undefined,
  };
}

function project(over: Partial<Project> = {}): Project {
  return { id: 'proj-0001', name: 'Tower', createdAt: at, updatedAt: at, nextImageNumber: 1, images: [], ...over };
}

test('the six stages as done of total, with their locks', () => {
  const empty = stageProgress(project());
  assert.deepEqual(empty.map((s) => s.screen), ['renders', 'enhance', 'review', 'masters', 'storyboard', 'film']);
  assert.equal(empty[0]!.locked, false);
  assert.deepEqual(empty.slice(1).map((s) => s.lockWhy), [
    'Upload a render first.',
    'Upload a render first.',
    'Upload a render first.',
    'Upload a render first.',
    'Upload a render first.',
  ]);

  const p = project({
    images: [
      image('img-a0000', { enhancements: [run({ decision: 'approved' })], master: master() }),
      image('img-b0000', { enhancements: [run({ decision: 'rejected' })] }),
      image('img-c0000', { enhancements: [run()] }),
      image('img-d0000', { enhancements: [run({ state: 'running', storedKey: undefined })] }),
      image('img-e0000'),
    ],
  });
  const s = Object.fromEntries(stageProgress(p).map((x) => [x.screen, x]));
  assert.deepEqual([s.renders!.done, s.renders!.total], [5, 5]);
  assert.deepEqual([s.enhance!.done, s.enhance!.total], [3, 5]);
  assert.deepEqual([s.review!.done, s.review!.total], [2, 3]);
  assert.deepEqual([s.masters!.done, s.masters!.total], [1, 1]);
  assert.equal(s.storyboard!.locked, false);
  assert.equal(s.film!.lockWhy, 'Write a storyboard first.');
  assert.equal(progressWords(s.review!), '2 of 3');
  assert.equal(progressWords(s.renders!), '5');
  assert.equal(progressWords(s.film!), '');
  assert.equal(progressWords({ screen: 'film', done: 1, total: 1 }), 'Ready');
});

test('decided: a version approved, or the newest one rejected', () => {
  assert.equal(isDecided(image('img-a0000', { enhancements: [run({ decision: 'approved' }), run()] })), true);
  assert.equal(isDecided(image('img-a0000', { enhancements: [run({ decision: 'rejected' })] })), true);
  assert.equal(isDecided(image('img-a0000', { enhancements: [run({ decision: 'revision' })] })), false);
  assert.equal(toDecide(image('img-a0000', { enhancements: [run({ state: 'running', storedKey: undefined })] })), false, 'still being made');
});

test('the next step, one at a time', () => {
  assert.equal(nextStep(project()).screen, 'renders');

  const fresh = project({ images: [image('img-a0000'), image('img-b0000')] });
  assert.deepEqual(nextStep(fresh), { screen: 'enhance', sentence: '2 renders are ready to enhance.', kind: 'spend', count: 2 });

  const deciding = project({ images: [image('img-a0000', { enhancements: [run()] }), image('img-b0000')] });
  assert.deepEqual(nextStep(deciding), { screen: 'review', sentence: '1 new version is waiting for your decision.', kind: 'free', count: 1 });

  const busy = project({ images: [image('img-a0000', { enhancements: [run({ state: 'running', storedKey: undefined })] })] });
  assert.equal(nextStep(busy).kind, 'wait');
  assert.equal(nextStep(busy).sentence, '1 thing is being made. This page updates by itself.');

  const approved = project({ images: [image('img-a0000', { enhancements: [run({ decision: 'approved' })] })] });
  assert.deepEqual(nextStep(approved), { screen: 'masters', sentence: '1 approved picture needs a 4K master.', kind: 'spend', count: 1 });

  const mastered = project({ images: [image('img-a0000', { enhancements: [run({ decision: 'approved' })], master: master() })] });
  assert.deepEqual(nextStep(mastered), { screen: 'storyboard', sentence: 'Write the storyboard from your masters.', kind: 'free', count: 0 });

  const sb = (shots: Shot[]) => ({ state: 'succeeded' as const, createdAt: at, brief: '', format: '16:9' as const, imageIds: [], title: 'T', narrative: '', grade: '', musicDirection: '', shots });
  const needClips = { ...mastered, storyboard: sb([shot('shot-0001'), shot('shot-0002', { state: 'failed', storedKey: undefined })]) };
  assert.deepEqual(nextStep(needClips), { screen: 'storyboard', sentence: '2 shots need a clip.', kind: 'spend', count: 2 });

  const clipsMade = { ...mastered, storyboard: sb([shot('shot-0001', {}), shot('shot-0002', { decision: 'approved' })]) };
  assert.equal(nextStep(clipsMade).sentence, '1 clip is waiting for your decision.');

  const ready = { ...mastered, storyboard: sb([shot('shot-0001', { decision: 'approved' })]) };
  assert.deepEqual(nextStep(ready), { screen: 'film', sentence: 'Assemble the film from the approved clips.', kind: 'free', count: 1 });

  const done = {
    ...ready,
    film: { state: 'succeeded' as const, createdAt: at, withMusic: false, musicPrompt: '', transition: 'cut' as const, shotIds: [], stitch: { state: 'succeeded' as const }, finalStoredKey: 'media/f.mp4' },
  };
  assert.equal(nextStep(done).sentence, 'The film is ready to watch and download.');
});

test('next undecided goes round from the picture in front, skipping it', () => {
  const p = project({
    images: [
      image('img-a0000', { enhancements: [run()] }),
      image('img-b0000', { enhancements: [run({ decision: 'approved' })] }),
      image('img-c0000'),
      image('img-d0000', { enhancements: [run()] }),
    ],
  });
  assert.equal(nextUndecided(p, 'img-a0000'), 'img-d0000');
  assert.equal(nextUndecided(p, 'img-d0000'), 'img-a0000');
  assert.equal(nextUndecided(p, null), 'img-a0000');
  const one = project({ images: [image('img-a0000', { enhancements: [run()] })] });
  assert.equal(nextUndecided(one, 'img-a0000'), null, 'only the picture in front');
  assert.equal(nextUndecided(project(), null), null);
});

test('a click on a picture opens the screen where it needs the owner', () => {
  assert.equal(attentionScreen(image('img-a0000')), 'enhance');
  assert.equal(attentionScreen(image('img-a0000', { enhancements: [run()] })), 'review');
  assert.equal(attentionScreen(image('img-a0000', { enhancements: [run({ state: 'failed', storedKey: undefined })] })), 'enhance');
  assert.equal(attentionScreen(image('img-a0000', { enhancements: [run({ decision: 'approved' })] })), 'masters');
  assert.equal(attentionScreen(image('img-a0000', { enhancements: [run({ decision: 'approved' })], master: master() })), 'masters');
});

test("a picture's state in a word and a dot", () => {
  assert.deepEqual(pictureState(image('img-a0000')), { words: 'Not enhanced', dot: 'neutral', working: false });
  assert.equal(pictureState(image('img-a0000', { enhancements: [run({ state: 'queued', storedKey: undefined })] })).words, 'Waiting to be sent');
  assert.equal(pictureState(image('img-a0000', { enhancements: [run()] })).words, 'To decide');
  assert.equal(pictureState(image('img-a0000', { enhancements: [run({ decision: 'approved' })], master: master() })).words, 'Master made');
  assert.equal(pictureState(image('img-a0000', { enhancements: [run({ decision: 'approved' })], master: master({ state: 'running', locked: false }) })).working, true);
});
