import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defaultSettings, type ImageSettings, type MasterRun } from '../shared/project.ts';
import {
  enhanceSize,
  masterNote,
  masterPlan,
  masterTarget,
  nearestRatio,
  ratiosAt,
  sizeClassFor,
  UPSCALE_CAPPED,
} from './models.ts';

// The door's row for Nano Banana Pro as `GET /gen/app/models` gives it (every
// ratio in one list, no per-size list), from engine/generate/registry.mjs.
const PRO = {
  id: 'gemini_image3_pro',
  resolutions: ['1K', '2K', '4K'],
  ratios: (
    '1344:768,768:1344,1024:1024,1184:864,864:1184,1536:672,832:1248,1248:832,896:1152,1152:896,' +
    '2048:2048,1696:2528,2528:1696,1792:2400,2400:1792,1856:2304,2304:1856,1536:2752,2752:1536,3168:1344,' +
    '4096:4096,3392:5056,5056:3392,3584:4800,4800:3584,3712:4608,4608:3712,3072:5504,5504:3072,6336:2688'
  ).split(','),
};

const settings = (patch: Partial<ImageSettings>): ImageSettings => ({ ...defaultSettings(), ...patch });

describe('size class', () => {
  test('long edges 1200, 2000 and 5000; custom 3000', () => {
    assert.equal(sizeClassFor(1200), '1K');
    assert.equal(sizeClassFor(1344), '1K');
    assert.equal(sizeClassFor(2000), '2K');
    assert.equal(sizeClassFor(5000), '4K');
    const original = settings({ output: 'original' });
    assert.equal(enhanceSize(original, { width: 1200, height: 800 }), '1K');
    assert.equal(enhanceSize(original, { width: 1500, height: 2000 }), '2K');
    assert.equal(enhanceSize(original, { width: 5000, height: 3000 }), '4K');
    assert.equal(enhanceSize(settings({ output: 'custom', customLongEdge: 3000 }), { width: 800, height: 600 }), '4K');
    assert.equal(enhanceSize(settings({ output: '4k' }), { width: 800, height: 600 }), '4K');
  });
});

describe('nearest ratio', () => {
  test('3:2, 16:9 and 9:16 uploads at 4K', () => {
    const at4k = ratiosAt(PRO, '4K');
    assert.equal(at4k.length, 10);
    assert.equal(nearestRatio(at4k, 3000, 2000), '5056:3392');
    assert.equal(nearestRatio(at4k, 1920, 1080), '5504:3072');
    assert.equal(nearestRatio(at4k, 1080, 1920), '3072:5504');
  });
  test('3:2, 16:9 and 9:16 uploads at 1K and 2K', () => {
    assert.equal(nearestRatio(ratiosAt(PRO, '2K'), 3000, 2000), '2528:1696');
    assert.equal(nearestRatio(ratiosAt(PRO, '2K'), 1920, 1080), '2752:1536');
    assert.equal(nearestRatio(ratiosAt(PRO, '2K'), 1080, 1920), '1536:2752');
    assert.equal(nearestRatio(ratiosAt(PRO, '1K'), 1920, 1080), '1344:768');
  });
  test('each size keeps only its own shapes', () => {
    // 1536:672 is a 1K shape and 3168:1344 a 2K one, whatever their long edge.
    assert.ok(ratiosAt(PRO, '1K').includes('1536:672'));
    assert.ok(!ratiosAt(PRO, '2K').includes('1536:672'));
    assert.ok(ratiosAt(PRO, '2K').includes('3168:1344'));
    assert.ok(!ratiosAt(PRO, '4K').includes('3168:1344'));
    assert.equal(nearestRatio(ratiosAt(PRO, '4K'), 2100, 900), '6336:2688');
    // A per-size list from the door is used as it is.
    assert.deepEqual(ratiosAt({ id: 'x', ratios: ['1:1', '2:1'], ratiosBy: { '1K': ['2:1'] } }, '1K'), ['2:1']);
  });
});

describe('master rule', () => {
  test('targets', () => {
    assert.equal(masterTarget(settings({ output: '4k' }), { width: 100, height: 50 }), 3840);
    assert.equal(masterTarget(settings({ output: 'original' }), { width: 3000, height: 5000 }), 5000);
    assert.equal(masterTarget(settings({ output: 'custom', customLongEdge: 2400 }), { width: 1, height: 1 }), 2400);
  });
  test('5056 is reused', () => {
    assert.deepEqual(masterPlan(5056, 3840), { reuse: true, capped: false });
  });
  test('1344 to 3840: scale 2, since 4 would pass 4096', () => {
    assert.deepEqual(masterPlan(1344, 3840), { reuse: false, scale: 2 });
  });
  test('1920 to 3840: scale 2', () => {
    assert.deepEqual(masterPlan(1920, 3840), { reuse: false, scale: 2 });
  });
  test('960 to 3840: scale 4', () => {
    assert.deepEqual(masterPlan(960, 3840), { reuse: false, scale: 4 });
  });
  test('2528 to 3840: reused, with the 4096 sentence', () => {
    assert.deepEqual(masterPlan(2528, 3840), { reuse: true, capped: true });
    const m: MasterRun = {
      state: 'succeeded',
      sourceRunId: 'r',
      createdAt: '',
      targetLongEdge: 3840,
      locked: true,
      reusedEnhancement: true,
      outputSize: { width: 2528, height: 1696 },
    };
    assert.equal(masterNote(m), UPSCALE_CAPPED);
    assert.equal(UPSCALE_CAPPED, 'The upscaler here stops at 4096 px, so this master stays at its approved size.');
    assert.equal(masterNote({ ...m, outputSize: { width: 5056, height: 3392 } }), undefined);
  });
});
