import { Clapperboard, Download, Focus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CloseupJob } from '../closeups-api.ts';
import type { Clip, Still } from '../api.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutions,
  motionLabel,
  videoModelName,
  type ImageModelId,
} from '../models.ts';
import { ratioOf } from './director/shared.ts';
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  SegmentedControlItem,
  StatusDot,
  Text,
  TextInput,
} from './kit.ts';
import { canCompare } from './lib/compare.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { savePreset, stillPreset } from './lib/reuse.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { CompareBoard } from './parts/CompareBoard.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { MediaGrid, MediaGridSkeleton } from './parts/MediaGrid.tsx';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { Stage, StageEmpty, StageFrame, StageWorking } from './parts/Stage.tsx';
import { StarButton, useStar } from './parts/StarButton.tsx';
import { TakeStrip, type TakeStripItem } from './parts/TakeStrip.tsx';
import { useKeys } from './parts/useKeys.ts';
import { BenchGroup, Note, Workbench } from './parts/Workbench.tsx';
import { trpc } from './trpc.ts';
import { FullSize } from './ui/FullSize.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { Buy, useSpend } from './ui/Price.tsx';
import own from './CloseupsPage.module.css';

const PAGE = 12;

const SOURCES = [
  { id: 'clip', name: 'A video' },
  { id: 'still', name: 'A still' },
  { id: 'upload', name: 'An image' },
] as const;

type SourceKind = (typeof SOURCES)[number]['id'];

const COUNTS = [2, 3, 4, 5, 6].map((n) => ({ id: String(n), name: `${n} close-ups` }));

/** Steps the server is working through on its own; the page keeps polling. */
const WORKING = new Set(['capturing', 'captured', 'finding', 'picked', 'rendering']);

type Upload = { src: string; name: string; width: number; height: number; hostedUrl?: string | undefined };

export type CloseupsPageProps = {
  /** Whether this screen is on screen; a hidden one polls slowly, skips the library and its keys. */
  active: boolean;
  /** Go to Stills: when there is nothing to search yet, and after "Reuse settings". */
  onGoToStills: () => void;
  /** Animate a finished close-up on the Video screen. */
  onAnimate: (stillId: string) => void;
};

