import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defaultSettings, type ImageSettings, type ProjectImage, type Shot } from '../shared/project.ts';
import {
  buildEnhancePrompt,
  buildShotPrompt,
  parseAnalysis,
  parseStoryboard,
  selectedAdditions,
} from './prompts.ts';

const image = { id: 'aaaaaaaa', code: 'IMG-001', name: 'x.jpg' } as unknown as ProjectImage;
const settings = (over: Partial<ImageSettings> = {}): ImageSettings => ({ ...defaultSettings(), ...over });
const shot = (videoPrompt: string) => ({ videoPrompt }) as unknown as Shot;

const STRICT_PROMPT =
  'A photorealistic architectural photograph that is the reference image "ref1", reproduced exactly. It keeps the identical camera position, lens, framing, crop and perspective; the identical architecture, geometry, proportions and layout; every object, plant and surface in its existing position; and the identical materials, colours and finishes. The only change is photographic quality: clean, sharp, true-to-life photographic rendering with natural noise-free detail. The lighting keeps the original direction, time of day and colour temperature exactly. Every element in the frame is one that already exists in the original photograph.';

describe('buildEnhancePrompt', () => {
  test('the default settings give the exact strict prompt', () => {
    assert.equal(buildEnhancePrompt(image, defaultSettings()), STRICT_PROMPT);
  });

  const selective = settings({
    mode: 'selective',
    people: ['couples', 'custom'],
    peopleCustom: 'a chef',
    activities: ['dining'],
    additions: ['vehicles', 'other'],
    additionsOther: 'a red kite',
  });

  test('selective additions are listed in words', () => {
    assert.deepEqual(selectedAdditions(selective), [
      'people: couples and a chef, dining',
      'vehicles',
      'a red kite',
    ]);
    assert.match(buildEnhancePrompt(image, selective), /The image also includes exactly these additions and nothing else: /);
  });

  test('strict mode puts no "also includes" sentence in the prompt', () => {
    const strict = buildEnhancePrompt(image, { ...selective, mode: 'strict' });
    assert.ok(!strict.includes('also includes'));
  });

  test('golden-hour lighting is named', () => {
    const p = buildEnhancePrompt(image, settings({ lighting: 'golden-hour' }));
    assert.ok(p.includes('The scene is lit by warm golden-hour light with long, soft shadows,'));
  });

  test('custom lighting with empty text behaves as preserve', () => {
    const custom = buildEnhancePrompt(image, settings({ lighting: 'custom', lightingCustom: '  ' }));
    assert.equal(custom, buildEnhancePrompt(image, settings({ lighting: 'preserve' })));
  });

  test('a revision note ends the prompt, trimmed', () => {
    const p = buildEnhancePrompt(image, defaultSettings(), ' lift the shadows ');
    assert.ok(p.endsWith('Revision requested by the reviewer, applied within these rules: lift the shadows'));
  });
});

describe('buildShotPrompt', () => {
  test('adds the preservation rule', () => {
    assert.equal(
      buildShotPrompt(shot('Slow dolly-in.')),
      'Slow dolly-in. Photorealistic architectural cinematography; the architecture, materials, landscaping and objects stay exactly as in the first frame.'
    );
  });

  test('a 2,000-character prompt is cut to exactly 1,000 characters', () => {
    const p = buildShotPrompt(shot('a'.repeat(2000)));
    assert.equal(p.length, 1000);
    assert.ok(p.includes('…'));
  });
});

describe('parseStoryboard', () => {
  const one = (s: Record<string, unknown>) =>
    parseStoryboard(JSON.stringify({ title: 't', shots: [s] })).shots[0]!;

  test('durations are rounded into 2 to 10, and 6 when not a number', () => {
    assert.equal(one({ durationSeconds: 99 }).durationSeconds, 10);
    assert.equal(one({ durationSeconds: 1 }).durationSeconds, 2);
    assert.equal(one({ durationSeconds: 'x' }).durationSeconds, 6);
  });

  test('an unknown transition is a cut', () => {
    assert.equal(one({ transition: 'wipe' }).transition, 'cut');
    assert.equal(one({ transition: 'fade' }).transition, 'fade');
  });

  test('a missing title is "Untitled film"', () => {
    assert.equal(parseStoryboard('{"shots":[]}').title, 'Untitled film');
  });

  test('an answer wrapped in a json code fence parses', () => {
    const r = parseStoryboard('```json\n{"title":"Fenced","shots":[]}\n```');
    assert.equal(r.title, 'Fenced');
  });

  test('text with no "{" throws', () => {
    assert.throws(() => parseStoryboard('no object here'));
  });
});

describe('parseAnalysis', () => {
  test('peoplePresent is true only for the boolean true', () => {
    assert.equal(parseAnalysis('{"peoplePresent":"yes"}').peoplePresent, false);
    assert.equal(parseAnalysis('{"peoplePresent":true}').peoplePresent, true);
  });

  test('lists keep only the strings', () => {
    assert.deepEqual(parseAnalysis('{"materials":["oak",3]}').materials, ['oak']);
  });
});
