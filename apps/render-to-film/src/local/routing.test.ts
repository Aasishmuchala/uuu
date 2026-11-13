import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLIP_UPSCALE_SENTENCE,
  DROPPED,
  gen4ImageSize,
  IMAGE_MODELS,
  imageModelName,
  VIDEO_MODELS,
  videoModelName,
  videoKeyframeLimit,
  videoModelsWith,
} from '../models.ts';
import { PRECISION_MAX_SIDE, ROUTED_MODELS, routeTask, snapAspectRatio } from './routing.ts';

const A = '/files/renders/local/a.png';
const B = '/files/renders/local/cast.png';
const C = '/files/renders/local/light.png';
const D = '/files/renders/local/end.png';

/** The engine body of a route, or a failure that prints what came back. */
function engine(type: string, options: Record<string, unknown>) {
  const r = routeTask(type, options);
  assert.ok('engine' in r, `${type} did not route: ${JSON.stringify(r)}`);
  return r.engine;
}

/** What `submitStill` sends: tagged references (render, cast, light). */
const tagged = (...urls: string[]) => urls.map((url, i) => ({ tag: ['render', 'cast', 'light', 'more'][i], url }));
const plain = (...urls: string[]) => urls.map((url) => ({ url }));

describe('stills: one fixture per kept preset, shaped as submitStill sends it', () => {
  test('gen-4-image: a size, no resolution field; refs tagged', () => {
    assert.deepEqual(
      engine('ref_image_to_image', { name: 'n', text_prompt: 'p', reference_images: tagged(A, B), width: 1920, height: 1080 }),
      { model: 'gen4_image', kind: 'still_variation', inputs: [{ url: A, role: 'ref' }, { url: B, role: 'ref' }], prompt: 'p', ratio: '1920:1080', resolution: '1080p' }
    );
    assert.deepEqual(
      engine('ref_image_to_image', { text_prompt: 'p', reference_images: tagged(A), width: 720, height: 1280 }),
      { model: 'gen4_image', kind: 'still_variation', inputs: [{ url: A, role: 'ref' }], prompt: 'p', ratio: '720:1280', resolution: '720p' }
    );
  });

  test('nano-banana-pro: 2K tier, 16:9 becomes the tier pair', () => {
    assert.deepEqual(
      engine('gemini_3_pro', { name: 'n', text_prompt: 'p', reference_images: tagged(A, B, C), aspect_ratio: '16:9', image_size: '2K' }),
      { model: 'gemini_image3_pro', kind: 'still_variation', inputs: [A, B, C].map((url) => ({ url, role: 'ref' })), prompt: 'p', ratio: '2752:1536', resolution: '2K' }
    );
  });

  test('nano-banana-pro: 4K tier and 1K tier pick pairs of their own size', () => {
    const k4 = engine('gemini_3_pro', { text_prompt: 'p', reference_images: tagged(A), aspect_ratio: '1:1', image_size: '4K' });
    assert.equal(k4.ratio, '4096:4096');
    assert.equal(k4.resolution, '4K');
    const k1 = engine('gemini_3_pro', { text_prompt: 'p', reference_images: tagged(A), aspect_ratio: '1:1', image_size: '1K' });
    assert.equal(k1.ratio, '1024:1024');
  });

  test('nano-banana-2: its own row and the 512px tier below 1K is not asked for', () => {
    const b = engine('gemini_3_1_flash_image', { text_prompt: 'p', reference_images: tagged(A), aspect_ratio: '1:1', image_size: '2K' });
    assert.equal(b.model, 'gemini_image3.1_flash');
    assert.equal(b.ratio, '2048:2048');
    assert.equal(b.resolution, '2K');
  });

  test('nano-banana-2-1: lowercase resolution words come out as the row\'s words', () => {
    assert.deepEqual(
      engine('nano_banana_2_1', { name: 'n', prompt: 'p', referenceImages: tagged(A), aspectRatio: '1:1', resolution: '4k' }),
      { model: 'nano_banana_2.1', kind: 'still_variation', inputs: [{ url: A, role: 'ref' }], prompt: 'p', ratio: '4096:4096', resolution: '4K' }
    );
  });

  test('gpt-image-2: size "4" is the 4K tier; 21:9 is its widest pair', () => {
    assert.deepEqual(
      engine('gpt_image_2', { name: 'n', prompt: 'p', referenceImages: [{ tag: 'render', url: A, width: 100, height: 100 }], size: '4', aspectRatio: '21:9', quality: 'high' }),
      { model: 'gpt_image_2', kind: 'still_variation', inputs: [{ url: A, role: 'ref' }], prompt: 'p', ratio: '3840:1648', resolution: '4K' }
    );
  });

  test('gpt-image-2-5-sunburst and -flare keep their own ids (they are on Runway)', () => {
    for (const [alias, model] of [['gpt_image_2_5_sunburst', 'gpt_image_2_5_sunburst'], ['gpt_image_2_5_flare', 'gpt_image_2_5_flare']] as const) {
      const b = engine(alias, { prompt: 'p', referenceImages: tagged(A), size: '2', aspectRatio: '16:9', quality: 'high' });
      assert.equal(b.model, model);
      assert.equal(b.ratio, '2560:1440');
      assert.equal(b.resolution, '2K');
    }
  });

  test('seedream-5-pro: plain refs, 2k tier', () => {
    assert.deepEqual(
      engine('seedream_5_pro', { name: 'n', prompt: 'p', referenceImages: plain(A, B), aspectRatio: '16:9', resolution: '2k' }),
      { model: 'seedream5_pro', kind: 'still_variation', inputs: [A, B].map((url) => ({ url, role: 'ref' })), prompt: 'p', ratio: '2720:1530', resolution: '2K' }
    );
  });

  test('seedream-5 (Lite): flat price, so the tier picks the pair and no resolution is sent', () => {
    const b = engine('seedream_5', { prompt: 'p', referenceImages: plain(A), aspectRatio: '1:1', resolution: '3k' });
    assert.deepEqual(b, { model: 'seedream5_lite', kind: 'still_variation', inputs: [{ url: A, role: 'ref' }], prompt: 'p', ratio: '3072:3072' });
  });

  test('flux-2-max: Higgsfield flux_2, 4 MP is held to its 2k, 21:9 to its 16:9', () => {
    assert.deepEqual(
      engine('bfl_flux_2_max', { name: 'n', prompt: 'p', referenceImages: tagged(A, B), aspectRatio: '21:9', resolution: '4' }),
      { model: 'hf.flux_2', kind: 'still_variation', inputs: [A, B].map((url) => ({ url, role: 'ref' })), prompt: 'p', ratio: '16:9', resolution: '2k' }
    );
    assert.equal(engine('bfl_flux_2_max', { prompt: 'p', referenceImages: tagged(A), aspectRatio: '1:1', resolution: '1' }).resolution, '1k');
  });

  test('grok-imagine-2: three refs at most, 1k tier', () => {
    assert.deepEqual(
      engine('grok_imagine_image_2', { name: 'n', textPrompt: 'p', referenceImages: tagged(A, B, C), edit: true, aspectRatio: '16:9', resolution: '1k' }),
      { model: 'grok_imagine_image_2', kind: 'still_variation', inputs: [A, B, C].map((url) => ({ url, role: 'ref' })), prompt: 'p', ratio: '1280:720', resolution: '1K' }
    );
  });
});

