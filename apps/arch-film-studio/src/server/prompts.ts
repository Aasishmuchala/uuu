/**
 * Every prompt the pipeline sends, in one place. The fidelity rules of the
 * brief live here: Strict mode may only improve photographic quality, and
 * Selective mode adds exactly the elements the user picked — nothing more.
 * Image prompts are written as positive prose (what the picture *is*), which
 * the image models follow more reliably than lists of prohibitions.
 */
import {
  ACTIVITY_LABELS,
  ADDITION_LABELS,
  type EnhancementKey,
  ENHANCEMENT_KEYS,
  type FilmFormat,
  FILM_FORMAT_LABELS,
  type ImageAnalysis,
  type ImageSettings,
  LIGHTING_LABELS,
  PEOPLE_LABELS,
  type ProjectImage,
  type Shot,
  SHOT_TYPES,
} from '../shared/project.ts';

const ENHANCEMENT_PHRASES: Record<EnhancementKey, string> = {
  materialRealism:
    'physically accurate material response on every existing surface, so stone, timber, glass, metal, render and fabric read as real',
  texture: 'crisp, true-to-scale surface texture and fine detail',
  reflections:
    'accurate reflections in the existing glass, water and polished surfaces',
  shadows:
    'natural, physically correct shadows and ambient occlusion consistent with the existing light',
  vegetation:
    'lifelike rendering of the existing plants, lawns and trees, with natural leaf detail and colour variation, each the same species in the same place',
  exposure:
    'balanced exposure with a wide dynamic range, holding detail in highlights and shadows',
  colourGrading: 'a refined, natural colour grade with accurate whites',
  finalPhotorealism:
    'a final result indistinguishable from a high-end architectural photograph taken on a full-frame camera',
};

const LIGHTING_PHRASES: Record<string, string> = {
  'natural-daylight': 'clear natural daylight',
  'bright-midday': 'bright midday sun with crisp, short shadows',
  'soft-morning': 'soft, low morning light with gentle warmth',
  'golden-hour': 'warm golden-hour light with long, soft shadows',
  'cinematic-sunset': 'a cinematic sunset with rich warm tones across the sky',
  dusk: 'dusk light with the sky fading and interior lights glowing warmly',
  'blue-hour':
    'blue-hour light with a deep blue sky and warm interior and landscape lighting',
  night:
    'night, lit by the existing architectural, interior and landscape lighting under a dark sky',
};

