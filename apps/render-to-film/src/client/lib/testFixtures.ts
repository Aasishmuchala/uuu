// Shared library fixtures for the pure tests in this folder (not a test file itself).
import type { Clip, Library, Still } from '../../api.ts';

export function still(over: Partial<Still> & { id: string }): Still {
  return {
    createdAt: '2026-11-19T10:00:00.000Z',
    status: 'succeeded',
    imageModel: 'nano-banana-pro',
    look: 'golden-hour',
    angle: 'as-rendered',
    crowd: 'none',
    people: '',
    direction: '',
    width: 2560,
    height: 1440,
    sourceUrl: '/files/uploads/render-a.jpg',
    ...over,
  } as Still;
}

export function clip(over: Partial<Clip> & { id: string; stillId: string }): Clip {
  return {
    createdAt: '2026-11-19T11:00:00.000Z',
    status: 'succeeded',
    videoModel: 'seedance-2',
    motion: 'push-in',
    direction: '',
    ...over,
  } as Clip;
}

export function lib(stills: Still[], clips: Clip[] = []): Library {
  return { stills, clips };
}
