import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRoute, routeHash, SCREENS } from './route.ts';

const P = 'a1b2c3d4-0000-4000-8000-000000000001';
const IMG = 'f0e1d2c3-0000-4000-8000-000000000002';

test('every screen of a project reads back from its own address', () => {
  for (const screen of SCREENS) {
    const route = { kind: 'project' as const, id: P, screen };
    assert.equal(routeHash(route), `#/p/${P}/${screen}`);
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
  const focused = { kind: 'project' as const, id: P, screen: 'review' as const, focus: IMG };
  assert.equal(routeHash(focused), `#/p/${P}/review/${IMG}`);
  assert.deepEqual(parseRoute(routeHash(focused)), focused);
  assert.equal(routeHash({ kind: 'projects' }), '#/');
  assert.deepEqual(parseRoute('#/'), { kind: 'projects' });
});

test('a project with no screen opens its overview', () => {
  assert.deepEqual(parseRoute(`#/p/${P}`), { kind: 'project', id: P, screen: 'overview' });
  assert.deepEqual(parseRoute(`#/p/${P}/`), { kind: 'project', id: P, screen: 'overview' });
});

test('an empty, unknown or malformed address opens the remembered project, else all projects', () => {
  const remembered = { kind: 'project', id: P, screen: 'overview' };
  for (const bad of ['', '#', '#/x', '#/p', '#/p/', '#/p/UPPER-CASE-ID/review', '#/p/short/review', `#/p/${P}/library`, `#/p/${P}/review/x/y`, '#/p/../..', `#/p/${P}/../..`, '#<script>alert(1)</script>', `#/p/${'a'.repeat(300)}`]) {
    assert.deepEqual(parseRoute(bad, P), remembered, bad);
    assert.deepEqual(parseRoute(bad, null), { kind: 'projects' }, bad);
  }
});

test('a remembered id that is not an id this app made is not used', () => {
  assert.deepEqual(parseRoute('', '../../etc'), { kind: 'projects' });
});

test('a picture that is not an id is dropped, the screen kept', () => {
  assert.deepEqual(parseRoute(`#/p/${P}/review/NOT_AN_ID`), { kind: 'project', id: P, screen: 'review' });
});
