import { Play } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';

import { Button, EmptyState, Heading, Lightbox, Skeleton, Text } from '../kit.ts';
import { isFavourite } from '../lib/favourites.ts';
import { libraryItems, type LibraryItem } from '../lib/libraryFilter.ts';
import { formatDate } from '../lib/titles.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl } from '../lib/urls.ts';
import { ErrorNote } from '../parts/ErrorNote.tsx';
import { LightboxSound } from '../ui/LightboxSound.tsx';
import { StarButton } from '../parts/StarButton.tsx';
import { trpc } from '../trpc.ts';
import styles from './FavouritesPage.module.css';

type Group = { key: string; render: string | undefined; first: string; items: LibraryItem[] };

/** The render a take came from (a clip: its still's), so the board groups by building and view. */
function renderOf(it: LibraryItem): string | undefined {
  return it.kind === 'still' ? it.still.sourceUrl : it.still?.sourceUrl;
}

/**
 * The shortlist: every starred still and clip, large and whole, grouped by the render they came
 * from. This is what the owner shows a client. The star takes one off the board.
 */
export function FavouritesPage({ onGoToLibrary }: { onGoToLibrary: () => void }) {
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const [view, setView] = useState<number | null>(null);
  const favourites = useMemo(
    () => libraryItems(library.data).filter((it) => !it.pending && isFavourite(it)),
    [library.data]
  );
  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const it of favourites) {
      const render = renderOf(it);
      const key = render ?? 'other';
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, render, first: it.createdAt, items: [] }));
      g.items.push(it);
      if (it.createdAt < g.first) g.first = it.createdAt;
    }
    return out;
  }, [favourites]);
  const ordered = groups.flatMap((g) => g.items);
  const media = ordered.map((it) =>
    it.kind === 'still'
      ? { type: 'image', src: stillViewUrl(it.id), alt: it.title, caption: it.title }
      : { type: 'video', src: libraryUrl('clip', it.id), alt: it.title, caption: it.title }
  );

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <Heading level={1}>Favourites</Heading>
        <Text type="supporting">
          {favourites.length > 0
            ? `${favourites.length} ${favourites.length === 1 ? 'keeper' : 'keepers'} from ${groups.length} ${groups.length === 1 ? 'render' : 'renders'}. Star a take anywhere to add it here.`
            : 'Star a take anywhere you see it, and it lands here.'}
        </Text>
      </header>
      {library.isPending ? (
        <div className={styles.board}>
          {[16 / 9, 4 / 3, 16 / 9, 3 / 2, 16 / 9, 1].map((r, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.frame} style={{ aspectRatio: String(r) }}>
                <Skeleton index={i} radius={1} />
              </div>
            </div>
          ))}
        </div>
      ) : library.error && !library.data ? (
        <div className={styles.pad}>
          <ErrorNote error={library.error} action={<Button label="Try again" size="sm" onClick={() => void library.refetch()} />} />
        </div>
      ) : favourites.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="No favourites yet"
            description="Star the stills and clips you would show a client. They gather here, grouped by the render they came from."
            actions={<Button label="Open the Library" variant="primary" onClick={onGoToLibrary} />}
          />
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map((g, gi) => (
            <section key={g.key} className={styles.group} aria-labelledby={`fav-${gi}`}>
              <div className={styles.groupHead}>
                {g.render && <img className={styles.render} src={g.render} alt="" />}
                <div>
                  <Heading level={3} id={`fav-${gi}`}>
                    {g.render ? `From the render of ${formatDate(g.first)}` : 'Other keepers'}
                  </Heading>
                  <Text type="supporting" hasTabularNumbers>
                    {g.items.length} {g.items.length === 1 ? 'keeper' : 'keepers'}
                  </Text>
                </div>
              </div>
              <div className={styles.board}>
                {g.items.map((it) => (
                  <figure key={it.id} className={styles.card}>
                    <button
                      type="button"
                      className={styles.frame}
                      style={{ aspectRatio: String(it.ratio) } as CSSProperties}
                      onClick={() => setView(ordered.indexOf(it))}
                      aria-label={`View ${it.title} large`}
                    >
                      <img
                        src={it.kind === 'still' ? stillViewUrl(it.id) : it.still ? stillThumbUrl(it.still.id) : undefined}
                        alt={it.title}
                        loading="lazy"
                        decoding="async"
                      />
                      {it.kind === 'clip' && (
                        <span className={styles.play} aria-hidden>
                          <Play size={14} />
                        </span>
                      )}
                    </button>
                    <figcaption className={styles.caption}>
                      <span className={styles.captionText}>
                        <Text type="label" maxLines={1}>
                          {it.title}
                        </Text>
                        <Text type="supporting" maxLines={1}>
                          {it.detail}
                        </Text>
                      </span>
                      <StarButton kind={it.kind} id={it.id} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Lightbox
        isOpen={view !== null && media.length > 0}
        onOpenChange={(open: boolean) => !open && setView(null)}
        media={media}
        index={view ?? 0}
        onIndexChange={(i: number) => setView(i)}
        hasZoom
      />
      <LightboxSound isOpen={view !== null && media.length > 0} />
    </div>
  );
}
