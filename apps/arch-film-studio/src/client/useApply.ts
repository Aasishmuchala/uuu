import { useCallback } from 'react';

import type { Project } from '../shared/project.ts';
import { trpc } from './trpc.ts';

/**
 * Every change answers with the whole project: it is shown at once, and the
 * page then asks for it every 3 seconds while work is running.
 */
export function useApply() {
  const utils = trpc.useUtils();
  return useCallback(
    (p: Project) => {
      utils.project.get.setData({ id: p.id }, p);
      void utils.project.list.invalidate();
    },
    [utils]
  );
}

/** Ask for the project again now (after an upload, which is not a tRPC call). */
export function useRefresh() {
  const utils = trpc.useUtils();
  return useCallback(
    (id: string) => {
      void utils.project.get.invalidate({ id });
      void utils.project.list.invalidate();
    },
    [utils]
  );
}
