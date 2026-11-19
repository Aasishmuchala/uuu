import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { attachmentHeader, attachmentName, withDownload } from './attachment.ts';

describe('attachmentName', () => {
  test('keeps a readable name and the stored file’s own ending', () => {
    assert.equal(attachmentName('storyboard-1-Kitchen at dusk.png', 'tasks/abc/1f2e.png'), 'storyboard-1-Kitchen at dusk.png');
    assert.equal(attachmentName('render-to-film.mp4', 'edits/x/9a.mp4'), 'render-to-film.mp4');
    assert.equal(attachmentName('film-still-warm.png', 'tasks/abc/1f2e.jpg'), 'film-still-warm.jpg');
  });

  test('drops quotes, slashes and marks, so the header needs no quoting', () => {
    assert.equal(attachmentName('../"Café" / scène\r\n.png', 'a/b.png'), 'Cafe scene.png');
    assert.equal(attachmentName('a;b=c"d', 'a/b.mp4'), 'a b c d.mp4');
  });

  test('falls back to the key’s last part when nothing usable is asked', () => {
    assert.equal(attachmentName('', 'tasks/abc/1f2e.png'), '1f2e.png');
    assert.equal(attachmentName('"/\\', 'tasks/abc/1f2e.png'), '1f2e.png');
    assert.equal(attachmentName(undefined, 'tasks/abc/1f2e.png'), '1f2e.png');
    assert.equal(attachmentName(['first.png', 'second.png'], 'x/y.png'), 'first.png');
  });

  test('is at most 80 characters before the ending', () => {
    const name = attachmentName(`${'a'.repeat(200)}.png`, 'x/y.png');
    assert.equal(name, `${'a'.repeat(80)}.png`);
  });
});

describe('attachmentHeader', () => {
  test('only when asked', () => {
    assert.equal(attachmentHeader({}, 'x/y.png'), undefined);
    assert.equal(attachmentHeader({ download: '' }, 'x/y.png'), 'attachment; filename="y.png"');
    assert.equal(attachmentHeader({ download: 'Shot 2' }, 'x/y.mp4'), 'attachment; filename="Shot 2.mp4"');
  });
});

describe('withDownload', () => {
  test('adds the name as a query, encoded', () => {
    assert.equal(withDownload('/api/library/still/a1', 'Shot 1 & 2.png'), '/api/library/still/a1?download=Shot%201%20%26%202.png');
    assert.equal(withDownload('/files/x.png?v=1', 'a.png'), '/files/x.png?v=1&download=a.png');
  });
});
