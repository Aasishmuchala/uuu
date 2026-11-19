import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import type { FilmRun, Project } from '../shared/project.ts';
import { createProject, listProjects } from './store.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'afs-store-'));
  process.env['APP_DATA'] = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = (id: string, over: Partial<Project> = {}): Project => ({
  id,
  name: id,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  nextImageNumber: 1,
  images: [],
  ...over,
});

test('the project list carries spentCents and filmReady', async () => {
  await createProject(base('project-old', { updatedAt: '2026-11-19T10:00:01.000Z' }));
  await createProject(
    base('project-new', {
      updatedAt: '2026-11-19T10:00:02.000Z',
      spent: { enhanceCents: 40, masterCents: 25, clipCents: 90 },
      film: { state: 'succeeded' } as FilmRun,
    })
  );
  await createProject(base('project-run', { film: { state: 'running' } as FilmRun }));
  const list = await listProjects();
  const by = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.equal(by['project-old']!.spentCents, 0);
  assert.equal(by['project-old']!.filmReady, false);
  assert.equal(by['project-new']!.spentCents, 155);
  assert.equal(by['project-new']!.filmReady, true);
  assert.equal(by['project-run']!.filmReady, false);
});
