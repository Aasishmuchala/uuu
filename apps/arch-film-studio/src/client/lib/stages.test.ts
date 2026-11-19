import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultSettings, type EnhancementRun, type Project, type ProjectImage, type Shot } from '../../shared/project.ts';
import {
  altOf,
  droppedClipsWords,
  isStageKey,
  jobWords,
  keptClips,
  pollEvery,
  sizeWords,
  stageCount,
  stageLock,
  STAGES,
  waitingCount,
  waitingWords,
} from './stages.ts';

const at = '2026-11-18T00:00:00.000Z';

function run(over: Partial<EnhancementRun> = {}): EnhancementRun {
  return { id: 'run-00001', version: 1, createdAt: at, settings: defaultSettings(), prompt: 'p', imageSize: '4K', state: 'succeeded', storedKey: 'media/a.png', decision: 'pending', ...over };
}

function image(over: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-00001',
    code: 'IMG-001',
    name: 'Lobby.jpg',
    width: 2000,
    height: 1333,
    originalKey: 'k',
    workKey: 'k',
    thumbKey: 'k',
    uploadedAt: at,
    settings: defaultSettings(),
    enhancements: [],
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return { id: 'proj-0001', name: 'Tower', createdAt: at, updatedAt: at, nextImageNumber: 1, images: [], ...over };
}

const shot: Shot = {
  id: 'shot-0001',
  number: 1,
  imageId: 'img-00001',
  shotType: 'Wide',
  creativeDirection: '',
  cameraMovement: '',
  speed: '',
  lighting: '',
  humanActivity: '',
  purpose: '',
  videoPrompt: '',
  durationSeconds: 6,
  transition: 'cut',
};

test('the strip is the zip six stages, in order', () => {
  assert.deepEqual(
    STAGES.map((s) => s.label),
    ['Upload', 'Enhance', 'Review', '4K masters', 'Storyboard', 'Film']
  );
  assert.equal(isStageKey('masters'), true);
  assert.equal(isStageKey('library'), false);
});

test('which stage is unlocked, step by step', () => {
  const empty = project();
  assert.equal(stageLock(empty, 'upload'), null);
  assert.equal(stageLock(empty, 'enhance'), 'Upload a render first.');

  const uploaded = project({ images: [image()] });
  assert.equal(stageLock(uploaded, 'enhance'), null);
  assert.equal(stageLock(uploaded, 'review'), 'Enhance an image first.');

  const enhanced = project({ images: [image({ enhancements: [run()] })] });
  assert.equal(stageLock(enhanced, 'review'), null);
  assert.equal(stageLock(enhanced, 'masters'), 'Approve a version in Review first.');

  const approved = project({ images: [image({ enhancements: [run({ decision: 'approved' })] })] });
  assert.equal(stageLock(approved, 'masters'), null);
  assert.equal(stageLock(approved, 'storyboard'), 'Unlocks once at least one image is approved as a master.');
  assert.equal(stageLock(approved, 'film'), 'Unlocks once at least one image is approved as a master.');

  const mastered = project({
    images: [
      image({
        enhancements: [run({ decision: 'approved' })],
        master: { state: 'succeeded', sourceRunId: 'run-00001', createdAt: at, targetLongEdge: 3840, locked: true, storedKey: 'media/m.png' },
      }),
    ],
  });
  assert.equal(stageLock(mastered, 'storyboard'), null);
  assert.equal(stageLock(mastered, 'film'), 'Write a storyboard first.');

  const boarded = {
    ...mastered,
    storyboard: { state: 'succeeded' as const, createdAt: at, brief: '', format: '16:9' as const, imageIds: [], title: 't', narrative: '', grade: '', musicDirection: '', shots: [shot] },
  };
  assert.equal(stageLock(boarded, 'film'), null);
  assert.equal(stageCount(boarded, 'storyboard'), 1);
  assert.equal(stageCount(boarded, 'masters'), 1);
  assert.equal(stageCount(empty, 'upload'), null);
});

test('the project is asked every 3 seconds only while work runs', () => {
  assert.equal(pollEvery(undefined), false);
  assert.equal(pollEvery(project({ images: [image({ enhancements: [run()] })] })), false);
  assert.equal(pollEvery(project({ images: [image({ enhancements: [run({ state: 'queued' })] })] })), 3000);
  assert.equal(pollEvery(project({ images: [image({ analysis: { state: 'running' } })] })), 3000);
});

test("a job's words, and a failed job's own sentence", () => {
  assert.deepEqual(jobWords(undefined), { busy: false, words: '', error: null });
  assert.equal(jobWords({ state: 'queued' }).words, 'Waiting for a free place');
  assert.equal(jobWords({ state: 'running', progress: 0.42 }).words, 'Being made 42%');
  assert.deepEqual(jobWords({ state: 'failed', error: 'The engine did not start this.' }), {
    busy: false,
    words: 'Failed',
    error: 'The engine did not start this.',
  });
  assert.equal(jobWords({ state: 'succeeded' }, 'Locked').words, 'Locked');
});

test('alternative text is the code and the name', () => {
  assert.equal(altOf({ code: 'IMG-003', name: 'Pool.png' }), 'IMG-003 Pool.png');
  assert.equal(altOf({ code: 'IMG-003', name: 'Pool.png' }, 'master'), 'IMG-003 Pool.png, master');
  assert.equal(sizeWords({ width: 3840, height: 2160 }), '3840 × 2160 px');
});

test('the jobs waiting to be sent are counted for "Cancel waiting"', () => {
  assert.equal(waitingCount(undefined), 0);
  const p = project({
    images: [
      image({ enhancements: [run({ state: 'queued' }), run({ state: 'running' }), run({ state: 'queued' })] }),
      image({ master: { state: 'queued', sourceRunId: 'run-00001', createdAt: at, targetLongEdge: 3840, locked: false } }),
    ],
    storyboard: {
      state: 'succeeded',
      createdAt: at,
      brief: '',
      format: '16:9',
      imageIds: [],
      title: 't',
      narrative: '',
      grade: '',
      musicDirection: '',
      shots: [{ ...shot, video: { state: 'queued', prompt: 'p', createdAt: at, decision: 'pending' } }, shot],
    },
  });
  assert.equal(waitingCount(p), 4);
  assert.equal(waitingWords(4), '4 jobs are waiting to be sent. Nothing is spent on them until they go.');
  assert.equal(waitingWords(1), '1 job is waiting to be sent. Nothing is spent on it until it goes.');
});

test('writing the storyboard again counts the kept clips it drops, and says so', () => {
  const made = { state: 'succeeded' as const, prompt: 'p', createdAt: at, decision: 'approved' as const, storedKey: 'media/c.mp4' };
  const shots: Shot[] = [
    { ...shot, video: made },
    { ...shot, video: { ...made, decision: 'pending' } },
    { ...shot, video: { ...made, state: 'failed', storedKey: undefined } },
    shot,
  ];
  assert.equal(keptClips(shots), 2);
  assert.equal(keptClips([shot]), 0);
  assert.match(droppedClipsWords(2), /2 clips already made are dropped/);
  assert.match(droppedClipsWords(1), /1 clip already made is dropped/);
});
