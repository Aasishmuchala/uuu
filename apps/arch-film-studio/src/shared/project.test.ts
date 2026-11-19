import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  defaultSettings,
  downloadUrl,
  ENHANCEMENT_KEYS,
  filmFileName,
  IMAGE_EXTENSIONS,
  imageKeys,
  masterFileName,
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

  test('outputUrl and downloadUrl carry a readable name to save under', () => {
    assert.equal(outputUrl({ storedKey: 'media/x.png' }, 'Harbour house IMG-002 master'), '/files/media/x.png?download=Harbour%20house%20IMG-002%20master');
    assert.equal(downloadUrl('/files/f.mp4', 'East garden film'), '/files/f.mp4?download=East%20garden%20film');
    assert.equal(downloadUrl('/files/f.mp4', '  '), '/files/f.mp4?download');
    assert.equal(downloadUrl('/files/f.mp4', false), '/files/f.mp4');
  });
});

describe('download names', () => {
  test('the film is named for the project, and its title when that says more', () => {
    assert.equal(filmFileName('East garden film', 'Stone and water'), 'East garden film - Stone and water');
    assert.equal(filmFileName('Harbour house', ''), 'Harbour house film');
    assert.equal(filmFileName('Harbour house', 'harbour house'), 'Harbour house film');
    assert.equal(filmFileName('', undefined), 'Film');
  });

  test('a master is named for the project, the code and the picture', () => {
    assert.equal(masterFileName('Harbour house', { code: 'IMG-002', name: 'north-elevation.jpg' }), 'Harbour house IMG-002 north-elevation master');
    assert.equal(masterFileName('Harbour house', { code: 'IMG-002', name: '' }), 'Harbour house IMG-002 master');
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
