import { Columns2, Download, Image as ImageIcon, Star, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { MAX_TAGS, normalizeTag } from '../tags.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import {
  AlertDialog,
  Button,
  EmptyState,
  Heading,
  Lightbox,
  Popover,
  Text,
  TextInput,
  useToast,
} from './kit.ts';
import { canCompare } from './lib/compare.ts';
import { download } from './lib/download.ts';
import { FAVOURITE_TAG, withFavourite } from './lib/favourites.ts';
import {
  facets,
  filterItems,
  libraryItems,
  NO_FILTER,
  tagCounts,
  type LibraryFilter,
  type LibraryItem,
} from './lib/libraryFilter.ts';
import { clipPreset, savePreset, stillPreset } from './lib/reuse.ts';
import { fileSlug } from './lib/titles.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl } from './lib/urls.ts';
import { CompareBoard } from './parts/CompareBoard.tsx';
import { DetailsPanel } from './parts/DetailsPanel.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { FilterBar } from './parts/FilterBar.tsx';
import { MediaGrid, MediaGridSkeleton, type GridItem } from './parts/MediaGrid.tsx';
import { StarButton, useStar } from './parts/StarButton.tsx';
import { useKeys } from './parts/useKeys.ts';
import { useTagSaver } from './parts/useTags.ts';
import { trpc } from './trpc.ts';
import styles from './LibraryPage.module.css';

const PAGE = 48;

/** The Edit screen reads this once to put a clip on its timeline (left for the Edit redesign). */
export const OPEN_IN_EDIT_KEY = 'render-to-film:open-in-edit';

export type LibraryPageProps = {
  active: boolean;
  /** Open a screen: Stills or Video after "Reuse settings", Edit after "Open in Edit". */
  onGo: (screen: 'stills' | 'video' | 'edit') => void;
  /** A still: open Video with it picked. */
  onAnimate: (stillId: string) => void;
  /** An item to show in the inspector (from the command palette), then cleared. */
  focusId?: string | null | undefined;
  onFocused?: (() => void) | undefined;
};

/**
 * Every still and clip made here, in one grid: filters, a star, tags, several at once, compare
 * and an inspector with how each was made. Reads the `library` query; stars and tags save
 * through `setTags`.
 */
