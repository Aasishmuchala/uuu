import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  defaultSettings,
  ENHANCEMENT_KEYS,
  IMAGE_EXTENSIONS,
  imageKeys,
  mediaUrl,
  outputUrl,
  UPLOAD_KEY_PATTERN,
} from './project.ts';

describe('UPLOAD_KEY_PATTERN', () => {
  test('accepts every key imageKeys makes', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      const keys = imageKeys('11111111-2222', 'aaaaaaaa-bbbb', ext);
      for (const key of Object.values(keys)) assert.ok(UPLOAD_KEY_PATTERN.test(key), key);
    }
  });

  test('refuses a key that climbs out of the folder', () => {
    assert.ok(!UPLOAD_KEY_PATTERN.test('p/../x/img/aaaaaaaa/work.jpg'));
  });
});

describe('mediaUrl and outputUrl', () => {
  test('mediaUrl encodes each part of the key', () => {
    assert.equal(mediaUrl('p/a b/x.jpg'), '/files/p/a%20b/x.jpg');
  });

  test('outputUrl is the stored file, with ?download when asked, else nothing', () => {
    assert.equal(outputUrl({ storedKey: 'media/x.png' }), '/files/media/x.png');
    assert.equal(outputUrl({ storedKey: 'media/x.png' }, true), '/files/media/x.png?download');
    assert.equal(outputUrl({}), undefined);
  });
});

describe('defaultSettings', () => {
  test('is strict, preserve, nothing enhanced, output 4k', () => {
    const s = defaultSettings();
    assert.equal(s.mode, 'strict');
    assert.equal(s.lighting, 'preserve');
    assert.equal(s.output, '4k');
    assert.equal(ENHANCEMENT_KEYS.length, Object.keys(s.enhancements).length);
    assert.ok(ENHANCEMENT_KEYS.every((k) => s.enhancements[k] === false));
  });
});