describe('clips: one fixture per kept preset, shaped as submitVideo sends it', () => {
  test('seedance-2 with first and last frame, 4k, portrait', () => {
    assert.deepEqual(
      engine('seedance_2', {
        name: 'n', textPrompt: 'p',
        referenceImages: [{ url: A, type: 'first_frame' }, { url: D, type: 'end_frame' }],
        resolution: '4k', aspectRatio: '9:16', duration: 7, generateAudio: false,
      }),
      { model: 'seedance2', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }, { url: D, role: 'last' }], prompt: 'p', seconds: 7, ratio: '2160:3840', resolution: '4K' }
    );
  });

  test('seedance-2 with extra images: all plain references, in order', () => {
    const b = engine('seedance_2', { textPrompt: 'p', referenceImages: plain(A, B, C), resolution: '720p', aspectRatio: '16:9', duration: 5 });
    assert.deepEqual(b.inputs, [A, B, C].map((url) => ({ url, role: 'ref' })));
    assert.equal(b.ratio, '1280:720');
    assert.equal(b.resolution, '720p');
  });

  test('seedance-2-fast: 4k is held to 720p (nearest not above the row\'s highest)', () => {
    const b = engine('seedance_2_fast', { textPrompt: 'p', referenceImages: [{ url: A, type: 'first_frame' }], resolution: '1080p', aspectRatio: '16:9', duration: 5 });
    assert.deepEqual(b, { model: 'seedance2_fast', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 5, ratio: '1280:720', resolution: '720p' });
  });

  test('seedance-2-5: 1080p, 21 seconds stays inside 4 to 30', () => {
    const b = engine('seedance_2_5', { textPrompt: 'p', referenceImages: [{ url: A, type: 'first_frame' }], resolution: '1080p', aspectRatio: '1:1', duration: 21 });
    assert.deepEqual(b, { model: 'seedance2_5', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 21, ratio: '1440:1440', resolution: '1080p' });
  });

  test('kling-3-pro: first and last frame, no resolution, shape to a listed pair', () => {
    assert.deepEqual(
      engine('kling_3_0_pro', { name: 'n', textPrompt: 'p', referenceImages: plain(A, D), aspectRatio: '16:9', duration: 5, cfgScale: 0.5, providerSettings: { sound: false } }),
      { model: 'kling3.0_pro', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }, { url: D, role: 'last' }], prompt: 'p', seconds: 5, ratio: '1920:1080' }
    );
  });

  test('kling-3-4k: its own 4K pairs', () => {
    const b = engine('kling_3_0_4k', { textPrompt: 'p', referenceImages: plain(A), aspectRatio: '9:16', duration: 3 });
    assert.deepEqual(b, { model: 'kling3.0_4k', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 3, ratio: '2160:3840' });
  });

  test('kling-o3-pro: first frame only, square', () => {
    const b = engine('kling_o3_pro', { textPrompt: 'p', referenceImages: plain(A), aspectRatio: '1:1', duration: 15 });
    assert.deepEqual(b, { model: 'klingO3_pro', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 15, ratio: '1440:1440' });
  });

  test('gen-4-5 on the plain route: first frame, size from the shape', () => {
    assert.deepEqual(
      engine('gen4.5', { name: 'n', route: 't2v', text_prompt: 'p', init_image: A, seconds: 5, width: 1280, height: 720, seed: 4 }),
      { model: 'gen4.5', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 5, ratio: '1280:720' }
    );
  });

  test('gen-4-5 with a frame in between and a last frame: both dropped, the job still made', () => {
    const b = engine('gen4.5', {
      name: 'n', route: 'k2v', text_prompt: 'p', seconds: 6,
      keyframes: [{ image: A, timestamp: 0 }, { image: B, timestamp: 3 }, { image: D, timestamp: 6 }],
      width: 960, height: 960,
    });
    assert.deepEqual(b, { model: 'gen4.5', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 6, ratio: '960:960' });
  });

  test('gen-4-5 with the keyframes out of order still takes the earliest as the first frame', () => {
    const b = engine('gen4.5', { route: 'k2v', text_prompt: 'p', seconds: 6, keyframes: [{ image: D, timestamp: 6 }, { image: A, timestamp: 0 }], width: 720, height: 1280 });
    assert.deepEqual(b.inputs, [{ url: A, role: 'first' }]);
    assert.equal(b.ratio, '720:1280');
  });

  test('gen-4-turbo', () => {
    assert.deepEqual(
      engine('gen4_turbo', { name: 'n', route: 'i2v', text_prompt: 'p', init_image: A, seconds: 5, width: 720, height: 1280, seed: 1, negative_prompt: 'x' }),
      { model: 'gen4_turbo', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 5, ratio: '720:1280' }
    );
  });

  test('veo-3-1 and veo-3-1-fast: the model comes from the call\'s own field; 1080p picks the 1080 pair', () => {
    assert.deepEqual(
      engine('veo3_1', { name: 'n', route: 'i2v', model: 'veo-3.1', startFrame: { url: A }, endFrame: { url: D }, text_prompt: 'p', seconds: 8, aspectRatio: '16:9', resolution: '1080p', negative_prompt: 'x' }),
      { model: 'veo3.1', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }, { url: D, role: 'last' }], prompt: 'p', seconds: 8, ratio: '1920:1080' }
    );
    const f = engine('veo3_1', { route: 'i2v', model: 'veo-3.1-fast', startFrame: { url: A }, text_prompt: 'p', seconds: 6, aspectRatio: '9:16', resolution: '720p' });
    assert.deepEqual(f, { model: 'veo3.1_fast', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }], prompt: 'p', seconds: 6, ratio: '720:1280' });
  });

  test('minimax-h3 is hailuo3: resolution words in lower case, ratio adaptive kept', () => {
    assert.deepEqual(
      engine('minimax_hailuo_3_0', { name: 'n', textPrompt: 'p', referenceImages: [{ url: A, type: 'first_frame' }, { url: D, type: 'end_frame' }], resolution: '768P', duration: 5, ratio: 'adaptive' }),
      { model: 'hailuo3', kind: 'image_to_video', inputs: [{ url: A, role: 'first' }, { url: D, role: 'last' }], prompt: 'p', seconds: 5, ratio: 'adaptive', resolution: '768p' }
    );
    assert.equal(engine('minimax_hailuo_3_0', { textPrompt: 'p', referenceImages: plain(A), resolution: '2K', duration: 5, ratio: '16:9' }).resolution, '2k');
  });

  test('wan-2-6 is Higgsfield wan2_6: the picture is a reference, the size says the quality', () => {
    assert.deepEqual(
      engine('wan_2_6', { name: 'n', textPrompt: 'p', referenceImages: [{ url: A }], resolution: '1920x1080', duration: 10, generateAudio: false }),
      { model: 'hf.wan2_6', kind: 'image_to_video', inputs: [{ url: A, role: 'ref' }], prompt: 'p', seconds: 10, ratio: '16:9', resolution: '1080p' }
    );
    const sq = engine('wan_2_6', { textPrompt: 'p', referenceImages: [{ url: A }], resolution: '960x960', duration: 5 });
    assert.equal(sq.ratio, '1:1');
    assert.equal(sq.resolution, '720p');
  });
});

