/**
 * The task list: every task the gateway has made, kept in
 * `docs/tasks/tasks.json` so a task id keeps meaning after a restart. At most
 * 5,000 are kept; when there are more, the oldest finished ones go first.
 */
import type { DocumentStore } from '../storage.ts';

export const MAX_TASKS = 5000;

export type TaskState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** A file a task made, kept under `objects/<key>`. */
export type TaskOutput = {
  key: string;
  type: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  fps: number | null;
};

export type TaskRecord = {
  id: string;
  type: string;
  route: 'engine' | 'claude' | 'media';
  engineJob: string | null;
  state: TaskState;
  createdAt: string;
  output: TaskOutput | null;
  /** More than one file (a set of captured frames); `output` is then the first. */
  outputs?: TaskOutput[] | undefined;
  error: string | null;
  text: string | null;
  truncated?: boolean | undefined;
};

type TaskDoc = { tasks: TaskRecord[] };

export const isFinished = (t: TaskRecord) => t.state === 'SUCCEEDED' || t.state === 'FAILED';

/** `list` cut to `max`: the oldest finished first, then (only if need be) the oldest. */
export function trimTasks(list: TaskRecord[], max: number): TaskRecord[] {
  let excess = list.length - max;
  if (excess <= 0) return list;
  const drop = new Set<number>();
  for (let i = 0; i < list.length && drop.size < excess; i++) {
    if (isFinished(list[i]!)) drop.add(i);
  }
  for (let i = 0; i < list.length && drop.size < excess; i++) drop.add(i);
  return list.filter((_, i) => !drop.has(i));
}

export function createTaskStore(options: { docs: DocumentStore<TaskDoc>; max?: number }) {
  const { docs } = options;
  const max = options.max ?? MAX_TASKS;
  const NAME = 'tasks';

  async function insert(record: TaskRecord): Promise<void> {
    await docs.update(NAME, (cur) => ({ tasks: trimTasks([...(cur?.tasks ?? []), record], max) }));
  }

  async function get(id: string): Promise<TaskRecord | null> {
    const doc = await docs.get(NAME);
    return doc?.value.tasks.find((t) => t.id === id) ?? null;
  }

  /** Change one task; the new record, or null when there is no such task. */
  async function update(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null> {
    let found: TaskRecord | null = null;
    await docs.update(NAME, (cur) => {
      found = null;
      const tasks = (cur?.tasks ?? []).map((t) => {
        if (t.id !== id) return t;
        found = { ...t, ...patch, id: t.id };
        return found;
      });
      return { tasks };
    });
    return found;
  }

  async function count(): Promise<number> {
    return (await docs.get(NAME))?.value.tasks.length ?? 0;
  }

  return { insert, get, update, count };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
export type { TaskDoc };
