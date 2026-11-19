import { type Route, routeHash } from '../lib/route.ts';

/** Moves the page. The address is the one record of where it is; App follows it. */
export function go(route: Route) {
  const hash = routeHash(route);
  if (window.location.hash !== hash) window.location.hash = hash;
}