describe('upscalers', () => {
  test('precision: one image, the factor as the scale, no prompt', () => {
    assert.deepEqual(
      engine('magnific_precision_upscaler_v2', { name: 'n', prompt: 'long text', image: { url: A, tag: 'still' }, scaleFactor: 2, flavor: 'photo' }),
      { model: 'magnific_precision_upscaler_v2', kind: 'still_upscale', inputs: [{ url: A, role: 'image' }], prompt: '', scale: 2 }
    );
  });

  test('precision: with the picture\'s size known, the result stays within 4096 px', () => {
    const at = (side: number, f: number) => routeTask('magnific_precision_upscaler_v2', { image: { url: A }, scaleFactor: f, sourceLongSide: side });
    assert.equal(PRECISION_MAX_SIDE, 4096);
    assert.equal((at(1024, 4) as { engine: { scale: number } }).engine.scale, 4);
    assert.equal((at(2000, 4) as { engine: { scale: number } }).engine.scale, 2);
    assert.equal((at(2048, 2) as { engine: { scale: number } }).engine.scale, 2);
    assert.deepEqual(at(3000, 2), { dropped: 'This picture is already as large as the upscaler goes here.' });
  });

  test('creative is Higgsfield upscale_image: 4x asks 4k, 2x asks 2k', () => {
    assert.deepEqual(
      engine('magnific_creative_upscaler', { name: 'n', prompt: 'x', image: { url: A, tag: 'still' }, scaleFactor: 4, optimizedFor: 'films_n_photography', creativity: 0 }),
      { model: 'hf.upscale_image', kind: 'still_upscale', inputs: [{ url: A, role: 'image' }], prompt: '', resolution: '4k' }
    );
    assert.equal(engine('magnific_creative_upscaler', { image: { url: A }, scaleFactor: 2 }).resolution, '2k');
  });
});

