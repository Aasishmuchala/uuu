import { Star } from 'lucide-react';
import { useCallback } from 'react';

import { IconButton, useToast } from '../kit.ts';
import { FAVOURITE_FULL, isFavourite, withFavourite } from '../lib/favourites.ts';
import { trpc } from '../trpc.ts';
import { useTagSaver } from './useTags.ts';

/**
 * Whether a take is starred, and the one action that stars it or takes the star off: the
 * `favourite` tag through `setTags`. An item with 12 tags says so instead of saving.
 */
export function useStar() {
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = useTagSaver();
  const toast = useToast();
  const find = useCallback(
    (kind: 'still' | 'clip', id: string) =>
      kind === 'still' ? library.data?.stills.find((s) => s.id === id) : library.data?.clips.find((c) => c.id === id),
    [library.data]
  );
  const starred = (kind: 'still' | 'clip', id: string) => {
    const item = find(kind, id);
    return item ? isFavourite(item) : false;
  };
  const toggle = (kind: 'still' | 'clip', id: string) => {
    const item = find(kind, id);
    if (!item || save.isPending) return;
    const next = withFavourite(item.tags ?? [], !isFavourite(item));
    if (!Array.isArray(next)) {
      toast({ body: FAVOURITE_FULL, uniqueID: `star-full-${id}` });
      return;
    }
    save.mutate(
      { kind, id, tags: next },
      {
        onError: (e) => toast({ body: `The star could not be saved: ${e.message}`, type: 'error', uniqueID: `star-${id}` }),
      }
    );
  };
  return { known: (kind: 'still' | 'clip', id: string) => find(kind, id) !== undefined, starred, toggle };
}

export type StarButtonProps = {
  kind: 'still' | 'clip';
  id: string;
  size?: 'sm' | 'md' | undefined;
  variant?: 'ghost' | 'secondary' | undefined;
};

/** The star: one click puts a take on the Favourites board, or takes it off. */
export function StarButton({ kind, id, size = 'sm', variant = 'ghost' }: StarButtonProps) {
  const star = useStar();
  const on = star.starred(kind, id);
  const label = on ? 'Remove from favourites' : 'Add to favourites';
  return (
    <IconButton
      label={label}
      tooltip={label}
      size={size}
      variant={variant}
      isDisabled={!star.known(kind, id)}
      icon={<Star size={16} fill={on ? 'currentColor' : 'none'} />}
      onClick={() => star.toggle(kind, id)}
    />
  );
}
