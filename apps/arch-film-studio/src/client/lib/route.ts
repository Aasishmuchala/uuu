/**
 * The page's address: `#/` for all projects, `#/p/<projectId>/<screen>` for a
 * screen of one project, and `#/p/<projectId>/<screen>/<pictureId>` when one
 * picture or shot is in front. Reload and Back keep the place. Pure, for plain
 * Node (`route.test.ts`).
 */
import type { StageKey } from './stages.ts';

export const SCREENS = ['overview', 'renders', 'enhance', 'review', 'masters', 'storyboard', 'film'] as const;
export type Screen = (typeof SCREENS)[number];

/** The names the side bar, the address bar's trail and the command palette show. */
export const SCREEN_LABELS: Record<Screen, string> = {
  overview: 'Overview',
  renders: 'Renders',
  enhance: 'Enhance',
  review: 'Review',
  masters: 'Masters',
  storyboard: 'Storyboard',
  film: 'Film',
};

/** The stage each work screen is, for its lock (`stageLock`); the overview has none. */
export const SCREEN_STAGE: Record<Exclude<Screen, 'overview'>, StageKey> = {
  renders: 'upload',
  enhance: 'enhance',
  review: 'review',
  masters: 'masters',
  storyboard: 'storyboard',
  film: 'film',
};

/** A project, picture or shot id as the server makes them (the routers' own pattern). */
export const ID_PATTERN = /^[a-z0-9-]{8,64}$/;

/** Longer than any address this app writes: anything past it is not read. */
const MAX_HASH = 200;

export type Route =
  | { kind: 'projects' }
  | { kind: 'project'; id: string; screen: Screen; focus?: string | undefined };

export function isScreen(v: unknown): v is Screen {
  return typeof v === 'string' && (SCREENS as readonly string[]).includes(v);
}

/** Where an address leads. Anything unknown or malformed opens the remembered project's overview, else all projects. */
export function parseRoute(hash: string, remembered: string | null = null): Route {
  const fallback: Route =
    remembered && ID_PATTERN.test(remembered) ? { kind: 'project', id: remembered, screen: 'overview' } : { kind: 'projects' };
  if (typeof hash !== 'string' || hash.length > MAX_HASH) return fallback;
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  if (path === '') return fallback;
  if (path === '/' || path === '/projects') return { kind: 'projects' };
  const parts = path.split('/');
  if (parts[0] !== '' || parts[1] !== 'p') return fallback;
  const [, , id, screen, focus, ...rest] = parts;
  if (rest.length > 0 || !id || !ID_PATTERN.test(id)) return fallback;
  if (screen === undefined || screen === '') return { kind: 'project', id, screen: 'overview' };
  if (!isScreen(screen)) return fallback;
  if (focus === undefined || focus === '') return { kind: 'project', id, screen };
  if (!ID_PATTERN.test(focus)) return { kind: 'project', id, screen };
  return { kind: 'project', id, screen, focus };
}

/** The address of a route, the inverse of `parseRoute`. */
export function routeHash(route: Route): string {
  if (route.kind === 'projects') return '#/';
  const base = `#/p/${route.id}/${route.screen}`;
  return route.focus ? `${base}/${route.focus}` : base;
}