describe('what is not made through the door', () => {
  test('claude_api and media_processing_v2 pass their options on', () => {
    const o = { model: 'm', prompt: 'p' };
    assert.deepEqual(routeTask('claude_api', o), { claude: o });
    assert.deepEqual(routeTask('media_processing_v2', { operation: 'trim' }), { media: { operation: 'trim' } });
  });

  test('each dropped preset answers its sentence', () => {
    assert.deepEqual(routeTask('krea_image_3', {}), { dropped: 'This picture model is not available on this Mac yet.' });
    assert.deepEqual(routeTask('ltx_2_5_pro', {}), { dropped: 'This video model is not available on this Mac yet.' });
    assert.deepEqual(routeTask('media_upscale', {}), { dropped: CLIP_UPSCALE_SENTENCE });
    assert.deepEqual(routeTask('flux_video_upscale', {}), { dropped: 'Clip upscale is not available on this Mac yet.' });
    assert.deepEqual(routeTask('workflow_aleph_2', {}), { dropped: 'AI grades and edits of a clip are not available on this Mac yet. Use the built-in look.' });
  });

  test('an unknown type is refused in plain words', () => {
    assert.deepEqual(routeTask('no_such_type', {}), { dropped: 'This kind of job is not available on this Mac yet.' });
  });

  test('DROPPED keeps the names of old library items readable', () => {
    assert.equal(imageModelName('krea-image-3'), 'Krea Image 3');
    assert.equal(videoModelName('ltx-2-5-pro'), 'LTX-2.5 Pro');
    assert.equal(imageModelName('nano-banana-pro'), 'Nano Banana Pro');
    for (const d of DROPPED) assert.ok(d.sentence.endsWith('.'));
  });
});