export function CloseupsPage({ active, onGoToStills, onAnimate }: CloseupsPageProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (active && q.state.data?.stills.some((s) => s.status === 'pending') ? 8_000 : false),
  });

  const [kind, setKind] = useState<SourceKind>('clip');
  const [clipId, setClipId] = useState<string | null>(null);
  const [stillId, setStillId] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [shown, setShown] = useState(PAGE);
  const [count, setCount] = useState(4);
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [direction, setDirection] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  /** The close-up on the stage (its place in the search), or null for the source. */
  const [focus, setFocus] = useState<number | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [board, setBoard] = useState(false);
  const [full, setFull] = useState(false);

  const find = trpc.closeups.find.useMutation();
  const analyze = trpc.closeups.analyze.useMutation();
  const render = trpc.closeups.render.useMutation();

  const stalledRef = useRef(false);
  // With no search started here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.closeups.job.useQuery(jobId ? { id: jobId } : {}, {
    // Hidden, it still checks in now and then so the next step starts on time.
    refetchInterval: (q) =>
      q.state.data && WORKING.has(q.state.data.status) && !stalledRef.current ? (active ? 4000 : 15_000) : false,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;
  // The close-ups are the pictures; the search for them is the app's thinking.
  const priceItems = [{ preset: imageModel, resolution, count }];
  const spend = useSpend(priceItems);
  // A search waiting before its paid step shows that step's own price on its Continue button.
  const pausedItems = current
    ? [{ preset: current.imageModel, resolution: current.resolution, count: current.picks?.length ?? current.count }]
    : [];
  const pausedSpend = useSpend(pausedItems);
  // A step that failed to start leaves the search waiting at `captured` or
  // `picked`; nothing is running until "Try again".
  const stalled =
    (analyze.isError && current?.status === 'captured') || (render.isError && current?.status === 'picked');
  stalledRef.current = stalled;

  // The server records each finished step; the next paid step starts from here,
  // once per search, so its error lands next to the button.
  const advanced = useRef(new Set<string>());
  const currentId = current?.id;
  const currentStatus = current?.status;
  const analyzeMutate = analyze.mutate;
  const renderMutate = render.mutate;
  const refetchJob = job.refetch;
  // A search already running when the page loaded is picked up and watched.
  // One paused before a paid step waits for "Continue", so a reload never spends.
  useEffect(() => {
    if (!jobId && currentId && (currentStatus === 'capturing' || currentStatus === 'finding' || currentStatus === 'rendering')) {
      setJobId(currentId);
    }
  }, [jobId, currentId, currentStatus]);
  const startStep = useCallback(
    (id: string, status: CloseupJob['status'] | undefined) => {
      if (status === 'captured') {
        analyzeMutate({ id }, { onSettled: () => void refetchJob() });
      } else if (status === 'picked') {
        renderMutate(
          { id },
          {
            onSettled: () => {
              void refetchJob();
              void utils.library.invalidate();
            },
          }
        );
      }
    },
    [analyzeMutate, renderMutate, refetchJob, utils]
  );
  useEffect(() => {
    if (!currentId || currentId !== jobId) return;
    const key = `${currentId}:${currentStatus}`;
    if (advanced.current.has(key)) return;
    if (currentStatus === 'captured' || currentStatus === 'picked') {
      advanced.current.add(key);
      startStep(currentId, currentStatus);
    }
  }, [currentId, currentStatus, jobId, startStep]);
  const paused =
    current !== null && current.id !== jobId && (current.status === 'captured' || current.status === 'picked');

  const clips = useMemo(() => (library.data?.clips ?? []).filter((c) => c.status === 'succeeded'), [library.data]);
  const stills = useMemo(() => (library.data?.stills ?? []).filter((s) => s.status === 'succeeded'), [library.data]);
  const stillById = useMemo(() => new Map((library.data?.stills ?? []).map((s) => [s.id, s])), [library.data]);

  const clipItems = useMemo(
    () =>
      clips.slice(0, shown).map((c) => {
        const s = stillById.get(c.stillId);
        return {
          id: c.id,
          kind: 'clip' as const,
          thumb: stillThumbUrl(c.stillId),
          title: clipCaption(c),
          ratio: ratioOf(s?.width, s?.height),
        };
      }),
    [clips, shown, stillById]
  );
  const stillItems = useMemo(
    () =>
      stills.slice(0, shown).map((s) => ({
        id: s.id,
        kind: 'still' as const,
        thumb: stillThumbUrl(s.id),
        title: stillCaption(s),
        ratio: ratioOf(s.width, s.height),
      })),
    [stills, shown]
  );

  const selectedClip = clips.find((c) => c.id === clipId) ?? null;
  const selectedStill = stills.find((s) => s.id === stillId) ?? null;
  const clipStill = selectedClip ? stillById.get(selectedClip.stillId) : undefined;

  const working =
    find.isPending ||
    analyze.isPending ||
    render.isPending ||
    (current !== null && WORKING.has(current.status) && current.id === jobId && !stalled);
  const ready =
    kind === 'clip' ? selectedClip !== null : kind === 'still' ? selectedStill !== null : Boolean(upload?.hostedUrl);

  async function onFile(file: File) {
    setUploadError(null);
    const src = URL.createObjectURL(file);
    let width: number;
    let height: number;
    try {
      const bitmap = await createImageBitmap(file);
      ({ width, height } = bitmap);
      bitmap.close();
    } catch {
      URL.revokeObjectURL(src);
      setUploadError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
      return;
    }
    setUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.src);
      return { src, name: file.name, width, height };
    });
    setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setUpload((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      setUpload((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      setUploadError(
        isUploadFailure(e)
          ? { message: e.message }
          : e instanceof Error
            ? e
            : { message: 'The image could not be uploaded. Try again.' }
      );
    } finally {
      setUploading(false);
    }
  }

  async function run() {
    if (!ready || working) return;
    analyze.reset();
    render.reset();
    const settings = { count, imageModel, resolution, direction };
    try {
      const { id } =
        kind === 'clip'
          ? await find.mutateAsync({ kind: 'clip', id: selectedClip!.id, ...settings })
          : kind === 'still'
            ? await find.mutateAsync({ kind: 'still', id: selectedStill!.id, ...settings })
            : await find.mutateAsync({
                kind: 'upload',
                url: upload!.hostedUrl!,
                width: upload!.width,
                height: upload!.height,
                ...settings,
              });
      setJobId(id);
      setFocus(null);
      setTicked(new Set());
    } catch {
      // Shown under the button from find.error.
    }
  }

  /** Retry whichever step failed, or continue a paused search, with the same settings. */
  function retryStep() {
    if (!current) return;
    analyze.reset();
    render.reset();
    setJobId(current.id);
    advanced.current.add(`${current.id}:${current.status}`);
    startStep(current.id, current.status);
  }

  const stepError = find.error ?? analyze.error ?? render.error ?? null;
  const shots = useMemo(
    () => current?.shots ?? current?.picks?.map((p) => ({ ...p, stillId: undefined, error: undefined })) ?? [],
    [current?.shots, current?.picks]
  );
  const showShots =
    current !== null &&
    !paused &&
    (current.status === 'picked' || current.status === 'rendering' || current.status === 'done');

  const sourcePreview =
    kind === 'clip' && selectedClip
      ? stillViewUrl(selectedClip.stillId)
      : kind === 'still' && selectedStill
        ? stillViewUrl(selectedStill.id)
        : kind === 'upload' && upload
          ? upload.src
          : null;
  const sourceRatio =
    kind === 'clip' && clipStill
      ? ratioOf(clipStill.width, clipStill.height)
      : kind === 'still' && selectedStill
        ? ratioOf(selectedStill.width, selectedStill.height)
        : kind === 'upload' && upload
          ? ratioOf(upload.width, upload.height)
          : 16 / 9;

  // ---- Each close-up of the search, as a take.
  const shotState = (i: number) => {
    const shot = shots[i];
    if (!shot || !current) return { state: 'queued' as const, still: undefined, removed: false };
    const still = shot.stillId ? stillById.get(shot.stillId) : undefined;
    const removed = current.status === 'done' && shot.stillId !== undefined && still === undefined && library.data !== undefined;
    if (still?.status === 'succeeded') return { state: 'ready' as const, still, removed };
    if (removed) return { state: 'lost' as const, still, removed };
    if (still?.status === 'failed' || shot.error) return { state: 'failed' as const, still, removed };
    return { state: 'rendering' as const, still, removed };
  };
  const stripItems: TakeStripItem[] = showShots
    ? shots.map((shot, i) => {
        const { state, still } = shotState(i);
        return {
          id: String(i),
          kind: 'still',
          thumb: still?.status === 'succeeded' ? stillThumbUrl(still.id) : undefined,
          title: sentence(shot.subject),
          state,
          ratio: current ? ratioOf(current.width, current.height) : 16 / 9,
          note: state === 'lost' ? 'Removed' : undefined,
        };
      })
    : [];
  const readyStills = showShots
    ? shots.map((_, i) => shotState(i)).flatMap((s) => (s.state === 'ready' && s.still ? [s.still] : []))
    : [];
  const tickedStills = readyStills.filter((s) => ticked.has(s.id));
  const compare = canCompare(tickedStills.map(() => ({ kind: 'still' as const })));

  // The stage follows the first finished close-up until one is picked.
  const focusIndex = showShots ? (focus ?? Math.max(0, shots.findIndex((_, i) => shotState(i).state === 'ready'))) : null;
  const focused = focusIndex !== null ? shots[focusIndex] : undefined;
  const focusedState = focusIndex !== null ? shotState(focusIndex) : undefined;
  const focusedStill = focusedState?.state === 'ready' ? focusedState.still : undefined;
  const saver = useDownload();
  const star = useStar();

  const step = (by: -1 | 1) => {
    if (focusIndex === null || shots.length === 0) return;
    setFocus(Math.min(shots.length - 1, Math.max(0, focusIndex + by)));
  };
  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => step(-1), disabled: !showShots },
      { key: 'ArrowRight', onKey: () => step(1), disabled: !showShots },
      { key: 's', onKey: () => focusedStill && star.toggle('still', focusedStill.id), disabled: !focusedStill },
      { key: 'c', onKey: () => setBoard(true), disabled: !compare.ok },
      { key: 'f', onKey: () => setFull(true), disabled: !focusedStill },
    ],
    active
  );

  const reuse = (s: Still) => {
    savePreset('still', stillPreset(s));
    onGoToStills();
  };

  // ---- The stage.
  const pausedBanner = paused && current && (
    <StageEmpty
      title="Your last search is waiting"
      hint={
        current.status === 'captured'
          ? 'The frames are in. Continue to look for the close-ups in them.'
          : `${current.picks?.length ?? current.count} close-ups were found. Continue to shoot them.`
      }
      action={
        <Buy items={pausedItems}>
          <Button
            label="Continue"
            variant="primary"
            isDisabled={spend.blocked || pausedSpend.blocked}
            onClick={retryStep}
          />
        </Buy>
      }
    />
  );

  let stage;
  if (showShots && current && focused && focusIndex !== null) {
    const ratio = ratioOf(current.width, current.height);
    stage = (
      <Stage
        title={sentence(focused.subject)}
        caption={focused.why || undefined}
        actions={
          focusedStill ? (
            <>
              <FullSize
                src={libraryUrl('still', focusedStill.id)}
                kind="still"
                title={sentence(focused.subject)}
                alt={`Close-up: ${focused.subject}`}
                iconOnly
                isOpen={full}
                onOpenChange={setFull}
              />
              <StarButton kind="still" id={focusedStill.id} />
              <IconButton
                label={saver.pending ? saver.label('Download') : 'Download'}
                tooltip={saver.pending ? saver.label('Download') : 'Download'}
                size="sm"
                variant="ghost"
                isLoading={saver.pending}
                icon={<Download size={16} />}
                onClick={() => saver.start(libraryUrl('still', focusedStill.id), `close-up-${focusIndex + 1}.png`)}
              />
              <IconButton
                label="Reuse settings"
                tooltip="Open Stills with how this close-up was made"
                size="sm"
                variant="ghost"
                icon={<SlidersHorizontal size={16} />}
                onClick={() => reuse(focusedStill)}
              />
              <span className={own.gap} />
              <Button label="Make a video" size="sm" icon={<Clapperboard size={16} />} onClick={() => onAnimate(focusedStill.id)} />
            </>
          ) : undefined
        }
        below={
          <>
            {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
            {focusedState?.state === 'failed' && (
              <Banner
                status="error"
                title="This close-up didn't render"
                description={focusedState.still?.error ?? focused.error ?? 'Try finding close-ups again.'}
              />
            )}
          </>
        }
      >
        {focusedStill ? (
          <StageFrame ratio={ratio}>
            <img src={stillViewUrl(focusedStill.id)} alt={`Close-up: ${focused.subject}`} decoding="async" />
          </StageFrame>
        ) : focusedState?.state === 'lost' ? (
          <StageEmpty title="This close-up was removed from your library" />
        ) : focusedState?.state === 'failed' ? (
          <StageEmpty title="This close-up didn't render" hint="Try finding close-ups again." />
        ) : (
          <StageFrame ratio={ratio} dim>
            {sourcePreview && <img src={sourcePreview} alt="The source the close-ups come from" />}
            <StageWorking
              label={current.status === 'done' ? 'Shooting the close-up' : 'Lining up the shot'}
              runKey={`${current.id}-${focusIndex}`}
            />
          </StageFrame>
        )}
      </Stage>
    );
  } else {
    stage = (
      <Stage
        title="Close-ups"
        caption={sourcePreview ? 'The source to search' : 'The details worth a shot of their own'}
      >
        {pausedBanner ? (
          pausedBanner
        ) : working ? (
          <StageFrame ratio={current ? ratioOf(current.width, current.height) : sourceRatio} dim>
            {sourcePreview && <img src={sourcePreview} alt="The source to search for close-ups" />}
            <StageWorking
              label={
                find.isPending
                  ? 'Starting the search'
                  : current?.status === 'capturing'
                    ? 'Taking frames from the video'
                    : 'Looking for the most cinematic details'
              }
              runKey={current?.id}
            />
          </StageFrame>
        ) : current?.status === 'failed' && current.id === jobId ? (
          <StageEmpty
            title="The search didn't finish"
            hint={current.error ?? 'Try finding close-ups again.'}
            action={
              <Buy items={priceItems}>
                <Button label="Try again" icon={<RotateCcw size={14} />} isDisabled={!ready || spend.blocked} onClick={() => void run()} />
              </Buy>
            }
          />
        ) : sourcePreview ? (
          <StageFrame ratio={sourceRatio}>
            <img src={sourcePreview} alt="The source to search for close-ups" decoding="async" />
          </StageFrame>
        ) : (
          <StageEmpty
            title="Your close-ups will appear here"
            hint="Pick a video, a still or an image, then press Find close-ups."
          />
        )}
      </Stage>
    );
  }

  const strip = showShots ? (
    <TakeStrip
      label="Close-ups"
      items={stripItems}
      value={focusIndex !== null ? String(focusIndex) : null}
      onChange={(id) => id !== null && setFocus(Number(id))}
      ticked={new Set(readyStills.filter((s) => ticked.has(s.id)).map((s) => String(shots.findIndex((sh) => sh.stillId === s.id))))}
      onTick={(id) => {
        const s = shotState(Number(id)).still;
        if (!s) return;
        setTicked((cur) => {
          const next = new Set(cur);
          if (next.has(s.id)) next.delete(s.id);
          else if (next.size < 4) next.add(s.id);
          return next;
        });
      }}
      actions={
        <>
          {ticked.size > 0 && (
            <>
              <Button label="Clear ticks" size="sm" variant="ghost" onClick={() => setTicked(new Set())} />
              <Button
                label={`Compare ${tickedStills.length}`}
                size="sm"
                isDisabled={!compare.ok}
                tooltip={compare.ok ? 'Compare side by side (C)' : compare.why}
                onClick={() => setBoard(true)}
              />
            </>
          )}
          {ticked.size === 0 && <Text type="supporting">Saved to your library, tagged @close-up</Text>}
        </>
      }
    />
  ) : undefined;

  // ---- The controls.
  const found = showShots && current && (
    <BenchGroup title="Found in this search" description="Each detail the app picked, and why. Choose one to see it large.">
      <ul className={own.subjects}>
        {shots.map((shot, i) => {
          const { state } = shotState(i);
          const word = state === 'ready' ? 'Ready' : state === 'failed' ? "Didn't render" : state === 'lost' ? 'Removed' : 'Being shot';
          return (
            <li key={`${current.id}-${i}`}>
              <button
                type="button"
                className={own.subject}
                aria-pressed={focusIndex === i}
                onClick={() => setFocus(i)}
              >
                <span className={own.subjectHead}>
                  <StatusDot
                    variant={state === 'ready' ? 'success' : state === 'failed' ? 'error' : state === 'lost' ? 'warning' : 'accent'}
                    label={word}
                    tooltip={word}
                    isPulsing={state === 'rendering'}
                  />
                  <Text type="label" maxLines={1}>
                    {sentence(shot.subject)}
                  </Text>
                </span>
                {shot.why && (
                  <Text type="supporting" maxLines={2}>
                    {shot.why}
                  </Text>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </BenchGroup>
  );

  const pool = kind === 'clip' ? clips : stills;
  const controls = (
    <>
      {found}
      <BenchGroup title="Source" description="Where to look for close-ups.">
        <SegmentedControl
          label="Look in"
          size="sm"
          layout="fill"
          value={kind}
          onChange={(id: string) => {
            setKind(id as SourceKind);
            setShown(PAGE);
          }}
          isDisabled={working}
        >
          {SOURCES.map((s) => (
            <SegmentedControlItem key={s.id} value={s.id} label={s.name} />
          ))}
        </SegmentedControl>
        {kind === 'upload' ? (
          <>
            <ImageDropZone
              onFile={(f) => void onFile(f)}
              disabled={working || uploading}
              actionLabel={upload ? 'Replace image' : 'Choose an image'}
            >
              {upload ? (
                <figure className={own.source} style={{ aspectRatio: `${upload.width} / ${upload.height}` }}>
                  <img src={upload.src} alt={`Uploaded image: ${upload.name}`} data-dim={uploading || undefined} />
                </figure>
              ) : (
                <div className={own.drop}>
                  <Focus size={18} aria-hidden />
                  <Text type="supporting">Drop a render, a film still or a photo here.</Text>
                </div>
              )}
            </ImageDropZone>
            {uploading && <Note>Uploading the image…</Note>}
            <ErrorNote error={uploadError} />
          </>
        ) : library.isLoading ? (
          <MediaGridSkeleton count={6} density="small" />
        ) : library.error ? (
          <ErrorNote error={library.error} />
        ) : kind === 'clip' && clips.length === 0 ? (
          <EmptyState
            isCompact
            title="No videos yet"
            description="Make a video on the Video screen, or look in a still or an image of your own instead."
            actions={<Button label="Use a still" size="sm" onClick={() => setKind('still')} />}
          />
        ) : kind === 'still' && stills.length === 0 ? (
          <EmptyState
            isCompact
            title="No film stills yet"
            description="Make a still on the Stills screen, or use an image of your own instead."
            actions={<Button label="Go to Stills" size="sm" onClick={onGoToStills} />}
          />
        ) : (
          <div className={own.picker} data-disabled={working || undefined}>
            <MediaGrid
              label={kind === 'clip' ? 'Video to search' : 'Still to search'}
              density="small"
              items={kind === 'clip' ? clipItems : stillItems}
              active={kind === 'clip' ? clipId : stillId}
              onActivate={(id) => {
                if (working) return;
                if (kind === 'clip') setClipId(id);
                else setStillId(id);
              }}
            />
          </div>
        )}
        {kind !== 'upload' && pool.length > shown && (
          <div>
            <Button
              label={`Show ${Math.min(PAGE, pool.length - shown)} more`}
              size="sm"
              variant="ghost"
              onClick={() => setShown((n) => n + PAGE)}
            />
          </div>
        )}
        {kind === 'clip' && <Note>Six frames are taken across the video, and the best moments are picked from them.</Note>}
      </BenchGroup>

      <BenchGroup title="Shots" description="How many close-ups to make, and anything to look for.">
        <OptionSelect
          label="Number of close-ups"
          options={COUNTS}
          value={String(count)}
          onChange={(id) => setCount(Number(id))}
          disabled={working}
          showHint={false}
        />
        <TextInput
          label="Look for"
          isOptional
          value={direction}
          onChange={(v: string) => setDirection(v.slice(0, 400))}
          isDisabled={working}
          placeholder="For example: stone and timber textures, the people at the pool"
          width="100%"
        />
      </BenchGroup>

      <BenchGroup title="Model" description="Shoots each close-up from the frame it was found in.">
        <div className={own.pair}>
          <OptionSelect
            label="Image model"
            options={IMAGE_MODELS}
            value={imageModel}
            onChange={(id) => {
              const m = id as ImageModelId;
              setImageModel(m);
              setResolution(defaultImageResolution(m));
            }}
            disabled={working}
            showHint={false}
          />
          <OptionSelect
            label="Resolution"
            options={imageResolutions(imageModel)}
            value={resolution}
            onChange={setResolution}
            disabled={working || imageResolutions(imageModel).length < 2}
            showHint={false}
          />
        </div>
      </BenchGroup>
    </>
  );

  const foot = (
    <>
      <Buy items={priceItems}>
        <Button
          label={
            working
              ? 'Finding close-ups…'
              : uploading
                ? 'Uploading the image…'
                : ready
                  ? 'Find close-ups'
                  : kind === 'upload'
                    ? 'Upload an image first'
                    : kind === 'clip'
                      ? 'Pick a video first'
                      : 'Pick a still first'
          }
          variant="primary"
          icon={<Focus size={16} />}
          width="100%"
          isLoading={working}
          isDisabled={!ready || spend.blocked}
          onClick={() => void run()}
        />
      </Buy>
      <Note>
        The app looks for the shots, then {imageModelName(imageModel)} makes {count} close-ups. Each picture shows its
        price before you make it.
      </Note>
      <ErrorNote error={stepError} />
    </>
  );

  return (
    <>
      <Workbench
        label="Close-up settings"
        saveId="closeups-controls"
        controls={controls}
        foot={foot}
        stage={
          <div className={own.stageCol}>
            {stage}
            {job.error && (
              <div className={own.pollError}>
                <ErrorNote
                  error={job.error}
                  action={<Button label="Check again" size="sm" variant="ghost" onClick={() => void job.refetch()} />}
                />
              </div>
            )}
          </div>
        }
        strip={strip}
      />
      <CompareBoard
        isOpen={board && compare.ok}
        onClose={() => setBoard(false)}
        items={tickedStills.map((s) => ({
          id: s.id,
          kind: 'still' as const,
          src: stillViewUrl(s.id),
          title: s.closeup?.subject ?? stillCaption(s),
          ratio: ratioOf(s.width, s.height),
        }))}
        pickLabel="Put on the stage"
        onPick={(id) => {
          const i = shots.findIndex((sh) => sh.stillId === id);
          if (i >= 0) setFocus(i);
          setBoard(false);
        }}
      />
    </>
  );
}

/** The finder writes subjects in lower case; a title starts with a capital. */
function sentence(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clipCaption(c: Pick<Clip, 'videoModel' | 'motion' | 'moveStyle' | 'speed'>): string {
  return `${motionLabel(c.motion, c.moveStyle, c.speed)}, ${videoModelName(c.videoModel)}`;
}

function stillCaption(s: Still): string {
  return s.closeup ? `Close-up: ${s.closeup.subject}` : s.direction?.trim() ? s.direction.trim().slice(0, 60) : `${imageModelName(s.imageModel)} still`;
}
