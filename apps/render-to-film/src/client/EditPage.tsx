import type { inferRouterOutputs } from '@trpc/server';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Copy,
  Download,
  Film,
  Palette,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Send,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  cloneElement,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { AppRouterType } from '../api.ts';
import { type CutColour, colourCss, colourSteps, cutEnds, isNeutral, NEUTRAL_COLOUR } from '../colour.ts';
import { GRADES } from '../grades.ts';
import { derivedLabel, rootClipId, type TimelineItem } from '../timeline.ts';
import {
  AlertDialog,
  Banner,
  Button,
  Dialog,
  DialogHeader,
  EmptyState,
  Heading,
  IconButton,
  NumberInput,
  ProgressBar,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Slider,
  StatusDot,
  Tab,
  TabList,
  Text,
  TextArea,
  TextInput,
} from './kit.ts';
import { OPEN_IN_EDIT_KEY } from './LibraryPage.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { useGradedDownload } from './lib/gradedFilm.ts';
import { Elapsed } from './parts/Elapsed.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { MediaGrid } from './parts/MediaGrid.tsx';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { StageEmpty, StageFrame } from './parts/Stage.tsx';
import { trpc } from './trpc.ts';
import styles from './EditPage.module.css';

type Project = inferRouterOutputs<AppRouterType>['edit']['project'];
type Cut = Pick<TimelineItem, 'key' | 'clipId' | 'versionId' | 'sourceStart' | 'duration' | 'colour'>;
type Draft = { items: Cut[]; transition: 'hard' | 'fade'; fadeSeconds: number };

const SUGGESTIONS = [
  'Cut a 20 second film: widest view first, details in the middle, end on the hero shot',
  'Grade every cut warm luxury',
  'Use slow 1 second fades between cuts',
  'Remember: keep every cut between 3 and 5 seconds',
];

const ADJUSTMENTS = [
  { id: 'exposure', label: 'Exposure' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'warmth', label: 'Warmth' },
] as const;
const NO_NOTES: string[] = [];
const signed = (v: number) => (Math.round(v * 100) === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);
/** The longest a timeline may grow; the server takes no more. */
const MAX_CUTS = 24;

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** "4.5 s", with figures of one width. */
function secs(n: number) {
  return `${round(n)} s`;
}

function fromServer(p: Project): Draft {
  return {
    items: p.timeline.map(({ key, clipId, versionId, sourceStart, duration, colour }) => ({
      key,
      clipId,
      versionId,
      sourceStart,
      duration,
      colour,
    })),
    transition: p.transition,
    fadeSeconds: p.fadeSeconds,
  };
}