describe('references over a row\'s limit', () => {
  test('stills: the tail goes first, so the render stays and the light reference leaves before the cast sheet', () => {
    // Grok takes 3. The call site sends render, cast sheet, light reference.
    const b = engine('grok_imagine_image_2', { textPrompt: 'p', referenceImages: tagged(A, B, C, D), aspectRatio: '16:9', resolution: '2k' });
    assert.deepEqual(b.inputs.map((i) => i.url), [A, B, C]);
    const g = engine('ref_image_to_image', { text_prompt: 'p', reference_images: tagged(A, B, C, D), width: 1280, height: 720 });
    assert.deepEqual(g.inputs.map((i) => i.url), [A, B, C]);
  });

  test('clips: the frame stays first, extras are cut at the row\'s count', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `/files/x${i}.png`);
    const b = engine('seedance_2', { textPrompt: 'p', referenceImages: plain(...urls), resolution: '720p', aspectRatio: '16:9', duration: 5 });
    assert.equal(b.inputs.length, 9);
    assert.equal(b.inputs[0]!.url, urls[0]);
    assert.deepEqual(b.inputs.map((i) => i.url), urls.slice(0, 9));
  });

  test('wan takes one picture', () => {
    const b = engine('wan_2_6', { textPrompt: 'p', referenceImages: plain(A, B), resolution: '1280x720', duration: 5 });
    assert.deepEqual(b.inputs, [{ url: A, role: 'ref' }]);
  });
});

