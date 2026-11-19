import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipAt, clipStarts, clock, moveIndex, overIndexAt, shotSpans, totalSeconds } from './timeline.ts';

test('each block is as wide as its seconds, and they add up to the running time', () => {
  const shots = [{ durationSeconds: 5 }, { durationSeconds: 10 }, { durationSeconds: 5 }];
  assert.equal(totalSeconds(shots), 20);
  assert.deepEqual(shotSpans(shots), [
    { start: 0, seconds: 5, share: 0.25 },
    { start: 5, seconds: 10, share: 0.5 },
    { start: 15, seconds: 5, share: 0.25 },
  ]);
  assert.deepEqual(shotSpans([]), []);
  assert.equal(totalSeconds([{ durationSeconds: Number.NaN }, { durationSeconds: 4 }]), 4);
});

test('the place storyboard.moveShot is given is where the shot ends up', () => {
  // [a, b, c, d]: a onto c's place lands third, as moveShot(a, 2) leaves it.
  assert.equal(moveIndex(0, 2, 4), 2);
  assert.equal(moveIndex(3, 0, 4), 0);
  assert.equal(moveIndex(1, 1, 4), null, 'onto itself: no move');
  assert.equal(moveIndex(1, 9, 4), 3, 'past the end: the last place');
  assert.equal(moveIndex(1, -2, 4), 0);
  assert.equal(moveIndex(5, 0, 4), null, 'a shot that is not there');
  // The same as the server's splice.
  const order = ['a', 'b', 'c', 'd'];
  for (let from = 0; from < 4; from++) {
    for (let over = 0; over < 4; over++) {
      const to = moveIndex(from, over, 4);
      if (to === null) continue;
      const rest = order.filter((_, i) => i !== from);
      rest.splice(to, 0, order[from]!);
      assert.equal(rest.indexOf(order[from]!), over);
    }
  }
});

test('a dragged block lands after every other block whose middle it has passed', () => {
  const mids = [50, 150, 250, 350];
  assert.equal(overIndexAt(10, mids, 0), 0);
  assert.equal(overIndexAt(200, mids, 0), 1);
  assert.equal(overIndexAt(400, mids, 0), 3);
  assert.equal(overIndexAt(10, mids, 3), 0);
  assert.equal(overIndexAt(260, mids, 3), 3);
});

test('running time reads as minutes and seconds', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(42), '0:42');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(720), '12:00');
  assert.equal(clock(Number.NaN), '0:00');
});

test('a moment of the joined preview falls in its clip', () => {
  const d = [4, 6, 5];
  assert.deepEqual(clipStarts(d), [0, 4, 10]);
  assert.deepEqual(clipAt(d, 0), { index: 0, local: 0 });
  assert.deepEqual(clipAt(d, 3.5), { index: 0, local: 3.5 });
  assert.deepEqual(clipAt(d, 4), { index: 1, local: 0 });
  assert.deepEqual(clipAt(d, 12), { index: 2, local: 2 });
  assert.deepEqual(clipAt(d, 99), { index: 2, local: 5 });
  assert.deepEqual(clipAt([], 3), { index: 0, local: 0 });
});