/** The clip id the Library's "Open in Edit" asked for, read once and removed. */
function takeOpenInEdit(): string | null {
  try {
    const id = sessionStorage.getItem(OPEN_IN_EDIT_KEY);
    sessionStorage.removeItem(OPEN_IN_EDIT_KEY);
    return id && /^[A-Za-z0-9_.:-]{1,128}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type EditPageProps = {
  /** Go to the Video screen, when there are no clips yet. */
  onGoToVideo: () => void;
  /** Whether Edit is the screen on show; a hidden one loads no video and polls slowly. */
  active: boolean;
};

const HISTORY_MAX = 20;
const CLIP_PAGE = 24;
const NO_DERIVED: Project['derived'] = [];
const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="spinbutton"], [role="slider"], [role="listbox"], [role="combobox"], [aria-haspopup]';

export function EditPage({ onGoToVideo, active }: EditPageProps) {
  const utils = trpc.useUtils();
  const project = trpc.edit.project.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy =
        d.agent !== null ||
        d.derived.some((x) => x.status === 'pending') ||
        d.exports.some((x) => x.status === 'pending');
      // A hidden screen only checks now and then.
      return busy ? (active ? 4000 : 15000) : false;
    },
  });
  const data = project.data;
  // While the AI editor is changing the timeline, hand edits would be overwritten.
  const locked = !!data?.agent;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // The timeline is edited locally and autosaved. `rev` counts local edits
  // that the server has not confirmed; at 0 the server copy wins, otherwise
  // only the fields the server owns (a cut's version) are taken from it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const rev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const save = trpc.edit.saveTimeline.useMutation();
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;

  // Undo and redo: up to 20 timeline states each.
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const lastTag = useRef<{ tag: string; at: number } | null>(null);
  // Counts undo-history changes, so the undo and redo buttons know when they can act.
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((n) => n + 1);

  const adoptServer = useCallback((p: Project) => {
    const server = fromServer(p);
    const cur = draftRef.current;
    if (rev.current === 0 || !cur) {
      // An unchanged poll keeps the draft as it is, so nothing re-renders.
      if (cur && JSON.stringify(cur) === JSON.stringify(server)) return;
      draftRef.current = server;
      setDraft(server);
      return;
    }
    const owned = new Map(p.timeline.map((t) => [t.key, t.versionId]));
    let changed = false;
    const items = cur.items.map((c) => {
      if (!owned.has(c.key) || owned.get(c.key) === c.versionId) return c;
      changed = true;
      return { ...c, versionId: owned.get(c.key) };
    });
    if (changed) {
      const next = { ...cur, items };
      draftRef.current = next;
      setDraft(next);
    }
  }, []);

  const prevAgent = useRef(false);
  useEffect(() => {
    if (!data) return;
    const working = !!data.agent;
    const ended = prevAgent.current && !working;
    prevAgent.current = working;
    if (ended && !timer.current && pendingSaves.current === 0) {
      // The editor changed the timeline: take it, even over an earlier failed save.
      rev.current = 0;
      past.current = [];
      future.current = [];
      bumpHistory();
      setSaveError(null);
      setSaveState((st) => (st === 'error' ? 'idle' : st));
    }
    adoptServer(data);
  }, [data, adoptServer]);

  // Coming back to the screen brings in whatever finished while it was hidden.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void utils.edit.project.invalidate();
    wasActive.current = active;
  }, [active, utils]);

  const doSave = useCallback(
    (d: Draft) => {
      const at = rev.current;
      const run = async () => {
        pendingSaves.current += 1;
        setSaveState('saving');
        setSaveError(null);
        try {
          await saveRef.current({
            items: d.items.map((c) => ({ ...c, versionId: c.versionId ?? undefined, colour: c.colour ?? undefined })),
            transition: d.transition,
            fadeSeconds: d.fadeSeconds,
          });
          if (rev.current === at) {
            rev.current = 0;
            setSaveState('saved');
            // Nothing newer is waiting: take the server's timeline, with whatever finished meanwhile.
            await utils.edit.project.invalidate();
            const fresh = utils.edit.project.getData();
            if (fresh && rev.current === 0) adoptServer(fresh);
          } else {
            setSaveState(timer.current ? 'unsaved' : 'saving');
          }
        } catch (err) {
          setSaveError(err instanceof Error && err.message ? err.message : 'The server did not answer.');
          setSaveState('error');
        } finally {
          pendingSaves.current -= 1;
        }
      };
      const next = inflight.current.then(run, run);
      inflight.current = next;
      return next;
    },
    [utils, adoptServer]
  );

  /** Save whatever is waiting now; true when the server has the timeline as shown. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await inflight.current;
    if (rev.current !== 0 && draftRef.current) await doSave(draftRef.current);
    return rev.current === 0;
  }, [doSave]);

  const retrySave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (draftRef.current) void doSave(draftRef.current);
  }, [doSave]);

  const commit = useCallback(
    (next: Draft, delay: number) => {
      draftRef.current = next;
      setDraft(next);
      rev.current += 1;
      setSaveState('unsaved');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void doSave(next);
      }, delay);
    },
    [doSave]
  );

  /** A local edit. Edits with the same `tag` in quick succession (a drag, typing) are one undo step. */
  const change = useCallback(
    (next: Draft, delay = 600, tag?: string) => {
      if (lockedRef.current) return;
      const prev = draftRef.current;
      if (prev) {
        const at = Date.now();
        const last = lastTag.current;
        if (!(tag && last && last.tag === tag && at - last.at < 1200)) {
          past.current = [...past.current.slice(-(HISTORY_MAX - 1)), prev];
        }
        lastTag.current = tag ? { tag, at } : null;
        future.current = [];
        bumpHistory();
      }
      commit(next, delay);
    },
    [commit]
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current || ['unsaved', 'saving', 'error'].includes(saveStateRef.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ cut: Cut; index: number } | null>(null);
  const [panel, setPanel] = useState<'look' | 'editor'>('look');
  const [bin, setBin] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  const clips = useMemo(() => data?.clips ?? [], [data?.clips]);
  const items = draft?.items ?? [];
  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const serverByKey = useMemo(() => new Map((data?.timeline ?? []).map((t) => [t.key, t])), [data?.timeline]);
  const serverRef = useRef(serverByKey);
  serverRef.current = serverByKey;
  const secondsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clips) m.set(c.id, c.seconds);
    for (const d of data?.derived ?? []) if (d.seconds) m.set(d.id, d.seconds);
    return m;
  }, [clips, data?.derived]);
  // Rows and lists show a small copy of the still; only the video poster is the full one.
  const thumbOf = useCallback(
    (clipId: string) => {
      const c = clipById.get(clipId);
      return c ? stillThumbUrl(c.stillId) : undefined;
    },
    [clipById]
  );
  const posterOf = useCallback(
    (clipId: string) => {
      const c = clipById.get(clipId);
      return c ? stillViewUrl(c.stillId) : undefined;
    },
    [clipById]
  );
  const mediaOf = useCallback(
    (c: Cut) => (c.versionId ? libraryUrl('edit', c.versionId) : libraryUrl('clip', c.clipId)),
    []
  );
  const total = round(items.reduce((s, c) => s + c.duration, 0));

  // Stable for the life of the page (they read the draft from its ref), so a
  // change to one cut re-renders that cut and nothing else.
  const update = useCallback(
    (key: string, patch: Partial<Cut>, delay?: number) => {
      const d = draftRef.current;
      if (!d) return;
      change(
        { ...d, items: d.items.map((c) => (c.key === key ? { ...c, ...patch } : c)) },
        delay,
        `${key}:${Object.keys(patch).join(',')}`
      );
    },
    [change]
  );
  const colourAll = useCallback(
    (colour: CutColour | undefined) => {
      const d = draftRef.current;
      if (!d) return;
      change({ ...d, items: d.items.map((c) => ({ ...c, colour })) }, 400);
    },
    [change]
  );
  const move = useCallback(
    (key: string, by: -1 | 1) => {
      const d = draftRef.current;
      if (!d) return;
      const index = d.items.findIndex((c) => c.key === key);
      const to = index + by;
      if (index < 0 || to < 0 || to >= d.items.length) return;
      const next = [...d.items];
      const [cut] = next.splice(index, 1);
      next.splice(to, 0, cut!);
      change({ ...d, items: next }, 300);
    },
    [change]
  );
  const remove = useCallback(
    (key: string) => {
      const d = draftRef.current;
      if (!d) return;
      const index = d.items.findIndex((c) => c.key === key);
      if (index < 0) return;
      setRemoved({ cut: d.items[index]!, index });
      setSelected((s) => (s === key ? null : s));
      change({ ...d, items: d.items.filter((c) => c.key !== key) }, 300);
    },
    [change]
  );
  const toggle = useCallback((key: string) => setSelected((s) => (s === key ? null : key)), []);
  const undoRemove = () => {
    const d = draftRef.current;
    if (!d || !removed) return;
    const next = [...d.items];
    next.splice(Math.min(removed.index, next.length), 0, removed.cut);
    setRemoved(null);
    change({ ...d, items: next }, 300);
  };
  const add = useCallback(
    (clipId: string, seconds: number) => {
      const d = draftRef.current;
      if (!d) return;
      const cut: Cut = { key: crypto.randomUUID(), clipId, sourceStart: 0, duration: seconds };
      setSelected(cut.key);
      setPanel('look');
      change({ ...d, items: [...d.items, cut] }, 300);
    },
    [change]
  );

  // The first cut is picked when the screen opens, so the Look tab has something to show.
  const pickedFirst = useRef(false);
  useEffect(() => {
    if (pickedFirst.current || !draft) return;
    pickedFirst.current = true;
    setSelected((s) => s ?? draft.items[0]?.key ?? null);
  }, [draft]);

  // The Library's "Open in Edit": the clip goes on the end of the timeline once the project is
  // in, or, when it is there already, its cut is picked. Nothing is sent but the timeline's save.
  const opened = useRef(false);
  useEffect(() => {
    if (!active) {
      opened.current = false;
      return;
    }
    if (opened.current || !draft || !data) return;
    opened.current = true;
    const id = takeOpenInEdit();
    if (!id) return;
    const clip = clipById.get(id);
    if (!clip) return;
    const there = draft.items.find((c) => c.clipId === id);
    if (there) {
      setSelected(there.key);
      setPanel('look');
    } else if (draft.items.length < MAX_CUTS && !locked) {
      add(clip.id, clip.seconds);
    }
  }, [active, draft, data, clipById, locked, add]);

  // Going back to an earlier state keeps each cut's version as the server has it now.
  const restore = useCallback(
    (target: Draft) => {
      const merged: Draft = {
        ...target,
        items: target.items.map((c) => {
          const sv = serverRef.current.get(c.key);
          return sv ? { ...c, versionId: sv.versionId } : c;
        }),
      };
      setRemoved(null);
      setSelected((sel) => (sel && merged.items.some((c) => c.key === sel) ? sel : null));
      lastTag.current = null;
      commit(merged, 300);
    },
    [commit]
  );
  const undo = useCallback(() => {
    const cur = draftRef.current;
    const prev = past.current.pop();
    if (!cur || !prev || lockedRef.current) {
      if (prev) past.current.push(prev);
      return;
    }
    future.current = [...future.current.slice(-(HISTORY_MAX - 1)), cur];
    bumpHistory();
    restore(prev);
  }, [restore]);
  const redo = useCallback(() => {
    const cur = draftRef.current;
    const next = future.current.pop();
    if (!cur || !next || lockedRef.current) {
      if (next) future.current.push(next);
      return;
    }
    past.current = [...past.current.slice(-(HISTORY_MAX - 1)), cur];
    bumpHistory();
    restore(next);
  }, [restore]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const onTimelineKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    // Keys from a dialog bubble through its portal; they are not timeline keys.
    if (!e.currentTarget.contains(el) || el.closest(FIELD_SELECTOR)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    // The cut the focus is in, else the selected one.
    const target = el.closest<HTMLElement>('[data-cutkey]')?.dataset.cutkey ?? selected;
    if (!target || mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!lockedRef.current) remove(target);
      timelineRef.current?.focus();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
      e.preventDefault();
      move(target, e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  const [exporting, setExporting] = useState(false);
  const exportFilm = trpc.edit.exportFilm.useMutation({
    // Stays "pending" until the refetch shows the running export, so a second click can't slip in.
    onSuccess: () => utils.edit.project.invalidate(),
    onError: () => void utils.edit.project.invalidate(),
  });
  const runExport = async () => {
    if (exporting || exportFilm.isPending) return;
    setExporting(true);
    try {
      if (!(await flush())) return;
      await exportFilm.mutateAsync();
    } catch {
      // The notice under the top bar shows the error.
    } finally {
      setExporting(false);
    }
  };
  const anyPending = data?.timeline.some((t) => t.pendingId) ?? false;
  const latestExport = data?.exports[0];
  const selectedIndex = items.findIndex((c) => c.key === selected);
  const selectedCut = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  // ---- The top bar: where the cut stands, undo and redo, and Export with its words.
  const topBar = (
    <header className={styles.top}>
      <div className={styles.topStart}>
        <Heading level={2}>The cut</Heading>
        <Text type="supporting" hasTabularNumbers>
          {items.length
            ? `${items.length} ${items.length === 1 ? 'cut' : 'cuts'}, ${secs(total)}, ${draft?.transition === 'fade' ? `${draft.fadeSeconds} s fades` : 'hard cuts'}`
            : 'Nothing on the timeline yet'}
        </Text>
        <span className={styles.saveNote} role="status">
          <SaveNote state={saveState} error={saveError} onRetry={retrySave} />
        </span>
      </div>
      <div className={styles.topEnd}>
        <IconButton
          label="Undo"
          tooltip="Undo (Cmd+Z, with the timeline focused)"
          size="sm"
          variant="ghost"
          icon={<Undo2 size={16} />}
          isDisabled={past.current.length === 0 || locked}
          onClick={undo}
        />
        <IconButton
          label="Redo"
          tooltip="Redo (Cmd+Shift+Z, with the timeline focused)"
          size="sm"
          variant="ghost"
          icon={<Redo2 size={16} />}
          isDisabled={future.current.length === 0 || locked}
          onClick={redo}
        />
        <span className={styles.divider} aria-hidden />
        <Text type="supporting">
          {anyPending ? 'A cut is still re-rendering; export once it is done.' : 'Exporting runs on this Mac.'}
        </Text>
        <Button
          label={latestExport?.status === 'pending' ? 'Exporting…' : 'Export film'}
          variant="primary"
          size="sm"
          icon={<Film size={16} />}
          isLoading={exporting || exportFilm.isPending}
          isDisabled={!items.length || anyPending || latestExport?.status === 'pending' || locked}
          onClick={() => void runExport()}
        />
      </div>
    </header>
  );

  // ---- The timeline: width is time.
  const ticks = useMemo(() => {
    if (total <= 0) return [];
    const every = total <= 12 ? 1 : total <= 40 ? 5 : total <= 120 ? 10 : 30;
    const out: { at: number; label: string | null }[] = [];
    for (let t = 0; t <= total + 1e-6; t += every) {
      const labelEvery = every === 1 ? 2 : 1;
      out.push({ at: t / total, label: Math.round(t / every) % labelEvery === 0 ? `${t} s` : null });
    }
    return out;
  }, [total]);

  const timeline = (
    <section className={styles.timeline} aria-label="Timeline">
      <div className={styles.timelineHead}>
        <Text type="label">Timeline</Text>
        {draft && (
          <SegmentedControl
            label="Transition between cuts"
            size="sm"
            value={draft.transition}
            onChange={(v: string) => change({ ...draft, transition: v as Draft['transition'] }, 300)}
            isDisabled={locked}
          >
            <SegmentedControlItem value="hard" label="Hard cuts" />
            <SegmentedControlItem value="fade" label="Fades" />
          </SegmentedControl>
        )}
        {draft?.transition === 'fade' && (
          <NumberInput
            label="Fade length"
            isLabelHidden
            size="sm"
            units="s"
            value={draft.fadeSeconds}
            min={0.1}
            max={4.9}
            step={0.25}
            isDisabled={locked}
            onChange={(v: number) => change({ ...draft, fadeSeconds: v }, 600, 'fade')}
            width={96}
          />
        )}
        <div className={styles.timelineEnd}>
          {removed && (
            <span className={styles.undoRemove}>
              <Text type="supporting">Cut removed.</Text>
              <Button label="Undo" size="sm" variant="ghost" icon={<Undo2 size={14} />} isDisabled={locked} onClick={undoRemove} />
            </span>
          )}
          {locked && <Text type="supporting">The AI editor is changing the timeline.</Text>}
          <Button
            label="Add clips"
            size="sm"
            icon={<Plus size={14} />}
            isDisabled={locked || clips.length === 0}
            tooltip={clips.length === 0 ? 'Make a video first' : undefined}
            onClick={() => setBin(true)}
          />
        </div>
      </div>
      {project.isLoading || !draft ? (
        <div className={styles.track}>
          <Skeleton height={72} />
        </div>
      ) : project.error && !data ? (
        <div className={styles.trackEmpty}>
          <ErrorNote
            error={project.error}
            action={<Button label="Try again" size="sm" variant="ghost" onClick={() => void project.refetch()} />}
          />
        </div>
      ) : items.length === 0 ? (
        <div className={styles.trackEmpty}>
          {clips.length === 0 ? (
            <EmptyState
              isCompact
              title="No clips yet"
              description="Make a video from one of your stills first, then come back to cut it into a film."
              actions={<Button label="Go to Video" size="sm" onClick={onGoToVideo} />}
            />
          ) : (
            <EmptyState
              isCompact
              title="The timeline is empty"
              description="Add clips, or ask the AI editor to cut a film for you."
              actions={<Button label="Add clips" size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setBin(true)} />}
            />
          )}
        </div>
      ) : (
        <div ref={timelineRef} tabIndex={-1} className={styles.trackBox} onKeyDown={onTimelineKey}>
          <div className={styles.ruler} aria-hidden>
            {ticks.map((t) => (
              <span key={t.at} className={styles.tick} style={{ left: `${t.at * 100}%` }} data-major={t.label !== null || undefined}>
                {t.label && <span className={`${styles.tickLabel} num`}>{t.label}</span>}
              </span>
            ))}
          </div>
          <ol className={styles.track} aria-label="Cuts in order">
            {items.map((c, i) => (
              <CutBlock
                key={c.key}
                index={i}
                cut={c}
                server={serverByKey.get(c.key)}
                label={clipById.get(c.clipId)?.label || 'A clip no longer in your library'}
                thumb={thumbOf(c.clipId)}
                selected={selected === c.key}
                playing={playing === c.key}
                onToggle={toggle}
              />
            ))}
          </ol>
          <Text type="supporting" as="p">
            With the timeline focused: Delete removes the picked cut, Alt with an arrow moves it, Cmd+Z undoes and
            Cmd+Shift+Z redoes.
          </Text>
        </div>
      )}
    </section>
  );

  // ---- The right panel: Look and Editor.
  const side = (
    <aside className={styles.panel} aria-label="Look and editor">
      <div className={styles.tabs}>
        <TabList value={panel} onChange={(v: string) => setPanel(v as 'look' | 'editor')} layout="fill" hasDivider>
          <Tab value="look" label="Look" icon={<Palette size={14} />} />
          <Tab value="editor" label="Editor" icon={<Send size={14} />} />
        </TabList>
      </div>
      <div className={styles.panelBody}>
        {panel === 'look' ? (
          selectedCut ? (
            <CutPanel
              key={selectedCut.key}
              index={selectedIndex}
              count={items.length}
              cut={selectedCut}
              server={serverByKey.get(selectedCut.key)}
              notes={data?.notes[selectedCut.key] ?? NO_NOTES}
              label={clipById.get(selectedCut.clipId)?.label || 'A clip no longer in your library'}
              thumb={thumbOf(selectedCut.clipId)}
              length={secondsById.get(selectedCut.versionId ?? selectedCut.clipId) ?? 5}
              derived={data?.derived ?? NO_DERIVED}
              locked={locked}
              onChange={update}
              onColourAll={colourAll}
              onMove={move}
              onRemove={remove}
              flush={flush}
            />
          ) : (
            <div className={styles.panelEmpty}>
              <EmptyState
                isCompact
                title="Pick a cut"
                description="Choose a cut on the timeline to trim it, give it a look and pick its version."
              />
            </div>
          )
        ) : (
          <>
            <EditorChat data={data} flush={flush} loading={project.isLoading} />
            <Memory memory={data?.memory} loading={project.isLoading} />
          </>
        )}
      </div>
    </aside>
  );

  return (
    <div className={styles.edit}>
      {topBar}
      {exportFilm.error && (
        <div className={styles.notice}>
          <ErrorNote error={exportFilm.error} />
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.main}>
          <Player
            active={active}
            items={items}
            selected={selected}
            mediaOf={mediaOf}
            posterOf={posterOf}
            latestExport={latestExport}
            onPlaying={setPlaying}
          />
          {timeline}
        </div>
        {side}
      </div>
      <ClipBin
        isOpen={bin}
        onClose={() => setBin(false)}
        clips={clips}
        full={items.length >= MAX_CUTS}
        locked={locked}
        onAdd={add}
        onGoToVideo={onGoToVideo}
      />
    </div>
  );
}

function SaveNote({ state, error, onRetry }: { state: string; error: string | null; onRetry: () => void }) {
  if (state === 'saving' || state === 'unsaved') return <Text type="supporting">Saving…</Text>;
  if (state === 'saved') return <Text type="supporting">Saved</Text>;
  if (state === 'error')
    return (
      <span className={styles.saveError}>
        <StatusDot variant="error" label="Not saved" />
        <Text type="supporting">Not saved: {error ?? 'the server did not answer.'}</Text>
        <Button label="Try again" size="sm" variant="ghost" onClick={onRetry} />
      </span>
    );
  return null;
}

/** The clips to cut from: a contact sheet; a click puts one on the end of the timeline. */
function ClipBin({
  isOpen,
  onClose,
  clips,
  full,
  locked,
  onAdd,
  onGoToVideo,
}: {
  isOpen: boolean;
  onClose: () => void;
  clips: Project['clips'];
  full: boolean;
  locked: boolean;
  onAdd: (clipId: string, seconds: number) => void;
  onGoToVideo: () => void;
}) {
  const [limit, setLimit] = useState(CLIP_PAGE);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (isOpen) setAdded(0);
  }, [isOpen]);
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} width={880} maxHeight="85dvh">
      <DialogHeader
        title="Add clips"
        subtitle={
          full
            ? 'The timeline holds 24 cuts. Remove one to add another.'
            : added > 0
              ? `${added} added to the end of the timeline.`
              : 'Each one you pick goes on the end of the timeline.'
        }
        onOpenChange={(open: boolean) => !open && onClose()}
      />
      <div className={styles.bin}>
        {clips.length === 0 ? (
          <EmptyState
            isCompact
            title="No clips yet"
            description="Make a video from one of your stills first."
            actions={<Button label="Go to Video" size="sm" onClick={onGoToVideo} />}
          />
        ) : (
          <div data-disabled={full || locked || undefined} className={styles.binGrid}>
            <MediaGrid
              label="Your clips"
              density="small"
              items={clips.slice(0, limit).map((c) => ({
                id: c.id,
                kind: 'clip' as const,
                thumb: stillThumbUrl(c.stillId),
                title: c.label || 'Clip',
                detail: secs(c.seconds),
                ratio: 16 / 9,
              }))}
              onActivate={(id) => {
                const c = clips.find((x) => x.id === id);
                if (!c || full || locked) return;
                onAdd(c.id, c.seconds);
                setAdded((n) => n + 1);
              }}
            />
          </div>
        )}
        {clips.length > limit && (
          <div>
            <Button
              label={`Show ${Math.min(CLIP_PAGE, clips.length - limit)} more`}
              size="sm"
              variant="ghost"
              onClick={() => setLimit((n) => n + CLIP_PAGE)}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

type CutBlockProps = {
  index: number;
  cut: Cut;
  server: Project['timeline'][number] | undefined;
  label: string;
  thumb: string | undefined;
  selected: boolean;
  playing: boolean;
  onToggle: (key: string) => void;
};

/** One cut on the timeline, as wide as its seconds. Memoised: editing one cut redraws only it. */
const CutBlock = memo(function CutBlock({ index, cut, server, label, thumb, selected, playing, onToggle }: CutBlockProps) {
  const pending = !!server?.pendingId;
  const steps = colourSteps(cut.colour);
  const graded = !isNeutral(cut.colour);
  const state = pending ? 'Re-rendering' : server?.lastError ? 'The last change failed' : null;
  return (
    <li className={styles.cutItem} style={{ flexGrow: Math.max(0.5, cut.duration) }} data-cutkey={cut.key}>
      <button
        type="button"
        className={styles.cut}
        data-selected={selected || undefined}
        data-playing={playing || undefined}
        onClick={() => onToggle(cut.key)}
        aria-pressed={selected}
        aria-label={`Cut ${index + 1}: ${label}, ${round(cut.duration)} seconds${state ? `, ${state.toLowerCase()}` : ''}`}
      >
        <span className={styles.cutThumb}>
          {thumb && (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              style={steps ? { filter: colourCss(steps).filter } : undefined}
            />
          )}
        </span>
        <span className={styles.cutText}>
          <span className={styles.cutLabel}>{label}</span>
          <span className={`${styles.cutMeta} num`}>
            {secs(cut.duration)}
            {graded ? `, ${GRADES.find((g) => g.id === cut.colour?.gradeId && g.id !== 'none')?.name.toLowerCase() ?? 'adjusted'}` : ''}
          </span>
        </span>
        {state && (
          <span className={styles.cutState}>
            <StatusDot variant={pending ? 'accent' : 'error'} label={state} tooltip={state} isPulsing={pending} />
          </span>
        )}
      </button>
    </li>
  );
});

type CutPanelProps = {
  index: number;
  count: number;
  cut: Cut;
  server: Project['timeline'][number] | undefined;
  notes: string[];
  label: string;
  thumb: string | undefined;
  length: number;
  derived: Project['derived'];
  locked: boolean;
  onChange: (key: string, patch: Partial<Cut>, delay?: number) => void;
  onColourAll: (colour: CutColour | undefined) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onRemove: (key: string) => void;
  flush: () => Promise<boolean>;
};

/** The picked cut in the Look tab: its trim, its look and adjustments, its version. */
function CutPanel({
  index,
  count,
  cut,
  server,
  notes,
  label,
  thumb,
  length,
  derived,
  locked,
  onChange,
  onColourAll,
  onMove,
  onRemove,
  flush,
}: CutPanelProps) {
  const utils = trpc.useUtils();
  const pending = !!server?.pendingId;
  // Returned, so a button stays busy until the refetch shows the result.
  const done = () => utils.edit.project.invalidate();
  const setVersion = trpc.edit.setVersion.useMutation({ onSuccess: done });
  // The original plus every finished copy of this cut, newest first, so any can be picked again.
  const versions = useMemo(() => {
    const copies = derived.filter((d) => d.status === 'succeeded' && rootClipId(derived, d.id) === cut.clipId);
    return [
      { id: 'original', name: 'Original clip', hint: 'Before any grade or edit' },
      ...copies.map((d) => ({
        id: d.id,
        name: derivedLabel(d),
        hint: `${d.seconds} s, ${new Date(d.createdAt).toLocaleString()}`,
      })),
    ];
  }, [derived, cut.clipId]);
  const canPick = versions.length > 1 || !!cut.versionId || pending;
  const out = round(cut.sourceStart + cut.duration);
  const colour = cut.colour ?? NEUTRAL_COLOUR;
  const setColour = (patch: Partial<CutColour>) => onChange(cut.key, { colour: { ...colour, ...patch } }, 800);
  return (
    <div className={styles.cutPanel}>
      <div className={styles.cutHead}>
        <span className={styles.cutHeadThumb}>{thumb && <img src={thumb} alt="" />}</span>
        <div className={styles.cutHeadText}>
          <Text type="label" maxLines={2}>
            {label}
          </Text>
          <Text type="supporting" hasTabularNumbers>
            Cut {index + 1} of {count}, {cut.sourceStart} s to {out} s
            {notes.length ? `, ${notes.join(', ')}` : ''}
          </Text>
        </div>
      </div>
      <div className={styles.cutTools}>
        <Button label="Earlier" size="sm" variant="ghost" icon={<ArrowLeft size={14} />} isDisabled={index === 0 || locked} onClick={() => onMove(cut.key, -1)} />
        <Button label="Later" size="sm" variant="ghost" icon={<ArrowRight size={14} />} isDisabled={index === count - 1 || locked} onClick={() => onMove(cut.key, 1)} />
        <Button label="Remove" size="sm" variant="ghost" icon={<Trash2 size={14} />} isDisabled={locked} onClick={() => onRemove(cut.key)} />
      </div>

      {pending && (
        <Banner
          status="info"
          title="Re-rendering this cut"
          description="This takes a few minutes; the timeline keeps the old version until it is done."
          endContent={
            <Button
              label="Use the original"
              size="sm"
              variant="ghost"
              isLoading={setVersion.isPending}
              onClick={() => setVersion.mutate({ key: cut.key, versionId: null })}
            />
          }
        />
      )}
      {server?.lastError && !pending && (
        <Banner status="error" title="The last change to this cut failed" description={server.lastError} />
      )}

      <section className={styles.group}>
        <Heading level={4}>Trim</Heading>
        <div className={styles.trim}>
          <NumberInput
            label="In"
            units="s"
            value={cut.sourceStart}
            min={0}
            max={round(Math.max(0, length - 0.5))}
            step={0.1}
            isDisabled={locked}
            onChange={(v: number) => {
              const start = Math.min(v, length - 0.5);
              onChange(cut.key, { sourceStart: round(start), duration: round(Math.max(0.5, Math.min(out, length) - start)) });
            }}
            width="100%"
          />
          <NumberInput
            label="Out"
            units="s"
            value={out}
            min={round(cut.sourceStart + 0.5)}
            max={length}
            step={0.1}
            isDisabled={locked}
            onChange={(v: number) => onChange(cut.key, { duration: round(Math.max(0.5, Math.min(v, length) - cut.sourceStart)) })}
            width="100%"
          />
        </div>
        <Text type="supporting" hasTabularNumbers>
          Of {length} s in the clip.
        </Text>
      </section>

      <section className={styles.group}>
        <Heading level={4}>Look</Heading>
        <ul className={styles.looks} aria-label="Looks">
          {GRADES.map((g) => {
            const steps = colourSteps({ ...colour, gradeId: g.id as CutColour['gradeId'] });
            const css = steps ? colourCss(steps) : null;
            const on = colour.gradeId === g.id;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className={styles.look}
                  aria-pressed={on}
                  disabled={locked}
                  title={g.hint}
                  onClick={() => onChange(cut.key, { colour: { ...colour, gradeId: g.id as CutColour['gradeId'] } }, 400)}
                >
                  <span className={styles.lookFrame}>
                    {thumb && <img src={thumb} alt="" style={css && css.filter !== 'none' ? { filter: css.filter } : undefined} />}
                    {css?.balance && <span className={styles.balance} style={{ background: css.balance }} aria-hidden />}
                    {css?.lift && (
                      <span className={styles.lift} style={{ background: css.lift.color, opacity: css.lift.opacity }} aria-hidden />
                    )}
                  </span>
                  <span className={styles.lookName}>{g.id === 'none' ? 'No look' : g.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <Slider
          label="Strength"
          value={colour.strength}
          min={0}
          max={1}
          step={0.01}
          onChange={(v: number) => setColour({ strength: v })}
          formatValue={(v: number) => `${Math.round(v * 100)}%`}
          valueDisplay="text"
          isDisabled={colour.gradeId === 'none' || locked}
          width="100%"
        />
      </section>

      <section className={styles.group}>
        <Heading level={4}>Adjust</Heading>
        {ADJUSTMENTS.map((a) => (
          <Slider
            key={a.id}
            label={a.label}
            value={colour[a.id]}
            min={-1}
            max={1}
            step={0.01}
            isDisabled={locked}
            onChange={(v: number) => setColour({ [a.id]: v })}
            formatValue={signed}
            valueDisplay="text"
            width="100%"
          />
        ))}
        <div className={styles.row}>
          <Button
            label="Reset"
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} />}
            isDisabled={!cut.colour || locked}
            onClick={() => onChange(cut.key, { colour: undefined }, 300)}
          />
          <Button
            label="Apply to every cut"
            size="sm"
            variant="ghost"
            icon={<Copy size={14} />}
            isDisabled={count < 2 || locked}
            onClick={() => onColourAll(cut.colour)}
          />
        </div>
        <Text type="supporting" as="p">
          Instant and free: the preview shows it as you drag, and it rides along with the export.
        </Text>
      </section>

      {canPick && (
        <section className={styles.group}>
          <Heading level={4}>Version</Heading>
          <OptionSelect
            label="Version of this cut"
            labelHidden
            options={versions}
            value={cut.versionId && versions.some((v) => v.id === cut.versionId) ? cut.versionId : 'original'}
            disabled={locked || setVersion.isPending}
            onChange={async (id) => {
              if (id === (cut.versionId ?? 'original') && !pending) return;
              if (!(await flush())) return;
              setVersion.mutate({ key: cut.key, versionId: id === 'original' ? null : id });
            }}
          />
          {setVersion.error && <Banner status="error" title="The version was not changed" description={setVersion.error.message} />}
          <Text type="supporting" as="p">
            Every finished grade and edit is kept, so you can switch back to any of them.
          </Text>
        </section>
      )}
    </div>
  );
}

/** A player with its built-in grade: the filter on the video, the white
 * balance and lifted blacks as layers over it (src/colour.ts `colourCss`). */
function Graded({ colour, hidden, children }: { colour: CutColour | undefined; hidden?: boolean; children: ReactElement<{ style?: CSSProperties }> }) {
  const steps = colourSteps(colour);
  const css = steps ? colourCss(steps) : null;
  return (
    <div className={styles.graded} data-hidden={hidden || undefined}>
      {cloneElement(children, { style: css && css.filter !== 'none' ? { filter: css.filter } : undefined })}
      {css?.balance && <div className={styles.balance} style={{ background: css.balance }} aria-hidden />}
      {css?.lift && <div className={styles.lift} style={{ background: css.lift.color, opacity: css.lift.opacity }} aria-hidden />}
    </div>
  );
}

type PlayerProps = {
  active: boolean;
  items: Cut[];
  selected: string | null;
  mediaOf: (c: Cut) => string;
  posterOf: (clipId: string) => string | undefined;
  latestExport: Project['exports'][number] | undefined;
  /** The cut playing while the whole timeline plays, or null. */
  onPlaying: (key: string | null) => void;
};

/**
 * The viewer: plays the picked cut within its trim, the whole timeline in order, or the
 * latest export. While the timeline plays, the next cut is already loading in a hidden
 * player seeked to its in point, so each cut starts the moment the one before it ends.
 */
function Player({ active, items, selected, mediaOf, posterOf, latestExport, onPlaying }: PlayerProps) {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const [mode, setMode] = useState<'cut' | 'timeline' | 'export'>('cut');
  const [at, setAt] = useState(0);
  const saver = useDownload();
  const graded = useGradedDownload();
  const [exportCut, setExportCut] = useState(0);
  const utils = trpc.useUtils();
  const resume = trpc.edit.resumeExport.useMutation({
    onSuccess: () => void utils.edit.project.invalidate(),
  });

  useEffect(() => {
    if (selected) setMode('cut');
  }, [selected]);
  const exportReady = latestExport?.status === 'succeeded' && latestExport.finalId;
  useEffect(() => {
    if (exportReady) setMode('export');
  }, [exportReady]);

  const cut =
    mode === 'timeline'
      ? (items[at] ?? items[0])
      : (items.find((c) => c.key === selected) ?? items[0]);
  const playingKey = mode === 'timeline' && cut ? cut.key : null;
  useEffect(() => {
    onPlaying(playingKey);
  }, [playingKey, onPlaying]);
  const exportSrc = exportReady ? libraryUrl('edit', latestExport.finalId!) : null;
  const exportGrades = latestExport?.grades ?? [];
  const exportGraded = exportGrades.some((g) => !isNeutral(g.colour));
  // Which cut of the export is on screen, so its grade can be shown over it.
  const trackExport = (v: HTMLVideoElement) => {
    if (!exportGraded || !latestExport || !v.duration) return;
    const ends = cutEnds(
      exportGrades.map((g) => g.seconds),
      latestExport.transition,
      latestExport.fadeSeconds ?? 0.5,
      v.duration
    );
    let i = ends.findIndex((end) => v.currentTime < end);
    if (i < 0) i = ends.length - 1;
    if (i !== exportCut) setExportCut(i);
  };
  // The players on the stage: the shown cut, plus the next one while the timeline plays.
  const layers = !active || mode === 'export' || !cut ? [] : mode === 'timeline' ? items.slice(at, at + 2) : [cut];
  const slot = (c: Cut) => `${c.key}:${mediaOf(c)}`;

  // Keep the shown cut at its in point when it is retrimmed (a new file reloads by itself).
  useEffect(() => {
    if (mode !== 'cut' || !cut) return;
    const v = videos.current.get(slot(cut));
    if (v && v.readyState >= 1) v.currentTime = cut.sourceStart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cut?.key, cut?.sourceStart]);

  // Timeline: start the shown cut, and hand over to the next on its out point.
  useEffect(() => {
    if (mode !== 'timeline' || !cut) return;
    const v = videos.current.get(slot(cut));
    if (v && v.readyState >= 1) void v.play().catch(() => undefined);
    let raf = 0;
    const tick = () => {
      const el = videos.current.get(slot(cut));
      if (el && el.currentTime >= cut.sourceStart + cut.duration - 0.03) {
        if (at < items.length - 1) setAt(at + 1);
        else {
          el.pause();
          setMode('cut');
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, at, cut?.key, cut?.sourceStart, cut?.duration, items.length]);

  const note =
    mode === 'export'
      ? `The exported film, ${latestExport?.seconds} s, ${latestExport?.cuts} cuts.`
      : mode === 'timeline'
        ? `Playing cut ${at + 1} of ${items.length}, with its look. The preview plays hard cuts; fades appear in the export.`
        : cut
          ? `Cut ${items.indexOf(cut) + 1}, ${cut.sourceStart} s to ${round(cut.sourceStart + cut.duration)} s.`
          : '';

  return (
    <section className={styles.viewer} aria-label="Viewer">
      <div className={styles.screen}>
        {!exportSrc && !cut ? (
          <StageEmpty title="Nothing to play yet" hint="Add a clip to the timeline and it plays here." />
        ) : (
          <StageFrame ratio={16 / 9}>
            <div className={styles.layers}>
              {!active ? null : mode === 'export' && exportSrc ? (
                <Graded colour={exportGrades[exportCut]?.colour}>
                  <video
                    key={exportSrc}
                    src={exportSrc}
                    controls
                    playsInline
                    muted
                    preload="metadata"
                    onTimeUpdate={(e) => trackExport(e.currentTarget)}
                    onSeeked={(e) => trackExport(e.currentTarget)}
                    aria-label="Exported film"
                  />
                </Graded>
              ) : (
                layers.map((c, i) => {
                  const k = slot(c);
                  const shown = i === 0;
                  return (
                    <Graded key={k} colour={c.colour} hidden={!shown}>
                      <video
                        ref={(el) => {
                          if (el) videos.current.set(k, el);
                          else videos.current.delete(k);
                        }}
                        aria-hidden={shown ? undefined : true}
                        src={mediaOf(c)}
                        poster={posterOf(c.clipId)}
                        controls={shown && mode === 'cut'}
                        playsInline
                        muted
                        // Only the hidden next cut of a playing timeline loads ahead.
                        preload={shown ? 'metadata' : 'auto'}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.currentTime = c.sourceStart;
                          if (shown && mode === 'timeline') void e.currentTarget.play().catch(() => undefined);
                        }}
                        onTimeUpdate={(e) => {
                          const v = e.currentTarget;
                          if (shown && mode === 'cut' && v.currentTime >= c.sourceStart + c.duration) v.pause();
                        }}
                        aria-label={shown ? 'Cut preview' : undefined}
                      />
                    </Graded>
                  );
                })
              )}
            </div>
          </StageFrame>
        )}
      </div>

      <div className={styles.transport}>
        {mode === 'timeline' ? (
          <Button label="Stop" size="sm" icon={<Square size={14} />} onClick={() => setMode('cut')} />
        ) : (
          <Button
            label="Play the timeline"
            size="sm"
            icon={<Play size={14} />}
            isDisabled={!items.length}
            onClick={() => {
              setAt(0);
              setMode('timeline');
            }}
          />
        )}
        {exportReady && mode !== 'export' && (
          <Button label="Watch the export" size="sm" variant="ghost" icon={<Film size={14} />} onClick={() => setMode('export')} />
        )}
        <Text type="supporting" maxLines={1}>
          {note}
        </Text>
        <div className={styles.transportEnd}>
          {exportReady && (
            <Button
              label={saver.label(exportGraded ? 'Download ungraded' : 'Download film')}
              size="sm"
              variant="ghost"
              icon={<Download size={14} />}
              isLoading={saver.pending}
              onClick={() => saver.start(libraryUrl('edit', latestExport.finalId!), 'render-to-film.mp4')}
            />
          )}
          {exportReady && exportGraded && (
            <Button
              label={graded.label('Download graded film')}
              size="sm"
              variant="ghost"
              icon={<Palette size={14} />}
              isLoading={graded.pending}
              onClick={() =>
                graded.start(
                  libraryUrl('edit', latestExport.finalId!),
                  { grades: exportGrades, transition: latestExport.transition, fadeSeconds: latestExport.fadeSeconds },
                  'render-to-film-graded'
                )
              }
            />
          )}
          {graded.pending && <Button label="Cancel" size="sm" variant="ghost" icon={<X size={14} />} onClick={graded.cancel} />}
        </div>
      </div>

      {(graded.pending || saver.error || graded.error || latestExport?.status === 'pending' || latestExport?.status === 'failed') && (
        <div className={styles.viewerNotes}>
          {latestExport?.status === 'pending' && (
            <div className={styles.exporting} role="status">
              <span className={styles.exportingText}>
                <Text type="label">Exporting the film</Text>
                <Text type="supporting" hasTabularNumbers>
                  <Elapsed runKey={latestExport.id} since={Date.parse(latestExport.createdAt) || undefined} />
                </Text>
              </span>
              <ProgressBar label="Exporting the film" isLabelHidden value={0} isIndeterminate />
            </div>
          )}
          {graded.pending && (
            <Text type="supporting" as="p">
              Grading plays the film through once in this tab, so it takes about as long as the film. Keep the tab open.
            </Text>
          )}
          {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
          {graded.error && (
            <Banner
              status="error"
              title="The graded film was not made"
              description={graded.error}
              endContent={<Button label="Dismiss" size="sm" variant="ghost" onClick={graded.clearError} />}
            />
          )}
          {latestExport?.status === 'failed' && (
            <Banner
              status="error"
              title="The export stopped"
              description={`${latestExport.error ?? 'The film could not be put together.'} ${
                latestExport.finalId || latestExport.parts
                  ? 'Check again to pick it up where it left off, or press Export film to start over.'
                  : 'Press Export film to start over.'
              }${resume.error ? ` ${resume.error.message}` : ''}`}
              endContent={
                latestExport.finalId || latestExport.parts ? (
                  <Button
                    label="Check again"
                    size="sm"
                    icon={<RotateCw size={14} />}
                    isLoading={resume.isPending}
                    onClick={() => resume.mutate({ id: latestExport.id })}
                  />
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </section>
  );
}

function EditorChat({ data, flush, loading }: { data: Project | undefined; flush: () => Promise<boolean>; loading: boolean }) {
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const send = trpc.edit.agentSend.useMutation({
    onSuccess: () => {
      setText('');
      void utils.edit.project.invalidate();
    },
  });
  const clear = trpc.edit.clearChat.useMutation({
    onSuccess: () => {
      setConfirmClear(false);
      void utils.edit.project.invalidate();
    },
  });
  const working = !!data?.agent || send.isPending;
  const messages = data?.messages ?? [];
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, working]);

  const submit = async (message = text) => {
    if (!message.trim() || working) return;
    if (!(await flush())) return;
    send.mutate({ text: message.trim() });
  };

  if (loading)
    return (
      <div className={styles.chat}>
        <Skeleton height={14} width="70%" />
        <Skeleton height={14} width="90%" index={1} />
        <Skeleton height={14} width="50%" index={2} />
      </div>
    );
  return (
    <section className={styles.chat} aria-label="AI editor">
      <Text type="supporting" as="p">
        Tell it what you want, the way you would brief an editor. It changes the timeline for you.
      </Text>
      {messages.length === 0 && !working ? (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className={styles.suggestion} onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <ol className={styles.messages} ref={listRef} aria-live="polite">
          {messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className={styles.message} data-role={m.role} data-error={m.error || undefined}>
              <Text type="supporting">{m.role === 'user' ? 'You' : 'Editor'}</Text>
              <p className={styles.messageText}>{m.text}</p>
              {m.actions?.length ? (
                <ul className={styles.actions}>
                  {m.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
          {working && (
            <li className={styles.message} data-role="agent">
              <Text type="supporting">Editor</Text>
              <p className={styles.messageText}>
                <StatusDot variant="accent" label="Working" isPulsing />{' '}
                {data?.agent?.status === 'applying' ? 'Applying the changes…' : 'Thinking about the cut…'}
              </p>
            </li>
          )}
        </ol>
      )}
      <div
        className={styles.composer}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter adds a line.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'TEXTAREA') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <TextArea
          label="Message to the AI editor"
          isLabelHidden
          placeholder="For example: make it 30 seconds, open on the aerial, grade it blue hour luxe"
          value={text}
          onChange={setText}
          rows={3}
          isDisabled={working}
          width="100%"
        />
        <div className={styles.composerBar}>
          <Text type="supporting">Enter sends, Shift+Enter adds a line.</Text>
          <div className={styles.row}>
            {messages.length > 0 && (
              <Button label="Clear chat" size="sm" variant="ghost" isDisabled={working} onClick={() => setConfirmClear(true)} />
            )}
            <Button
              label="Send"
              variant="primary"
              size="sm"
              icon={<Send size={14} />}
              isLoading={working}
              isDisabled={!text.trim()}
              onClick={() => void submit()}
            />
          </div>
        </div>
      </div>
      <ErrorNote error={send.error} />
      {clear.error && <Banner status="error" title="The conversation was not cleared" description={clear.error.message} />}
      <AlertDialog
        isOpen={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the conversation?"
        description="The messages go; the timeline and the editor's memory stay."
        actionLabel="Clear"
        isActionLoading={clear.isPending}
        onAction={() => clear.mutate()}
      />
    </section>
  );
}

function Memory({ memory, loading }: { memory: string[] | undefined; loading: boolean }) {
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [forgetting, setForgetting] = useState<string | null>(null);
  const done = () => void utils.edit.project.invalidate();
  const add = trpc.edit.addMemory.useMutation({
    onSuccess: () => {
      setText('');
      done();
    },
  });
  const forget = trpc.edit.forgetMemory.useMutation({
    onSuccess: () => {
      setForgetting(null);
      done();
    },
  });
  const list = useMemo(() => memory ?? [], [memory]);
  const submit = () => {
    if (text.trim().length >= 2) add.mutate({ text: text.trim() });
  };

  if (loading) return null;
  return (
    <section className={styles.memory} aria-label="Memory">
      <Heading level={4}>Memory</Heading>
      <Text type="supporting" as="p">
        Standing preferences the editor follows in every session.
      </Text>
      {list.length === 0 ? (
        <Text type="supporting" as="p">
          Nothing yet. Add a preference below, or tell the editor &ldquo;remember that I like long, slow cuts&rdquo;.
        </Text>
      ) : (
        <ul className={styles.memoryList}>
          {list.map((m) => (
            <li key={m} className={styles.memoryItem}>
              <Text>{m}</Text>
              <IconButton label={`Forget: ${m}`} tooltip="Forget" size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setForgetting(m)} />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.remember}>
        <TextInput
          label="New preference"
          isLabelHidden
          placeholder="For example: always end on the widest shot"
          value={text}
          onChange={(v: string) => setText(v.slice(0, 240))}
          onEnter={submit}
          width="100%"
        />
        <Button
          label="Remember"
          size="md"
          icon={<BookmarkPlus size={16} />}
          isLoading={add.isPending}
          isDisabled={text.trim().length < 2}
          onClick={submit}
        />
      </div>
      {add.error && <Banner status="error" title="That preference was not saved" description={add.error.message} />}
      {forget.error && <Banner status="error" title="That preference was not forgotten" description={forget.error.message} />}
      <AlertDialog
        isOpen={forgetting !== null}
        onOpenChange={(open: boolean) => !open && setForgetting(null)}
        title="Forget this preference?"
        description={forgetting ?? ''}
        actionLabel="Forget"
        isActionLoading={forget.isPending}
        onAction={() => forgetting && forget.mutate({ text: forgetting })}
      />
    </section>
  );
}