describe('ratios, seconds and prompts', () => {
  test('snapAspectRatio: 1920 x 1080 is 16:9 and 1000 x 1000 is the square, for every image preset', () => {
    for (const m of IMAGE_MODELS) {
      assert.equal(snapAspectRatio(1920, 1080, m.alias), '16:9', m.id);
      assert.equal(snapAspectRatio(1000, 1000, m.alias), '1:1', m.id);
      assert.ok((m.aspectRatios as readonly string[]).includes(snapAspectRatio(3000, 1000, m.alias)!), m.id);
    }
    assert.equal(snapAspectRatio(1080, 1920, 'seedance_2'), '9:16');
    assert.equal(snapAspectRatio(1000, 1000, 'whatever'), '1:1');
    assert.equal(snapAspectRatio(0, 10, 'x'), undefined);
    assert.equal(snapAspectRatio(Number.NaN, 10, 'x'), undefined);
  });

  test('a flux preset snaps to the five shapes Higgsfield lists, not to 21:9', () => {
    assert.equal(snapAspectRatio(2100, 900, 'bfl_flux_2_max'), '16:9');
  });

  test('1920 x 1080 and 1000 x 1000 reach the row\'s own pairs', () => {
    const wide = engine('gen4.5', { route: 't2v', text_prompt: 'p', init_image: A, seconds: 5, width: 1920, height: 1080 });
    assert.equal(wide.ratio, '1280:720');
    const sq = engine('gen4.5', { route: 't2v', text_prompt: 'p', init_image: A, seconds: 5, width: 1000, height: 1000 });
    assert.equal(sq.ratio, '960:960');
    assert.equal(engine('gen4_turbo', { route: 'i2v', text_prompt: 'p', init_image: A, seconds: 5, width: 1000, height: 1000 }).ratio, '960:960');
  });

  test('seconds go to the row\'s nearest: a list, and the ends of a range', () => {
    const veo = (s: number) => engine('veo3_1', { model: 'veo-3.1', startFrame: { url: A }, text_prompt: 'p', seconds: s, aspectRatio: '16:9', resolution: '720p' }).seconds;
    assert.deepEqual([3, 4, 5, 7, 12].map(veo), [4, 4, 4, 6, 8]);
    const turbo = (s: number) => engine('gen4_turbo', { init_image: A, text_prompt: 'p', seconds: s, width: 1280, height: 720 }).seconds;
    assert.deepEqual([1, 5, 40].map(turbo), [2, 5, 10]);
    const wan = (s: number) => engine('wan_2_6', { textPrompt: 'p', referenceImages: plain(A), resolution: '1280x720', duration: s }).seconds;
    assert.deepEqual([4, 8, 13].map(wan), [5, 10, 15]);
  });

  test('the prompt is cut to the row\'s limit at a sentence', () => {
    const long = `${'A sentence of some length goes here. '.repeat(40)}`;
    const b = engine('gen4_turbo', { init_image: A, text_prompt: long, seconds: 5, width: 1280, height: 720 });
    assert.ok(b.prompt.length <= 1000);
    assert.ok(b.prompt.endsWith('.'));
    const g = engine('grok_imagine_image_2', { textPrompt: long.repeat(3), referenceImages: tagged(A), aspectRatio: '16:9', resolution: '2k' });
    assert.ok(g.prompt.length <= 2500);
    const gem = engine('gemini_3_pro', { text_prompt: long.repeat(3), reference_images: tagged(A), aspect_ratio: '16:9', image_size: '2K' });
    assert.equal(gem.prompt.length, long.length * 3);
  });

  test('negative prompts and seeds are not in the body', () => {
    const b = engine('veo3_1', { model: 'veo-3.1', startFrame: { url: A }, text_prompt: 'p', seconds: 8, aspectRatio: '16:9', resolution: '720p', negative_prompt: 'x', seed: 4 });
    assert.deepEqual(Object.keys(b).sort(), ['inputs', 'kind', 'model', 'prompt', 'ratio', 'seconds']);
  });

  test('a body never carries an undefined field', () => {
    const b = engine('gemini_3_pro', { text_prompt: 'p', reference_images: tagged(A), aspect_ratio: '16:9', image_size: '2K' });
    for (const v of Object.values(b)) assert.notEqual(v, undefined);
  });
});