export function LibraryPage({ active, onGo, onAnimate, focusId, onFocused }: LibraryPageProps) {
  const library = trpc.library.useQuery(undefined, {
    // Only while this screen is up; the screen making something polls it itself.
    refetchInterval: (q) =>
      active &&
      (q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 10_000
        : false,
  });
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [density, setDensity] = useState<'large' | 'small'>('large');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);
  const [board, setBoard] = useState(false);

  const items = useMemo(() => libraryItems(library.data), [library.data]);
  const filtered = useMemo(() => filterItems(items, filter), [items, filter]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const tags = useMemo(() => tagCounts(items), [items]);
  const { models, looks } = useMemo(() => facets(items), [items]);
  const current = inspect ? byId.get(inspect) : undefined;
  const picked = [...selected].map((id) => byId.get(id)).filter((i): i is LibraryItem => i !== undefined);
  const compare = canCompare(picked);
  const star = useStar();

  // The command palette asks for one item: show it, whatever the filters were.
  useEffect(() => {
    if (!focusId || !byId.has(focusId)) return;
    setFilter(NO_FILTER);
    setInspect(focusId);
    const at = items.findIndex((i) => i.id === focusId);
    if (at >= shown) setShown(Math.ceil((at + 1) / PAGE) * PAGE);
    onFocused?.();
  }, [focusId, byId]);

  // Ticks and the inspector forget items that are gone.
  useEffect(() => {
    setSelected((cur) => (([...cur].every((id) => byId.has(id))) ? cur : new Set([...cur].filter((id) => byId.has(id)))));
    if (inspect && !byId.has(inspect)) setInspect(null);
  }, [byId]);

  const setFilterAndPage = (f: LibraryFilter) => {
    setFilter(f);
    setShown(PAGE);
  };

  const tick = (id: string, e: MouseEvent) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (e.shiftKey && anchor.current) {
        const ids = filtered.map((i) => i.id);
        const a = ids.indexOf(anchor.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (!byId.get(x)?.pending) next.add(x);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
      return next;
    });
  };

  const openLarge = (id: string) => {
    const at = filtered.findIndex((i) => i.id === id);
    if (at >= 0 && !filtered[at]!.pending) setView(at);
  };

  const reuse = (it: LibraryItem) => {
    if (it.kind === 'still') {
      savePreset('still', stillPreset(it.still));
      onGo('stills');
    } else {
      savePreset('clip', clipPreset(it.clip));
      onGo('video');
    }
  };

  const steps = (by: number) => {
    if (filtered.length === 0) return;
    const at = inspect ? filtered.findIndex((i) => i.id === inspect) : -1;
    const next = filtered[Math.min(filtered.length - 1, Math.max(0, at + by))];
    if (next) setInspect(next.id);
  };

  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => steps(-1) },
      { key: 'ArrowRight', onKey: () => steps(1) },
      { key: 's', onKey: () => current && star.toggle(current.kind, current.id), disabled: !current || current.pending },
      { key: 'c', onKey: () => setBoard(true), disabled: !compare.ok },
      { key: 'f', onKey: () => current && openLarge(current.id), disabled: !current || current.pending },
      { key: 'Escape', onKey: () => setSelected(new Set()), disabled: selected.size === 0 },
    ],
    active
  );

  const gridItems: GridItem[] = filtered.slice(0, shown).map((it) => ({
    id: it.id,
    kind: it.kind,
    thumb: it.kind === 'still' ? stillThumbUrl(it.id) : it.still ? stillThumbUrl(it.still.id) : undefined,
    title: it.title,
    detail: it.detail,
    ratio: it.ratio,
    pending: it.pending,
  }));
  const media = filtered.map((it) =>
    it.kind === 'still'
      ? { type: 'image', src: stillViewUrl(it.id), alt: it.title, caption: it.title }
      : { type: 'video', src: libraryUrl('clip', it.id), alt: it.title, caption: it.title }
  );

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <Heading level={1}>Library</Heading>
          <Text type="supporting">Every image and video you make is kept here. Star the keepers; tag them to find them again.</Text>
        </div>
      </header>

      {library.isPending ? (
        <div className={styles.scroll}>
          <MediaGridSkeleton count={12} density={density} />
        </div>
      ) : library.error && !library.data ? (
        <div className={styles.scroll}>
          <ErrorNote error={library.error} action={<Button label="Try again" size="sm" onClick={() => void library.refetch()} />} />
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="Nothing saved yet"
            description="Make a still on Stills, or animate one on Video. Everything you make lands here."
            actions={<Button label="Make a still" variant="primary" icon={<ImageIcon size={16} />} onClick={() => onGo('stills')} />}
          />
        </div>
      ) : (
        <>
          <div className={styles.bar}>
            <FilterBar
              value={filter}
              onChange={setFilterAndPage}
              models={models}
              looks={looks}
              tags={tags}
              density={density}
              onDensity={setDensity}
              shown={filtered.length}
              total={items.length}
            />
          </div>
          <div className={styles.body}>
            <div className={styles.scroll}>
              {selected.size > 0 && (
                <SelectionBar
                  picked={picked}
                  compareWhy={compare.ok ? null : compare.why}
                  onCompare={() => setBoard(true)}
                  onDelete={() => setBatchDelete(true)}
                  onClear={() => setSelected(new Set())}
                />
              )}
              {filtered.length === 0 ? (
                <div className={styles.empty}>
                  <EmptyState
                    title="Nothing matches"
                    description="Try another word or tag, or clear the filters."
                    actions={<Button label="Clear filters" onClick={() => setFilterAndPage(NO_FILTER)} />}
                  />
                </div>
              ) : (
                <>
                  <MediaGrid
                    label="Your library"
                    items={gridItems}
                    density={density}
                    active={inspect}
                    selected={selected}
                    onTick={tick}
                    onActivate={(id, e) => {
                      if (e.shiftKey || e.metaKey || e.ctrlKey) tick(id, e);
                      else setInspect((cur) => (cur === id ? null : id));
                    }}
                    onOpen={openLarge}
                    corner={(g) => <StarButton kind={g.kind} id={g.id} variant="ghost" />}
                  />
                  {filtered.length > shown && (
                    <div className={styles.more}>
                      <Button
                        label={`Show more (${filtered.length - shown} left)`}
                        variant="secondary"
                        onClick={() => setShown((n) => n + PAGE)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            {current && (
              <aside className={styles.inspector} aria-label="Details">
                <div className={styles.inspectorHead}>
                  <Text type="label">Details</Text>
                  <Button label="Close details" isIconOnly icon={<X size={16} />} size="sm" variant="ghost" onClick={() => setInspect(null)} />
                </div>
                <DetailsPanel
                  key={current.id}
                  item={current}
                  onView={() => openLarge(current.id)}
                  onReuse={() => reuse(current)}
                  onAnimate={current.kind === 'still' ? () => onAnimate(current.id) : undefined}
                  onOpenInEdit={
                    current.kind === 'clip'
                      ? () => {
                          try {
                            sessionStorage.setItem(OPEN_IN_EDIT_KEY, current.id);
                          } catch {
                            // Private mode: Edit opens without it.
                          }
                          onGo('edit');
                        }
                      : undefined
                  }
                  onDelete={() => setDeleting({ kind: current.kind, id: current.id, title: current.title })}
                  onTag={(t) => setFilterAndPage({ ...NO_FILTER, tags: [t] })}
                />
              </aside>
            )}
          </div>
        </>
      )}

      <Lightbox
        isOpen={view !== null && media.length > 0}
        onOpenChange={(open: boolean) => !open && setView(null)}
        media={media}
        index={view ?? 0}
        onIndexChange={(i: number) => {
          setView(i);
          const it = filtered[i];
          if (it) setInspect(it.id);
        }}
        hasZoom
      />
      <CompareBoard
        isOpen={board && compare.ok}
        onClose={() => setBoard(false)}
        items={picked.map((it) => ({
          id: it.id,
          kind: it.kind,
          src: it.kind === 'still' ? stillViewUrl(it.id) : libraryUrl('clip', it.id),
          poster: it.kind === 'clip' && it.still ? stillThumbUrl(it.still.id) : undefined,
          title: it.title,
          detail: it.detail,
          ratio: it.ratio,
        }))}
        pickLabel="Add to favourites"
        onPick={(id) => {
          const it = byId.get(id);
          if (it && !it.tags.includes(FAVOURITE_TAG)) star.toggle(it.kind, it.id);
          setBoard(false);
        }}
      />
      <DeleteItemDialog target={deleting} onClose={() => setDeleting(null)} />
      <BatchDelete
        items={batchDelete ? picked : []}
        onClose={() => setBatchDelete(false)}
        onDone={() => {
          setBatchDelete(false);
          setSelected(new Set());
        }}
      />
    </div>
  );
}

/** What can be done to several items at once: star, tag, compare, download, delete. */
function SelectionBar({
  picked,
  compareWhy,
  onCompare,
  onDelete,
  onClear,
}: {
  picked: readonly LibraryItem[];
  compareWhy: string | null;
  onCompare: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const save = useTagSaver();
  const toast = useToast();
  const [busy, setBusy] = useState<'star' | 'tag' | 'download' | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const ready = picked.filter((p) => !p.pending);

  // One save at a time, in order; the first refusal stops the rest and says which.
  async function eachTags(next: (it: LibraryItem) => string[] | null, what: 'star' | 'tag') {
    setBusy(what);
    let skipped = 0;
    try {
      for (const it of ready) {
        const tags = next(it);
        if (!tags) {
          skipped++;
          continue;
        }
        try {
          await save.mutateAsync({ kind: it.kind, id: it.id, tags });
        } catch (e) {
          toast({ body: `${it.title} could not be saved: ${(e as Error).message}`, type: 'error' });
          return;
        }
      }
      if (skipped > 0) {
        toast({
          body: `${skipped} ${skipped === 1 ? 'item has' : 'items have'} ${MAX_TAGS} tags already. Remove one to add another.`,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function downloadAll() {
    setBusy('download');
    try {
      for (const it of ready) {
        await download(
          libraryUrl(it.kind, it.id),
          it.kind === 'still' ? `film-still-${fileSlug(it.title)}.png` : `film-clip-${fileSlug(it.title)}.mp4`
        );
      }
    } catch (e) {
      toast({ body: (e as Error).message, type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const addTag = () => {
    const tag = normalizeTag(tagDraft);
    setTagDraft('');
    if (!tag || tag === FAVOURITE_TAG) return;
    void eachTags((it) => {
      if (it.tags.includes(tag)) return [...it.tags];
      return it.tags.length >= MAX_TAGS ? null : [...it.tags, tag];
    }, 'tag');
  };

  return (
    <div className={styles.selection} role="toolbar" aria-label="Selected items">
      <Text type="label" hasTabularNumbers>
        {picked.length} selected
      </Text>
      <Button
        label="Favourite"
        size="sm"
        icon={<Star size={14} />}
        isLoading={busy === 'star'}
        isDisabled={busy !== null || ready.length === 0}
        onClick={() =>
          void eachTags((it) => {
            const next = withFavourite(it.tags, true);
            return Array.isArray(next) ? next : null;
          }, 'star')
        }
      />
      <Popover
        label="Tag the selected items"
        content={
          <div className={styles.tagPop}>
            <TextInput
              label={`Add a tag to ${ready.length} ${ready.length === 1 ? 'item' : 'items'}`}
              size="sm"
              placeholder="A tag, then press Enter"
              value={tagDraft}
              onChange={setTagDraft}
              onEnter={addTag}
              hasAutoFocus
            />
          </div>
        }
      >
        <Button label="Tag" size="sm" icon={<Tag size={14} />} isLoading={busy === 'tag'} isDisabled={busy !== null || ready.length === 0} />
      </Popover>
      <Button
        label="Compare"
        size="sm"
        icon={<Columns2 size={14} />}
        isDisabled={compareWhy !== null}
        tooltip={compareWhy ?? 'Side by side (C)'}
        onClick={onCompare}
      />
      <Button
        label="Download"
        size="sm"
        icon={<Download size={14} />}
        isLoading={busy === 'download'}
        isDisabled={busy !== null || ready.length === 0}
        onClick={() => void downloadAll()}
      />
      <Button label="Delete" size="sm" variant="ghost" icon={<Trash2 size={14} />} isDisabled={busy !== null} onClick={onDelete} />
      <span className={styles.push} />
      <Button label="Clear selection" size="sm" variant="ghost" onClick={onClear} />
    </div>
  );
}

/** Deleting several items: one confirm, then one at a time, stopping at the first refusal. */
function BatchDelete({ items, onClose, onDone }: { items: readonly LibraryItem[]; onClose: () => void; onDone: () => void }) {
  const utils = trpc.useUtils();
  const remove = trpc.deleteItem.useMutation();
  const [failed, setFailed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const run = async () => {
    if (working) return;
    setWorking(true);
    setFailed(null);
    try {
      for (const it of items) {
        try {
          await remove.mutateAsync({ kind: it.kind, id: it.id });
        } catch (e) {
          setFailed(`${it.title} could not be deleted: ${(e as Error).message}`);
          return;
        }
      }
      onDone();
    } finally {
      setWorking(false);
      await utils.library.invalidate();
    }
  };
  const n = items.length;
  return (
    <AlertDialog
      isOpen={n > 0}
      onOpenChange={(open: boolean) => {
        if (!open && !working) {
          setFailed(null);
          onClose();
        }
      }}
      title={`Delete ${n} ${n === 1 ? 'item' : 'items'}?`}
      description={[
        `${n === 1 ? 'It' : 'They'} will be removed from your library. This can't be undone. Upscaled copies go with their originals; videos made from a still stay.`,
        failed ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      actionLabel={`Delete ${n}`}
      onAction={() => void run()}
      isActionLoading={working}
    />
  );
}
