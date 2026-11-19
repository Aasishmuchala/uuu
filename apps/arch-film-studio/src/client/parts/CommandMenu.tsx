import { useEffect, useMemo } from 'react';

import type { Project, ProjectSummary } from '../../shared/project.ts';
import { CommandPalette } from '../kit.ts';
import { enterTakesFirst } from '../lib/paletteEnter.ts';
import { attentionScreen } from '../lib/progress.ts';
import { type Route, routeHash, SCREEN_LABELS, SCREENS } from '../lib/route.ts';

type Item = { id: string; label: string; auxiliaryData: { group: string } };

/**
 * Cmd+K: jump to any screen of the open project, any of its pictures by code
 * or name, or another project. It only changes the address; it starts nothing.
 */
export function CommandMenu({
  isOpen,
  onClose,
  project,
  projects,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: Project | undefined;
  projects: ProjectSummary[] | undefined;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const add = (group: string, label: string, route: Route) => out.push({ id: routeHash(route), label, auxiliaryData: { group } });
    if (project) {
      for (const screen of SCREENS) add('Screens', SCREEN_LABELS[screen], { kind: 'project', id: project.id, screen });
      for (const image of project.images) {
        add('Pictures', `${image.code} ${image.name}`, { kind: 'project', id: project.id, screen: attentionScreen(image), focus: image.id });
      }
    }
    add('Projects', 'All projects', { kind: 'projects' });
    for (const p of projects ?? []) {
      if (p.id !== project?.id) add('Projects', p.name, { kind: 'project', id: p.id, screen: 'overview' });
    }
    return out;
  }, [project, projects]);
  // The palette's search source: every item before typing, those whose name holds the words after.
  const source = useMemo(
    () => ({
      bootstrap: () => items,
      search: (query: string) => {
        const q = query.trim().toLowerCase();
        return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
      },
    }),
    [items]
  );

  // Enter on typed words takes the first result (the kit highlights none by itself).
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', enterTakesFirst, true);
    return () => window.removeEventListener('keydown', enterTakesFirst, true);
  }, [isOpen]);

  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={(open: boolean) => !open && onClose()}
      searchSource={source}
      label="Go to"
      value=""
      emptySearchText="Nothing by that name"
      onValueChange={(hash: string) => {
        onClose();
        if (items.some((i) => i.id === hash)) window.location.hash = hash;
      }}
    />
  );
}