describe('models.ts and routing agree', () => {
  test('gen4ImageSize gives sizes that are pairs of the Gen-4 Image row', () => {
    for (const res of ['720p', '1080p']) {
      for (const [w, h] of [[1920, 1080], [1080, 1920], [1000, 1000]] as const) {
        const s = gen4ImageSize(res, w, h);
        const b = engine('ref_image_to_image', { text_prompt: 'p', reference_images: tagged(A), ...s });
        assert.equal(b.ratio, `${s.width}:${s.height}`, `${res} ${w}x${h}`);
      }
    }
  });

  test('every image preset, every shape it offers and every resolution it offers routes to a listed size', () => {
    const tierFor: Record<string, string> = {};
    for (const m of IMAGE_MODELS) {
      for (const aspect of m.aspectRatios as readonly string[]) {
        for (const r of m.resolutions) {
          const options: Record<string, unknown> =
            m.alias === 'ref_image_to_image'
              ? { text_prompt: 'p', reference_images: tagged(A), ...gen4ImageSize(r.id, ...(aspect === '1:1' ? [1, 1] : aspect === '9:16' ? [9, 16] : [16, 9]) as [number, number]) }
              : { text_prompt: 'p', prompt: 'p', textPrompt: 'p', reference_images: tagged(A), referenceImages: tagged(A), aspect_ratio: aspect, aspectRatio: aspect, image_size: r.id, resolution: r.id, size: r.id };
          const b = engine(m.alias, options);
          assert.match(b.ratio ?? '', /^\d+:\d+$/, `${m.id} ${aspect} ${r.id}`);
          tierFor[`${m.id}/${r.id}`] = `${b.resolution ?? '-'}`;
        }
      }
    }
    // A few tiers read off by hand.
    assert.equal(tierFor['nano-banana-pro/4K'], '4K');
    assert.equal(tierFor['gpt-image-2/1'], '1K');
    assert.equal(tierFor['seedream-5-pro/1k'], '1K');
    assert.equal(tierFor['grok-imagine-2/2k'], '2K');
    assert.equal(tierFor['flux-2-max/1'], '1k');
    assert.equal(tierFor['seedream-5/3k'], '-');
  });

  test('every video preset routes, and a clip at each of its resolutions keeps its tier', () => {
    const fixtureFor = (alias: string, id: string, res: string): Record<string, unknown> => {
      switch (alias) {
        case 'seedance_2': case 'seedance_2_fast': case 'seedance_2_5':
          return { textPrompt: 'p', referenceImages: [{ url: A, type: 'first_frame' }], resolution: res, aspectRatio: '16:9', duration: 5 };
        case 'kling_3_0_pro': case 'kling_3_0_4k': case 'kling_o3_pro':
          return { textPrompt: 'p', referenceImages: plain(A), aspectRatio: '16:9', duration: 5 };
        case 'gen4.5': case 'gen4_turbo':
          return { route: 'i2v', text_prompt: 'p', init_image: A, seconds: 5, width: 1280, height: 720 };
        case 'veo3_1':
          return { model: id === 'veo-3-1-fast' ? 'veo-3.1-fast' : 'veo-3.1', startFrame: { url: A }, text_prompt: 'p', seconds: 6, aspectRatio: '16:9', resolution: res };
        case 'minimax_hailuo_3_0':
          return { textPrompt: 'p', referenceImages: plain(A), resolution: res === '768p' ? '768P' : '2K', duration: 5, ratio: 'adaptive' };
        case 'wan_2_6':
          return { textPrompt: 'p', referenceImages: plain(A), resolution: res === '720p' ? '1280x720' : '1920x1080', duration: 5 };
        default:
          throw new Error(`no fixture for ${alias}`);
      }
    };
    for (const m of VIDEO_MODELS) {
      for (const r of m.resolutions) {
        const b = engine(m.alias, fixtureFor(m.alias, m.id, r.id));
        assert.equal(b.kind, 'image_to_video', m.id);
        assert.ok(ROUTED_MODELS.includes(b.model), `${m.id} -> ${b.model}`);
        assert.equal(b.inputs[0]!.role, m.id === 'wan-2-6' ? 'ref' : 'first', m.id);
      }
    }
    assert.equal(engine('seedance_2', fixtureFor('seedance_2', 'seedance-2', '4k')).resolution, '4K');
    assert.equal(engine('veo3_1', fixtureFor('veo3_1', 'veo-3-1', '1080p')).ratio, '1920:1080');
    assert.equal(engine('veo3_1', fixtureFor('veo3_1', 'veo-3-1', '720p')).ratio, '1280:720');
  });

  test('no kept preset is one that routing drops, and every dropped one is in DROPPED', () => {
    const ids = [...IMAGE_MODELS.map((m) => m.id), ...VIDEO_MODELS.map((m) => m.id)] as string[];
    for (const d of DROPPED) if (!d.id.includes('_')) assert.ok(!ids.includes(d.id), d.id);
    assert.equal(IMAGE_MODELS.length, 11);
    assert.equal(VIDEO_MODELS.length, 12);
  });

  test('frame limits follow the rows: Gen-4.5 and Gen-4 Turbo take a first frame only', () => {
    assert.equal(videoKeyframeLimit('gen-4-5'), 1);
    assert.equal(videoKeyframeLimit('gen-4-turbo'), 1);
    assert.equal(videoKeyframeLimit('veo-3-1'), 2);
    assert.ok(!videoModelsWith('end').includes('Gen-4.5'));
    assert.ok(videoModelsWith('end').includes('Seedance 2.0'));
  });
});
