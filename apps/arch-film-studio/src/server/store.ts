import { TRPCError } from '@trpc/server';

import { documentStore } from '../storage.ts';
import type { Project, ProjectSummary } from '../shared/project.ts';

/**
 * Every project is one JSON document under `projects/<id>.json` in the app's
 * own storage. Writes go through `update`, one at a time per document, so two
 * tabs polling the same project never clobber each other's results.
 *
 * The ids of all projects are listed in `meta/index.json`.
 */
const projects = documentStore<Project>({ prefix: 'projects/' });
const meta = documentStore<{ ids: string[] }>({ prefix: 'meta/' });
const INDEX = 'index.json';

const keyFor = (id: string) => `${id}.json`;

export const PROJECT_ID_PATTERN = /^[a-z0-9-]{8,64}$/;

export async function getProject(id: string): Promise<Project> {
  const doc = await projects.get(keyFor(id));
  if (!doc) throw notFound();
  return doc.value;
}

export async function createProject(project: Project): Promise<Project> {
  await projects.update(keyFor(project.id), (current) => {
    // Throwing here aborts the write: update() rethrows what mutate throws.
    if (current) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A project with that id already exists.',
      });
    }
    return project;
  });
  await meta.update(INDEX, (current) => {
    const ids = current?.ids ?? [];
    return { ids: ids.includes(project.id) ? ids : [...ids, project.id] };
  });
  return project;
}

/**
 * Read-modify-write one project. `mutate` edits the draft in place (or
 * returns a replacement); `updatedAt` is stamped for it.
 */
export async function updateProject(
  id: string,
  mutate: (draft: Project) => void | Promise<void>
): Promise<Project> {
  return projects.update(keyFor(id), async (current) => {
    // Throwing here aborts the write: update() rethrows what mutate throws.
    if (!current) throw notFound();
    const draft = structuredClone(current);
    await mutate(draft);
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

function notFound() {
  return new TRPCError({
    code: 'NOT_FOUND',
    message: 'That project no longer exists. Pick another from the list.',
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = await meta.get(INDEX);
  const docs = await Promise.all((index?.value.ids ?? []).map((id) => projects.get(keyFor(id))));
  return docs
    .flatMap((d) => (d ? [d.value] : []))
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      imageCount: p.images.length,
      masterCount: p.images.filter((i) => i.master?.locked).length,
      thumbKeys: p.images.slice(0, 4).map((i) => i.thumbKey),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