export function lightingPhrase(s: ImageSettings): string | undefined {
  if (s.lighting === 'preserve') return undefined;
  if (s.lighting === 'custom') return s.lightingCustom.trim() || undefined;
  return LIGHTING_PHRASES[s.lighting];
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What Selective mode will add, in words; empty when nothing is selected. */
export function selectedAdditions(s: ImageSettings): string[] {
  const out: string[] = [];
  const people = s.people
    .filter((p) => p !== 'none')
    .map((p) =>
      p === 'custom' ? s.peopleCustom.trim() : PEOPLE_LABELS[p].toLowerCase()
    )
    .filter(Boolean);
  const activities = s.activities
    .map((a) =>
      a === 'custom'
        ? s.activitiesCustom.trim()
        : ACTIVITY_LABELS[a].toLowerCase()
    )
    .filter(Boolean);
  if (people.length > 0) {
    out.push(
      `people: ${joinList(people)}${activities.length ? `, ${joinList(activities)}` : ''}`
    );
  }
  for (const a of s.additions) {
    if (a === 'other') {
      if (s.additionsOther.trim()) out.push(s.additionsOther.trim());
    } else {
      out.push(ADDITION_LABELS[a].toLowerCase());
    }
  }
  return out;
}

export function buildEnhancePrompt(
  image: ProjectImage,
  s: ImageSettings,
  revisionNote?: string
): string {
  const enabled = ENHANCEMENT_KEYS.filter((k) => s.enhancements[k]);
  const quality =
    enabled.length > 0
      ? joinList(enabled.map((k) => ENHANCEMENT_PHRASES[k]))
      : 'clean, sharp, true-to-life photographic rendering with natural noise-free detail';
  const light = lightingPhrase(s);
  const context = image.analysis?.result
    ? ` The photograph shows ${image.analysis?.result.summary}`
    : '';

  const parts = [
    `A photorealistic architectural photograph that is the reference image "ref1", reproduced exactly.${context}`,
    'It keeps the identical camera position, lens, framing, crop and perspective; the identical architecture, geometry, proportions and layout; every object, plant and surface in its existing position; and the identical materials, colours and finishes.',
    `The only change is photographic quality: ${quality}.`,
    light
      ? `The scene is lit by ${light}, with every surface and object otherwise exactly as in the original.`
      : 'The lighting keeps the original direction, time of day and colour temperature exactly.',
  ];

  const additions = s.mode === 'selective' ? selectedAdditions(s) : [];
  if (additions.length > 0) {
    parts.push(
      `The image also includes exactly these additions and nothing else: ${joinList(additions)}. Each addition is a real, correctly scaled, naturally lit element placed on existing surfaces, with accurate contact shadows and reflections, matching the scene's perspective and light, and positioned so no existing architecture or object is covered or altered.`
    );
  } else {
    parts.push(
      'Every element in the frame is one that already exists in the original photograph.'
    );
  }
  if (revisionNote?.trim()) {
    parts.push(
      `Revision requested by the reviewer, applied within these rules: ${revisionNote.trim()}`
    );
  }
  return parts.join(' ');
}

/** Upscaler prompt: describe the picture so detail is reconstructed faithfully. */
export function buildMasterPrompt(image: ProjectImage): string {
  const a = image.analysis?.result;
  return a
    ? `High-end architectural photograph. ${a.summary} Materials: ${a.materials.join(', ')}.`
    : 'High-end architectural photograph with crisp, true-to-life material detail.';
}

export const ANALYSIS_SYSTEM = `You are an architectural photography analyst. You describe only what is visible in the photograph. You never guess at, invent or embellish anything that is not clearly present.`;

export function buildAnalysisPrompt(): string {
  return `Analyse this architectural image and answer with one JSON object, no prose around it, with exactly these keys:
{
  "subject": "the main architectural subject in a short phrase",
  "spaceType": "e.g. exterior facade, pool terrace, living room, kitchen, bathroom, aerial",
  "composition": "framing, viewpoint, leading lines, symmetry",
  "camera": "approximate height, angle, lens feel (wide / normal / tele)",
  "materials": ["each visible material, e.g. board-formed concrete"],
  "lighting": "time of day, direction, quality and colour temperature as it appears",
  "landscaping": "visible planting, lawns, water, hardscape; 'none' if none",
  "notableElements": ["furniture, fixtures, vehicles, objects that are present"],
  "peoplePresent": false,
  "summary": "one or two plain sentences describing the image"
}
Describe only what is visible.`;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

/** First JSON object in a model's answer (tolerates ```json fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseAnalysis(text: string): ImageAnalysis {
  const raw = extractJson(text) as Record<string, unknown>;
  return {
    subject: str(raw['subject']),
    spaceType: str(raw['spaceType']),
    composition: str(raw['composition']),
    camera: str(raw['camera']),
    materials: strList(raw['materials']),
    lighting: str(raw['lighting']),
    landscaping: str(raw['landscaping']),
    notableElements: strList(raw['notableElements']),
    peoplePresent: raw['peoplePresent'] === true,
    summary: str(raw['summary']),
  };
}

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------

export const STORYBOARD_SYSTEM = `You are an award-winning architectural film director and cinematographer.
Be fearless with cinematography. Be sophisticated with storytelling. Be obsessive about photorealism.
Each shot animates one locked master photograph. The video model starts from that exact frame, so the camera may move through and around what the photograph shows, but the architecture, materials, landscaping and every object stay exactly as photographed: nothing is added, removed or redesigned.
Only master images whose settings list human additions may show people; the others show no people unless people are already in the photograph.`;

export function buildStoryboardPrompt(
  brief: string,
  format: FilmFormat,
  masters: { image: ProjectImage; attached: boolean }[]
): string {
  const lines = masters.map(({ image, attached }, i) => {
    const a = image.analysis?.result;
    const people =
      image.settings.mode === 'selective'
        ? selectedAdditions(image.settings)
        : [];
    return [
      `${image.code}${attached ? ` (attached image ${i + 1})` : ''}: ${a?.summary ?? image.name}`,
      a ? `  space: ${a.spaceType}; camera: ${a.camera}; lighting: ${a.lighting}` : '',
      `  lighting setting: ${LIGHTING_LABELS[image.settings.lighting]}`,
      `  approved additions: ${people.length ? people.join('; ') : 'none'}`,
      `  aspect: ${image.width}x${image.height}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return `Create the storyboard for a premium architectural film.

Creative brief from the user: ${brief.trim() || 'A premium, cinematic property film. Choose the story yourself.'}

Delivery format: ${FILM_FORMAT_LABELS[format]}. Compose every camera move for that frame.

Locked master images (use each one at least once; you may use a strong image twice with a different move):
${lines.join('\n')}

Order the shots as a story: open with an establishing shot, build through the spaces, and land on hero shots. Vary scale and movement boldly: drone-style reveals, slow push-ins, lateral tracking, parallax slides, crane rises, orbit arcs, macro detail glides. Durations are whole seconds from 4 to 10.

Answer with one JSON object, no prose around it:
{
  "title": "film title",
  "narrative": "two or three sentences on the story arc",
  "grade": "the colour grade for the whole film",
  "musicDirection": "one sentence describing the score: genre, tempo, instruments, mood",
  "shots": [
    {
      "imageCode": "IMG-001",
      "shotType": one of ${JSON.stringify(SHOT_TYPES)},
      "creativeDirection": "what this shot is about emotionally",
      "cameraMovement": "the move, e.g. slow dolly-in at eye level easing to a stop",
      "speed": "slow | measured | brisk",
      "lighting": "the light in this shot (the master's light; animate only natural change like moving cloud shadow or flickering water light)",
      "humanActivity": "subtle motion of people already present or approved, or 'none'",
      "purpose": "why this shot sits here in the story",
      "videoPrompt": "the full prompt for the video model, under 900 characters: source frame, what stays fixed, camera start, direction, movement, speed and easing, subject motion, lighting, environment motion (water, foliage, clouds), focus, ending composition, and that architecture, materials and objects stay exactly as in the source frame",
      "durationSeconds": 6,
      "transition": "cut" or "fade" (into the next shot)
    }
  ]
}
Write 6 to 14 shots.`;
}

export interface ParsedStoryboard {
  title: string;
  narrative: string;
  grade: string;
  musicDirection: string;
  shots: (Omit<Shot, 'id' | 'number' | 'imageId' | 'video'> & {
    imageCode: string;
  })[];
}

export function parseStoryboard(text: string): ParsedStoryboard {
  const raw = extractJson(text) as Record<string, unknown>;
  const shots = Array.isArray(raw['shots']) ? raw['shots'] : [];
  return {
    title: str(raw['title'], 'Untitled film'),
    narrative: str(raw['narrative']),
    grade: str(raw['grade']),
    musicDirection: str(raw['musicDirection']),
    shots: shots.map((s: Record<string, unknown>) => {
      const seconds = Math.round(Number(s['durationSeconds']));
      return {
        imageCode: str(s['imageCode']),
        shotType: str(s['shotType'], 'Wide'),
        creativeDirection: str(s['creativeDirection']),
        cameraMovement: str(s['cameraMovement']),
        speed: str(s['speed'], 'measured'),
        lighting: str(s['lighting']),
        humanActivity: str(s['humanActivity'], 'none'),
        purpose: str(s['purpose']),
        videoPrompt: str(s['videoPrompt']),
        durationSeconds: Number.isFinite(seconds)
          ? Math.min(10, Math.max(2, seconds))
          : 6,
        transition: s['transition'] === 'fade' ? 'fade' : 'cut',
      };
    }),
  };
}

/** gen4.5's text prompt — the shot's own prompt plus the preservation rule. */
export function buildShotPrompt(shot: Shot): string {
  const base = shot.videoPrompt.trim() || `${shot.cameraMovement}. ${shot.creativeDirection}`;
  const rule =
    ' Photorealistic architectural cinematography; the architecture, materials, landscaping and objects stay exactly as in the first frame.';
  const max = 1000 - rule.length;
  return (base.length > max ? `${base.slice(0, max - 1)}…` : base) + rule;
}

export function buildMusicPrompt(direction: string): string {
  return (
    direction.trim() ||
    'A refined, cinematic instrumental score for a luxury architectural film: warm piano, soft strings and subtle pulsing synth, slow and elegant, building gently to a hopeful resolution.'
  );
}
