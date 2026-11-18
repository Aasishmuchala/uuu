import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createStorage } from '../storage.ts';
import { createTaskStore, MAX_TASKS, trimTasks, type TaskDoc, type TaskRecord } from './tasks.ts';

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'rtf-tasks-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const rec = (n: number, state: TaskRecord['state'] = 'PENDING'): TaskRecord => ({
  id: `t${n}`,
  type: 'gen4_turbo',
  route: 'engine',
  engineJob: null,
  state,
  createdAt: new Date(1_700_000_000_000 + n).toISOString(),
  output: null,
  error: null,
  text: null,
});

const open = async (max?: number) => {
  const dir = await mkdtemp(join(root, 't-'));
  const s = createStorage({ root: dir });
  return createTaskStore({ docs: s.documentStore<TaskDoc>({ prefix: 'tasks' }), max });
};

describe('trimTasks', () => {
  test('under the limit changes nothing', () => {
    const list = [rec(1), rec(2)];
    assert.equal(trimTasks(list, 5), list);
  });
  test('drops the oldest finished first, keeping unfinished older ones', () => {
    const list = [rec(1, 'PENDING'), rec(2, 'SUCCEEDED'), rec(3, 'RUNNING'), rec(4, 'FAILED'), rec(5, 'PENDING')];
    assert.deepEqual(trimTasks(list, 3).map((t) => t.id), ['t1', 't3', 't5']);
    assert.deepEqual(trimTasks(list, 4).map((t) => t.id), ['t1', 't3', 't4', 't5']);
  });
  test('when too few are finished, the oldest of the rest go', () => {
    const list = [rec(1), rec(2), rec(3, 'SUCCEEDED'), rec(4)];
    assert.deepEqual(trimTasks(list, 2).map((t) => t.id), ['t2', 't4']);
  });
});

describe('the task store', () => {
  test('insert, get, update', async () => {
    const tasks = await open();
    assert.equal(await tasks.get('t1'), null);
    await tasks.insert(rec(1));
    await tasks.insert(rec(2));
    assert.equal((await tasks.get('t2'))?.state, 'PENDING');
    const next = await tasks.update('t2', { state: 'SUCCEEDED', error: null, id: 'ignored' });
    assert.equal(next?.id, 't2');
    assert.equal(next?.state, 'SUCCEEDED');
    assert.equal((await tasks.get('t2'))?.state, 'SUCCEEDED');
    assert.equal((await tasks.get('t1'))?.state, 'PENDING');
    assert.equal(await tasks.update('nope', { state: 'FAILED' }), null);
    assert.equal(await tasks.count(), 2);
  });

  test('it keeps 5,000 and drops the oldest finished', async () => {
    assert.equal(MAX_TASKS, 5000);
    const tasks = await open();
    const dir = await mkdtemp(join(root, 'big-'));
    const s = createStorage({ root: dir });
    const docs = s.documentStore<TaskDoc>({ prefix: 'tasks' });
    // t1 is pending and oldest; t2 .. t5000 are finished.
    const all = [rec(1, 'PENDING'), ...Array.from({ length: 4999 }, (_, i) => rec(i + 2, 'SUCCEEDED'))];
    await docs.update('tasks', () => ({ tasks: all }));
    const big = createTaskStore({ docs });
    assert.equal(await big.count(), 5000);
    await big.insert(rec(9000, 'PENDING'));
    assert.equal(await big.count(), 5000);
    assert.ok(await big.get('t1'), 'the unfinished old one stays');
    assert.equal(await big.get('t2'), null, 'the oldest finished one went');
    assert.ok(await big.get('t3'));
    assert.ok(await big.get('t9000'));
    void tasks;
  });

  test('two updates at once both land', async () => {
    const tasks = await open();
    await tasks.insert(rec(1));
    await tasks.insert(rec(2));
    await Promise.all([tasks.update('t1', { state: 'RUNNING' }), tasks.update('t2', { state: 'FAILED', error: 'x' })]);
    assert.equal((await tasks.get('t1'))?.state, 'RUNNING');
    assert.equal((await tasks.get('t2'))?.error, 'x');
  });
});
