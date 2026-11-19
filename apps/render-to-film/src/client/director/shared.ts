import type { Option } from '../parts/OptionSelect.tsx';

/** The planner's pick on top, under "Recommended", then every preset. */
export function withPick<T extends { id: string; name: string; hint: string }>(
  list: readonly T[],
  pick: string,
  why: string,
  all: string
): Option[] {
  const chosen = list.find((x) => x.id === pick);
  return [
    ...(chosen ? [{ id: chosen.id, name: chosen.name, hint: why || chosen.hint, group: 'Recommended for this frame' }] : []),
    ...list.filter((x) => x.id !== pick).map((x) => ({ id: x.id, name: x.name, hint: x.hint, group: all })),
  ];
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame';
}

/** Width over height, or 16:9 when the size is unknown. */
export function ratioOf(width: number | undefined, height: number | undefined): number {
  return width && height && width > 0 && height > 0 ? width / height : 16 / 9;
}
