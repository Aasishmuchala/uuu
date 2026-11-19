/**
 * The names the screens give a still or a clip: in the take strip, the Library, the
 * Favourites board, History and the command palette. Pure (no React), so the tests and
 * the filters use the same words the screens show.
 */
import type { Clip, Still } from '../../api.ts';
import { locationName } from '../../location.ts';
import { litFromReference, lookLabel } from '../../looks.ts';
import {
  imageModelName,
  imageResolutionName,
  motionLabel,
  upscalerName,
  videoModelName,
  videoResolutionName,
} from '../../models.ts';
import { settingName } from '../../surroundings.ts';

/** "Golden hour, people, 2K", "Location: Lisbon, upscaled 2×". */
export function stillTitle(s: Still): string {
  const res = imageResolutionName(s.imageModel, s.resolution);
  const size = s.upscaleOf ? `, upscaled ${s.scale ?? ''}×` : res ? `, ${res}` : '';
  if (s.location) return `Location: ${locationName(s.location)}${size}`;
  if (s.surroundings) return `Surroundings: ${settingName(s.surroundings.setting)}${size}`;
  if (s.storyboard) return `Storyboard ${s.storyboard.order}: ${s.storyboard.title}${size}`;
  const look = lookLabel(s.look, litFromReference(s));
  return `${look}${s.crowd !== 'none' ? ', people' : ''}${size}`;
}

/** The still's title with its model and time, for alternative text. */
export function stillLabel(s: Still): string {
  return `${stillTitle(s)}, made with ${imageModelName(s.imageModel)} on ${new Date(s.createdAt).toLocaleString()}`;
}

/** The still a clip was made from, named the way its card names it. */
export function sourceName(s: Still): string {
  if (s.location) return locationName(s.location);
  if (s.surroundings) return settingName(s.surroundings.setting);
  if (s.storyboard) return s.storyboard.title;
  return lookLabel(s.look, litFromReference(s));
}

/** "Golden hour, slow push in, 1080p": the clip's still and its move. */
export function clipTitle(c: Clip, still: Still | undefined): string {
  const look = still ? sourceName(still) : '';
  const motion = motionLabel(c.motion, c.moveStyle, c.speed);
  const res = videoResolutionName(c.videoModel, c.resolution);
  const base = [look, motion].filter(Boolean).join(', ') || 'Clip';
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}×` : res ? `${base}, ${res}` : base;
}

/** "Seedance 2 1080p, slow push in, 3 frames": how a clip was made. */
export function clipMadeWith(c: Clip): string {
  const motion = motionLabel(c.motion, c.moveStyle, c.speed).toLowerCase();
  const res = videoResolutionName(c.videoModel, c.resolution);
  const extras = [
    c.frameCount && c.frameCount > 1 ? `${c.frameCount} frames` : '',
    c.refCount ? `${c.refCount} extra image${c.refCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const base = `${videoModelName(c.videoModel)}${res ? ` ${res}` : ''}, ${motion}${
    extras.length ? `, ${extras.join(' and ')}` : ''
  }`;
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}× (${upscalerName(c.upscaler)})` : base;
}

/** "14 Nov 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A file name stem from a title: "golden-hour-people-2k". */
export function fileSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'still';
}
