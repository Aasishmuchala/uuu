import {
  Aperture,
  Clapperboard,
  Focus,
  History as HistoryIcon,
  Image,
  Library,
  MapPinned,
  Projector,
  Scissors,
  Search,
  Star,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import styles from './App.module.css';
import { CloseupsPage } from './CloseupsPage.tsx';
import { DirectorPage } from './DirectorPage.tsx';
import { EditPage } from './EditPage.tsx';
import {
  AppShell,
  Button,
  CommandPalette,
  CommandPaletteInput,
  Dialog,
  DialogHeader,
  Kbd,
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  Text,
} from './kit.ts';
import { isFavourite } from './lib/favourites.ts';
import { LibraryPage } from './LibraryPage.tsx';
import { libraryItems } from './lib/libraryFilter.ts';
import { enterTakesFirst } from './lib/paletteEnter.ts';
import { useDocumentTitle } from './lib/useDocumentTitle.ts';
import { LocationPage } from './LocationPage.tsx';
import { useKeys } from './parts/useKeys.ts';
import { FavouritesPage } from './screens/FavouritesPage.tsx';
import { HistoryPage } from './screens/HistoryPage.tsx';
import { StillsPage } from './StillsPage.tsx';
import { trpc } from './trpc.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { SpendingChip } from './ui/SpendingChip.tsx';
import { VideoPage } from './VideoPage.tsx';

type Screen = 'director' | 'stills' | 'video' | 'closeups' | 'location' | 'edit' | 'library' | 'favourites' | 'history';
type Group = 'Make' | 'Finish' | 'Collect';

const SCREENS: ReadonlyArray<{ id: Screen; name: string; group: Group; icon: ReactNode; hint: string }> = [
  { id: 'director', name: 'Director', group: 'Make', icon: <Projector size={16} />, hint: 'A storyboard and a film from one render' },
  { id: 'stills', name: 'Stills', group: 'Make', icon: <Image size={16} />, hint: 'Turn a render into a film still' },
  { id: 'video', name: 'Video', group: 'Make', icon: <Clapperboard size={16} />, hint: 'Bring a still to life' },
  { id: 'closeups', name: 'Close-ups', group: 'Make', icon: <Focus size={16} />, hint: 'Details found in a still' },
  { id: 'location', name: 'Location', group: 'Make', icon: <MapPinned size={16} />, hint: 'The building in its real place' },
  { id: 'edit', name: 'Edit', group: 'Finish', icon: <Scissors size={16} />, hint: 'Cut, grade and export' },
  { id: 'library', name: 'Library', group: 'Collect', icon: <Library size={16} />, hint: 'Everything you have made' },
  { id: 'favourites', name: 'Favourites', group: 'Collect', icon: <Star size={16} />, hint: 'The keepers' },
  { id: 'history', name: 'History', group: 'Collect', icon: <HistoryIcon size={16} />, hint: 'Every direction you have written' },
];
const GROUPS: readonly Group[] = ['Make', 'Finish', 'Collect'];
const IDS = SCREENS.map((s) => s.id) as readonly string[];
/** Stills and Video stay mounted once opened, so a take being made keeps its place on the stage. */
const KEEP: readonly Screen[] = ['stills', 'video'];
const PICKED_KEY = 'render-to-film:picked-still';

/** The screen named in the address (`#video`), so a reload stays on it; `#surroundings` is Location. */
function tabFromHash(): Screen {
  const raw = window.location.hash.slice(1);
  const id = raw === 'surroundings' ? 'location' : raw;
  return IDS.includes(id) ? (id as Screen) : 'director';
}

function readPicked(): string | null {
  try {
    return sessionStorage.getItem(PICKED_KEY);
  } catch {
    return null;
  }
}

type PaletteItem = { id: string; label: string; auxiliaryData: { group: string; hint?: string } };

/** The palette's list: screens, then pictures by name, then the shortcuts sheet. */
function staticSource(items: readonly PaletteItem[]) {
  return {
    search(query: string) {
      const q = query.toLowerCase().trim();
      if (!q) return items.filter((i) => i.auxiliaryData.group !== 'Pictures').concat(items.filter((i) => i.auxiliaryData.group === 'Pictures').slice(0, 8));
      return items.filter((i) => i.label.toLowerCase().includes(q) || (i.auxiliaryData.hint ?? '').toLowerCase().includes(q)).slice(0, 60);
    },
    bootstrap() {
      return this.search('');
    },
  };
}

export function App() {
  const [tab, setTab] = useState<Screen>(tabFromHash);
  const [visited, setVisited] = useState<ReadonlySet<Screen>>(() => new Set([tabFromHash()]));
  const [pickedStillId, setPickedStillId] = useState<string | null>(readPicked);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [libraryFocus, setLibraryFocus] = useState<string | null>(null);
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const current = SCREENS.find((s) => s.id === tab)!;
  // Enter on typed words takes the palette's first result (the kit highlights none by itself).
  useEffect(() => {
    if (!palette) return;
    window.addEventListener('keydown', enterTakesFirst, true);
    return () => window.removeEventListener('keydown', enterTakesFirst, true);
  }, [palette]);
  useDocumentTitle(current.name, 'Render to Film');

  useEffect(() => {
    if (window.location.hash.slice(1) !== tab) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${tab}`);
    }
    setVisited((v) => (v.has(tab) ? v : new Set([...v, tab])));
  }, [tab]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try {
      if (pickedStillId) sessionStorage.setItem(PICKED_KEY, pickedStillId);
      else sessionStorage.removeItem(PICKED_KEY);
    } catch {
      // Private mode: the pick just won't survive a reload.
    }
  }, [pickedStillId]);

  /** A new place in the address, so Back returns to the screen before. */
  const go = (id: Screen) => {
    if (id === tab) return;
    window.location.hash = id;
  };
  const animate = (id: string) => {
    setPickedStillId(id);
    go('video');
  };

  useKeys([
    { key: 'k', mod: true, onKey: () => setPalette((open) => !open) },
    { key: '?', onKey: () => setShortcuts(true) },
  ]);

  const items = useMemo(() => libraryItems(library.data), [library.data]);
  const favourites = items.filter((i) => !i.pending && isFavourite(i)).length;
  const source = useMemo(
    () =>
      staticSource([
        ...SCREENS.map((s) => ({ id: `screen:${s.id}`, label: s.name, auxiliaryData: { group: 'Screens', hint: s.hint } })),
        ...items
          .filter((i) => !i.pending)
          .map((i) => ({ id: `item:${i.id}`, label: i.title, auxiliaryData: { group: 'Pictures', hint: i.detail } })),
        { id: 'shortcuts', label: 'Show the shortcuts', auxiliaryData: { group: 'Help', hint: 'Every key in one place' } },
      ]),
    [items]
  );

  const count = (id: Screen) =>
    id === 'library' && items.length > 0 ? items.length : id === 'favourites' && favourites > 0 ? favourites : null;

  const sideNav = (
    <SideNav
      aria-label="Screens"
      collapsible
      header={<SideNavHeading heading="Render to Film" icon={<Aperture size={18} />} />}
    >
      {GROUPS.map((g) => (
        <SideNavSection key={g} title={g}>
          {SCREENS.filter((s) => s.group === g).map((s) => {
            const n = count(s.id);
            return (
              <SideNavItem
                key={s.id}
                label={s.name}
                icon={s.icon}
                isSelected={tab === s.id}
                href={`#${s.id}`}
                endContent={
                  n !== null ? (
                    <Text type="supporting" hasTabularNumbers>
                      {n}
                    </Text>
                  ) : undefined
                }
              />
            );
          })}
        </SideNavSection>
      ))}
    </SideNav>
  );

  const topBar = (
    <div className={styles.top}>
      <nav className={styles.crumbs} aria-label="Where you are">
        <span className={styles.group}>
          <Text type="supporting">{current.group}</Text>
          <span className={styles.slash} aria-hidden>
            /
          </span>
        </span>
        <Text type="label" maxLines={1}>
          {current.name}
        </Text>
      </nav>
      <div className={styles.topEnd}>
        <button type="button" className={styles.jump} onClick={() => setPalette(true)} aria-keyshortcuts="Meta+K" aria-label="Jump to">
          <Search size={14} aria-hidden />
          <span className={styles.jumpWords} aria-hidden>
            Jump to
          </span>
          <span className={styles.jumpKeys} aria-hidden>
            <Kbd keys="mod+k" />
          </span>
        </button>
        <span className={styles.shortcuts}>
          <Button label="Shortcuts" variant="ghost" size="sm" onClick={() => setShortcuts(true)} tooltip="Every key in one place (?)" />
        </span>
        <SpendingChip />
      </div>
    </div>
  );

  const screen = (id: Screen): ReactNode => {
    const active = tab === id;
    switch (id) {
      case 'director':
        return <DirectorPage active={active} onAnimate={animate} onGoToEdit={() => go('edit')} />;
      case 'stills':
        return <StillsPage active={active} onAnimate={animate} />;
      case 'video':
        return (
          <VideoPage
            active={active}
            pickedStillId={pickedStillId}
            onPick={setPickedStillId}
            onGoToStills={() => go('stills')}
            onGoToLibrary={() => go('library')}
          />
        );
      case 'closeups':
        return <CloseupsPage active={active} onGoToStills={() => go('stills')} onAnimate={animate} />;
      case 'location':
        return <LocationPage active={active} onAnimate={animate} />;
      case 'edit':
        return <EditPage active={active} onGoToVideo={() => go('video')} />;
      case 'library':
        return (
          <LibraryPage
            active={active}
            onGo={go}
            onAnimate={animate}
            focusId={libraryFocus}
            onFocused={() => setLibraryFocus(null)}
          />
        );
      case 'favourites':
        return <FavouritesPage onGoToLibrary={() => go('library')} />;
      case 'history':
        return <HistoryPage onGo={go} />;
    }
  };

  return (
    <>
      <AppShell sideNav={sideNav} topNav={topBar} height="fill" variant="section">
        {SCREENS.map((s) => {
          const kept = KEEP.includes(s.id) && visited.has(s.id);
          if (s.id !== tab && !kept) return null;
          return (
            <div key={s.id} className={styles.fill} hidden={s.id !== tab}>
              <ErrorBoundary label={`${s.name} screen`}>{screen(s.id)}</ErrorBoundary>
            </div>
          );
        })}
      </AppShell>

      <CommandPalette
        isOpen={palette}
        onOpenChange={setPalette}
        label="Jump to"
        searchSource={source}
        input={<CommandPaletteInput label="Jump to a screen or a picture" placeholder="Jump to a screen or a picture" />}
        emptySearchText="Nothing by that name."
        renderItem={(item: PaletteItem) => (
          <span className={styles.paletteRow}>
            <Text maxLines={1}>{item.label}</Text>
            {item.auxiliaryData.hint && (
              <Text type="supporting" maxLines={1}>
                {item.auxiliaryData.hint}
              </Text>
            )}
          </span>
        )}
        onValueChange={(value: string) => {
          setPalette(false);
          if (value === 'shortcuts') setShortcuts(true);
          else if (value.startsWith('screen:')) go(value.slice('screen:'.length) as Screen);
          else if (value.startsWith('item:')) {
            setLibraryFocus(value.slice('item:'.length));
            go('library');
          }
        }}
      />

      <Dialog isOpen={shortcuts} onOpenChange={setShortcuts} width={520}>
        <DialogHeader title="Shortcuts" onOpenChange={setShortcuts} />
        <div className={styles.keys}>
          <KeyGroup
            title="Anywhere"
            rows={[
              ['mod+k', 'Jump to a screen or a picture by its name'],
              ['?', 'Show these shortcuts'],
              ['esc', 'Close a dialog or the full size view'],
            ]}
          />
          <KeyGroup
            title="The Make screens and the Library"
            rows={[
              ['left', 'The take before, or the frame before on Director'],
              ['right', 'The take after, or the frame after on Director'],
              ['s', 'Star the take on the stage, or the one in the details'],
              ['c', 'Compare the ticked takes, or a still with its render'],
              ['f', 'Full size'],
              ['esc', 'Back to the board on Director, or clear the selection in the Library'],
            ]}
          />
          <KeyGroup
            title="Edit, with the timeline focused"
            rows={[
              ['delete', 'Remove the picked cut'],
              ['alt+left', 'Move the picked cut earlier'],
              ['alt+right', 'Move the picked cut later'],
              ['mod+z', 'Undo'],
              ['mod+shift+z', 'Redo'],
            ]}
          />
          <Text type="supporting" as="p">
            Shortcuts never work while you type in a field. None of them makes anything or spends money: that always
            takes a click on a button with its price.
          </Text>
        </div>
      </Dialog>
    </>
  );
}

function KeyGroup({ title, rows }: { title: string; rows: ReadonlyArray<[string, string]> }) {
  return (
    <section className={styles.keyGroup}>
      <Text type="label">{title}</Text>
      <dl className={styles.keyList}>
        {rows.map(([keys, what]) => (
          <div key={`${keys}-${what}`} className={styles.keyRow}>
            <dt>
              <Kbd keys={keys} />
            </dt>
            <dd>
              <Text>{what}</Text>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
