import { Clapperboard, Download, ImagePlus, Library, ListX, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouterType, Still } from '../api.ts';
import {
  defaultVideoSeconds,
  snapVideoSeconds,
  videoDurations,
  videoExtraImageLimit,
  videoExtrasExcludeEnd,
  videoKeyframeLimit,
  videoModelsWith,
  extraImageHandles,
  defaultVideoResolution,
  motionLabel,
  MOTIONS,
  MOVE_STYLES,
  SPEEDS,
  VIDEO_MODELS,
  videoModelName,
  videoResolutionName,
  videoResolutions,
  type MotionId,
  type MoveStyleId,
  type SpeedId,
  type VideoModelId,
} from '../models.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { Banner, Button, IconButton, Skeleton, Switch, Text, TextArea } from './kit.ts';
import { canCompare } from './lib/compare.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { takePreset } from './lib/reuse.ts';
import { stillTitle } from './lib/titles.ts';
import { CompareBoard } from './parts/CompareBoard.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { Stage, StageEmpty, StageFrame, StageWorking } from './parts/Stage.tsx';
import { StarButton, useStar } from './parts/StarButton.tsx';
import { StillPicker } from './parts/StillPicker.tsx';
import { TakeStrip, type TakeState, type TakeStripItem } from './parts/TakeStrip.tsx';
import { useKeys } from './parts/useKeys.ts';
import { BenchGroup, Note, Workbench } from './parts/Workbench.tsx';
import { trpc } from './trpc.ts';
import { FullSize } from './ui/FullSize.tsx';
import { Buy, useSpend } from './ui/Price.tsx';
import {
  duplicateMiddle,
  firstFrameRef,
  frameRef,
  FramesField,
  RefsField,
  useVideoFrames,
} from './VideoFrames.tsx';
import mk from './screens/Make.module.css';

/** Longest extra direction; the server refuses more. */
const DIRECTION_MAX = 600;
/** Ids whose retry can't succeed: stop asking. */
const FINAL_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);
/** Videos rendering at once; past this, wait for one to finish. */
const MAX_IN_FLIGHT = 6;
/** Takes kept in the strip; the oldest finished ones drop off first. */
const MAX_TAKES = 12;
const TAKES_KEY = 'render-to-film:video-takes';

/** One video started from this tab: what it was made with, for the stage. */
type Take = {
  id: string;
  stillId: string;
  model: VideoModelId;
  resolution: string;
  seconds: number;
  /** The shape of the first frame it was made from. */
  ratio: string;
  title: string;
  since: number;
};

function readTakes(): Take[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TAKES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is Take =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Take).id === 'string' &&
        typeof (t as Take).stillId === 'string' &&
        VIDEO_MODELS.some((m) => m.id === (t as Take).model) &&
        typeof (t as Take).since === 'number'
    );
  } catch {
    return [];
  }
}

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

export type VideoPageProps = {
  /** True while the Video tab is on screen; polling slows down when it isn't. */
  active: boolean;
  /** A still picked from the Stills tab ("Make a video"). */
  pickedStillId: string | null;
  onPick: (stillId: string | null) => void;
  /** Go back to the Stills screen, when there are no stills yet. */
  onGoToStills: () => void;
  /** Open the Library, where every clip is kept. */
  onGoToLibrary: () => void;
};

export function VideoPage({ active, pickedStillId, onPick, onGoToStills, onGoToLibrary }: VideoPageProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    // Only while this tab is on screen; the clip being made polls itself below.
    refetchInterval: (q) =>
      active &&
      (q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 10_000
        : false,
  });

  const [videoModel, setVideoModel] = useState<VideoModelId>('seedance-2');
  const [resolution, setResolution] = useState(defaultVideoResolution('seedance-2'));
  const [motion, setMotion] = useState<MotionId>('push-in');
  const [moveStyle, setMoveStyle] = useState<MoveStyleId>('steady');
  const [speed, setSpeed] = useState<SpeedId>('slow');
  const [seconds, setSeconds] = useState(defaultVideoSeconds('seedance-2'));
  const [direction, setDirection] = useState('');
  const [onlyInImage, setOnlyInImage] = useState(true);
  /** The still picker is open. */
  const [choosing, setChoosing] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  /** Every video started here, newest first; each polls on its own. */
  const [takes, setTakes] = useState<Take[]>(readTakes);
  /** The take on the big screen, or null for the shot being set up. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [board, setBoard] = useState(false);
  const [fullView, setFullView] = useState(false);

  const frames = useVideoFrames();
  const createVideo = trpc.createVideo.useMutation();
  const statuses = trpc.useQueries((t) =>
    takes.map((take) =>
      t.videoStatus(
        { id: take.id },
        {
          refetchInterval: (q) =>
            q.state.data?.done || FINAL_CODES.has(errorCode(q.state.error) ?? '')
              ? false
              : active
                ? 4000
                : 15_000,
          refetchOnWindowFocus: false,
          retry: 2,
        }
      )
    )
  );
  const doneKey = takes
    .filter((_, i) => statuses[i]?.data?.done)
    .map((t) => t.id)
    .join(',');
  useEffect(() => {
    // The library now has these takes; the other tabs' lists should show them.
    if (doneKey) void utils.library.invalidate();
  }, [doneKey, utils]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAKES_KEY, JSON.stringify(takes));
    } catch {
      // Private mode: the strip just won't survive a reload.
    }
  }, [takes]);

  const stills = useMemo(
    () => (library.data?.stills ?? []).filter((s) => s.status === 'succeeded'),
    [library.data]
  );
  const selected = stills.find((s) => s.id === pickedStillId) ?? null;
  // A take is in flight until a final status arrives: a failed poll never
  // frees its slot, or "Check again" would turn into a second bill.
  const takeStates: TakeState[] = takes.map((_, i) => {
    const q = statuses[i];
    if (q?.data?.done) return q.data.url ? 'ready' : 'failed';
    if (q?.error) return 'lost';
    return q?.data?.status === 'PENDING' ? 'queued' : 'rendering';
  });
  const inFlight = takeStates.filter((st) => st !== 'ready' && st !== 'failed').length;
  const full = inFlight >= MAX_IN_FLIGHT;
  const focusIndex = focusId ? takes.findIndex((t) => t.id === focusId) : -1;
  const focus = focusIndex >= 0 ? takes[focusIndex]! : null;
  const focusStatus = focusIndex >= 0 ? statuses[focusIndex] : undefined;
  const focusState = focusIndex >= 0 ? takeStates[focusIndex] : undefined;
  const shownError = createVideo.error;
  const { planBlocked, unavailable } = classifyRunwayError(shownError);
  const priceItems = [{ preset: videoModel, seconds, resolution }];
  const spend = useSpend(priceItems);

  useEffect(() => {
    // A new pick puts the shot being set up on the big screen; the takes keep
    // rendering in the strip.
    setFocusId(null);
  }, [pickedStillId]);

  function dropTake(id: string) {
    setTakes((prev) => prev.filter((t) => t.id !== id));
    setFocusId((f) => (f === id ? null : f));
  }

  function clearFinished() {
    const keep = new Set(
      takes.filter((t, i) => takeStates[i] !== 'ready' && takeStates[i] !== 'failed').map((t) => t.id)
    );
    setTakes((prev) => prev.filter((t) => keep.has(t.id)));
    setFocusId((f) => (f && keep.has(f) ? f : null));
  }

  // The first frame decides the clip's shape: an upload's own size, a chosen
  // still's, or else the still picked in step 1.
  const firstShape = (() => {
    const f = frames.first;
    if (f?.width && f.height) return { width: f.width, height: f.height };
    const own = f?.stillId ? stills.find((x) => x.id === f.stillId) : undefined;
    return own ?? selected;
  })();
  const previewRatio = frameRatio(firstShape);

  const cameraTravels = motion !== 'still-life' && motion !== 'focus-pull';

  // What the chosen model can take from the frames and extra-images areas.
  const keyframeLimit = videoKeyframeLimit(videoModel);
  const extraLimit = videoExtraImageLimit(videoModel);
  const extrasUsed = extraLimit > 0 ? frames.refs.slice(0, extraLimit) : [];
  const exclusive = videoExtrasExcludeEnd(videoModel);
  // Seedance and MiniMax H3 take a last frame or extra images, not both: a
  // last frame that is set wins and the extras wait until it is removed.
  const lastSent = keyframeLimit >= 2 ? frames.last : null;
  const extrasBlocked = exclusive && lastSent !== null;
  const lastBlocked = exclusive && extrasUsed.length > 0 && lastSent === null;
  const middleSent = frames.middle.slice(0, Math.max(0, keyframeLimit - 2));
  const refsSent = extrasBlocked ? [] : extrasUsed;
  const handleProblem = unknownHandle(direction, refsSent.length, videoModelName(videoModel));
  const directionTooLong = direction.length > DIRECTION_MAX;
  const duplicateFrames = duplicateMiddle(middleSent).size > 0;

  function insertHandle(handle: string) {
    setDirection((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${handle} `);
  }

  async function run() {
    if (!selected || handleProblem || directionTooLong || duplicateFrames || full) return;
    try {
      const refs = refsSent.map(frameRef);
      const middle = middleSent.map((m) => {
        const r = frameRef(m);
        return r ? { ...r, at: m.at } : null;
      });
      const first = frames.first ? firstFrameRef(frames.first) : null;
      const last = lastSent ? frameRef(lastSent) : null;
      if (
        refs.some((r) => r === null) ||
        middle.some((m) => m === null) ||
        (frames.first && !first) ||
        (lastSent && !last)
      ) {
        return;
      }
      const { id } = await createVideo.mutateAsync({
        stillId: selected.id,
        videoModel,
        resolution,
        motion,
        moveStyle,
        speed,
        seconds,
        direction,
        onlyInImage,
        ...(first ? { firstFrame: first } : {}),
        ...(last ? { lastFrame: last } : {}),
        ...(middle.length ? { middleFrames: middle.filter((m) => m !== null) } : {}),
        ...(refs.length ? { refs: refs.filter((r) => r !== null) } : {}),
      });
      const take: Take = {
        id,
        stillId: selected.id,
        model: videoModel,
        resolution,
        seconds,
        ratio: previewRatio,
        title: `${MOTIONS.find((m) => m.id === motion)?.name ?? 'Shot'}, ${videoModelName(videoModel)}`,
        since: Date.now(),
      };
      setTakes((prev) => {
        const next = [take, ...prev];
        if (next.length <= MAX_TAKES) return next;
        // Over the cap: drop the oldest finished take, never one still rendering.
        const states = new Map(takes.map((t, i) => [t.id, takeStates[i]]));
        const oldDone = [...next]
          .reverse()
          .find((t) => states.get(t.id) === 'ready' || states.get(t.id) === 'failed');
        return oldDone ? next.filter((t) => t !== oldDone) : next;
      });
      setFocusId(id);
    } catch {
      // Shown by RunwayErrorNotice from createVideo.error.
    }
  }

  const stripItems: TakeStripItem[] = takes.map((t, i) => ({
    id: t.id,
    kind: 'clip',
    thumb: stillThumbUrl(t.stillId),
    title: t.title,
    state: takeStates[i]!,
    ratio: ratioNumber(t.ratio),
    progress: statuses[i]?.data?.progress,
    since: t.since,
  }));
  const readyCount = takeStates.filter((st) => st === 'ready' || st === 'failed').length;
  const durations = videoDurations(videoModel);
  const secondsOptions = durations.map((s) => ({ id: String(s), name: `${s} seconds` }));

  // A clip preset from History or the Library fills the form; nothing is sent until the priced button.
  useEffect(() => {
    if (!active) return;
    const p = takePreset('clip');
    if (!p) return;
    if (p.videoModel) {
      const m = p.videoModel as VideoModelId;
      setVideoModel(m);
      setResolution(p.resolution ?? defaultVideoResolution(m));
      setSeconds(p.seconds ?? defaultVideoSeconds(m));
      createVideo.reset();
    }
    if (p.motion) setMotion(p.motion as MotionId);
    if (p.moveStyle) setMoveStyle(p.moveStyle as MoveStyleId);
    if (p.speed) setSpeed(p.speed as SpeedId);
    if (p.direction !== undefined) setDirection(p.direction);
    if (p.stillId) onPick(p.stillId);
    setFocusId(null);
  }, [active]);

  const star = useStar();
  const tickedTakes = takes.filter((t, i) => ticked.has(t.id) && takeStates[i] === 'ready');
  const compare = canCompare(tickedTakes.map(() => ({ kind: 'clip' as const })));
  const toggleTick = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  const order: Array<string | null> = [null, ...takes.map((t) => t.id)];
  const step = (by: number) => {
    const at = order.indexOf(focus ? focus.id : null);
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next !== undefined) setFocusId(next);
  };
  const focusReady = focusState === 'ready';
  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => step(-1) },
      { key: 'ArrowRight', onKey: () => step(1) },
      { key: 's', onKey: () => focus && star.toggle('clip', focus.id), disabled: !focusReady },
      { key: 'c', onKey: () => setBoard(true), disabled: !compare.ok },
      { key: 'f', onKey: () => setFullView(true), disabled: !focusReady },
    ],
    active
  );

  const motionWords = (cameraTravels
    ? motionLabel(motion, moveStyle, speed)
    : motionLabel(motion, moveStyle === 'handheld' ? moveStyle : undefined)
  ).toLowerCase();

  const controls = (
    <>
      <BenchGroup
        title="Film still"
        description="The still the shot starts on, from the takes you made on Stills."
      >
        {library.isLoading ? (
          <div className={mk.picked}>
            <Skeleton height={63} />
            <div className={mk.pickedBody}>
              <Skeleton height={12} width="80%" />
              <Skeleton height={12} width="50%" index={1} />
            </div>
          </div>
        ) : library.error && !library.data ? (
          <ErrorNote
            error={library.error}
            action={<Button label="Try again" size="sm" onClick={() => void library.refetch()} />}
          />
        ) : stills.length === 0 ? (
          <>
            <Note>No film stills yet. Make a still on Stills first; every finished take shows up here.</Note>
            <div>
              <Button label="Go to Stills" size="sm" onClick={onGoToStills} />
            </div>
          </>
        ) : selected ? (
          <div className={mk.picked}>
            <figure className={mk.source} style={{ aspectRatio: `${selected.width} / ${selected.height}` }}>
              <img src={stillThumbUrl(selected.id)} alt={`Selected still: ${stillTitle(selected)}`} />
            </figure>
            <div className={mk.pickedBody}>
              <Text type="label" maxLines={2}>
                {stillTitle(selected)}
              </Text>
              <div className={mk.row}>
                <Button label="Change" size="sm" variant="secondary" icon={<ImagePlus size={14} />} onClick={() => setChoosing(true)} />
                <FullSize
                  src={stillViewUrl(selected.id)}
                  kind="still"
                  title={stillTitle(selected)}
                  alt={`Selected still: ${stillTitle(selected)}`}
                  iconOnly
                />
                <IconButton
                  label="Remove from the library"
                  tooltip="Remove from the library"
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={16} />}
                  isDisabled={takes.some(
                    (t, i) => t.stillId === selected.id && takeStates[i] !== 'ready' && takeStates[i] !== 'failed'
                  )}
                  onClick={() => setDeleting({ kind: 'still', id: selected.id, title: stillTitle(selected) })}
                />
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Button label="Choose a still" icon={<ImagePlus size={16} />} onClick={() => setChoosing(true)} />
          </div>
        )}
      </BenchGroup>

      <Switch
        label="Only what's in the image"
        description={
          onlyInImage
            ? 'Nothing new appears: no added objects, people or places beyond the frame.'
            : "Off: the model may add or reveal things the image doesn't show."
        }
        value={onlyInImage}
        onChange={setOnlyInImage}
      />

      <BenchGroup
        title="Model"
        description="Every model starts on your still as the first frame unless you choose another under Frames."
      >
        <OptionSelect
          label="Video model"
          options={VIDEO_MODELS}
          value={videoModel}
          onChange={(id) => {
            const next = id as VideoModelId;
            setVideoModel(next);
            setResolution(defaultVideoResolution(next));
            // Keep the chosen length when the new model can run it.
            setSeconds((s) => snapVideoSeconds(next, s));
            createVideo.reset();
          }}
        />
        <div className={mk.pair}>
          <OptionSelect
            label="Resolution"
            options={videoResolutions(videoModel)}
            value={resolution}
            onChange={setResolution}
            disabled={videoResolutions(videoModel).length < 2}
            showHint={false}
          />
          <OptionSelect
            label="Length"
            options={secondsOptions}
            value={String(seconds)}
            onChange={(id) => setSeconds(Number(id))}
            disabled={durations.length < 2}
            showHint={false}
          />
        </div>
        <Note>
          {videoModelName(videoModel)} runs {durations[0]} to {durations[durations.length - 1]} seconds. Longer clips cost more.
        </Note>
      </BenchGroup>

      <BenchGroup
        title="Frames"
        description="Optional. The shot starts on your still; add a first, in-between or last frame only if you need one."
      >
        <FramesField
          frames={frames}
          modelName={videoModelName(videoModel)}
          limit={keyframeLimit}
          seconds={seconds}
          picked={selected ? { src: stillThumbUrl(selected.id), name: stillTitle(selected) } : null}
          stills={stills}
          endModels={videoModelsWith('end')}
          middleModels={videoModelsWith('middle')}
          lastBlockedByExtras={lastBlocked}
          disabled={false}
        />
      </BenchGroup>

      <BenchGroup title="Camera" description="Short moves only, so nothing outside the still has to be invented.">
        <OptionSelect label="Camera move" options={MOTIONS} value={motion} onChange={(id) => setMotion(id as MotionId)} />
        <div className={mk.pair}>
          <OptionSelect
            label="Movement style"
            options={MOVE_STYLES}
            value={moveStyle}
            onChange={(id) => setMoveStyle(id as MoveStyleId)}
            showHint={false}
          />
          <OptionSelect
            label="Speed"
            options={SPEEDS}
            value={speed}
            onChange={(id) => setSpeed(id as SpeedId)}
            disabled={!cameraTravels}
            disabledMessage="The camera holds its position, so speed doesn't apply."
            showHint={false}
          />
        </div>
        {!cameraTravels && (
          <Note>
            The camera holds its position, so speed doesn&rsquo;t apply
            {moveStyle === 'handheld' ? '; handheld adds a slight natural sway' : ''}.
          </Note>
        )}
      </BenchGroup>

      <BenchGroup
        title="Extra images"
        description="Optional. Add pictures of things to bring into the shot; each is named @img1, @img2 and so on."
      >
        <RefsField
          frames={frames}
          modelName={videoModelName(videoModel)}
          limit={extraLimit}
          stills={stills}
          extraModels={videoModelsWith('extra')}
          blockedReason={
            extrasBlocked
              ? `${videoModelName(videoModel)} can use a last frame or extra images, not both. Remove the last frame to add extra images.`
              : undefined
          }
          disabled={false}
          onInsert={insertHandle}
        />
      </BenchGroup>

      <BenchGroup title="Extra direction" description="Optional. What should move, and how.">
        <TextArea
          label="Extra video direction"
          isLabelHidden
          value={direction}
          onChange={setDirection}
          rows={3}
          maxLength={DIRECTION_MAX}
          placeholder="For example: the couple walks slowly toward the water wall, leaves drift across the pool"
          width="100%"
        />
        <Note>
          {refsSent.length > 0
            ? `Name your extra images in the direction, for example "use the bench from @img2". You have @img1 to @img${refsSent.length}.`
            : 'With extra images added, you can name them here, for example "use the bench from @img2".'}
        </Note>
        {directionTooLong && (
          <Banner
            status="error"
            title="Your direction is too long"
            description={`Shorten it by ${direction.length - DIRECTION_MAX} characters to make the video.`}
          />
        )}
        {handleProblem && (
          <Banner status="error" title="Check the image names in your direction" description={handleProblem} />
        )}
      </BenchGroup>
    </>
  );

  const foot = (
    <>
      <Buy items={priceItems}>
        <Button
          label={
            createVideo.isPending
              ? 'Starting…'
              : full
                ? `${MAX_IN_FLIGHT} videos rendering`
                : duplicateFrames
                  ? 'Move frames that share a point'
                  : frames.uploading
                    ? 'Uploading images…'
                    : !selected
                      ? 'Pick a still first'
                      : inFlight > 0
                        ? 'Make another video'
                        : 'Make the video'
          }
          variant="primary"
          icon={<Clapperboard size={16} />}
          width="100%"
          isLoading={createVideo.isPending}
          isDisabled={
            createVideo.isPending ||
            spend.blocked ||
            full ||
            !selected ||
            frames.uploading ||
            handleProblem !== undefined ||
            directionTooLong ||
            duplicateFrames ||
            planBlocked ||
            unavailable
          }
          onClick={() => void run()}
        />
      </Buy>
      <Note>
        {videoModelName(videoModel)} at {videoResolutionName(videoModel, resolution)}, {seconds} seconds, {motionWords}. Each
        video shows its price before you make it.
      </Note>
      <p className={mk.queue} role="status" aria-live="polite">
        {full
          ? `${MAX_IN_FLIGHT} videos are rendering. You can start another as soon as one finishes.`
          : inFlight > 0
            ? `${inFlight} video${inFlight === 1 ? '' : 's'} rendering. Change anything and start the next one; each take keeps its own settings.`
            : ''}
      </p>
      <ErrorNote error={shownError} />
    </>
  );

  const setupSrc = selected
    ? frames.first
      ? frames.first.stillId
        ? stillViewUrl(frames.first.stillId)
        : frames.first.src
      : stillViewUrl(selected.id)
    : undefined;
  const stage =
    focus && focusStatus ? (
      <TakeStage
        key={focus.id}
        take={focus}
        status={focusStatus}
        state={focusState!}
        onDismiss={() => dropTake(focus.id)}
        full={fullView}
        onFull={setFullView}
      />
    ) : (
      <Stage
        title={selected ? 'Next shot' : 'Bring a still to life'}
        caption={
          selected
            ? `${frames.first ? `Starts on ${frames.first.name}` : stillTitle(selected)}, ${motionWords}, ${seconds} seconds`
            : 'Water, leaves and people move; the architecture stays exactly as it is.'
        }
      >
        <StageFrame ratio={ratioNumber(previewRatio)}>
          {setupSrc ? (
            <img
              src={setupSrc}
              alt={frames.first ? `First frame: ${frames.first.name}` : `Selected still: ${stillTitle(selected!)}`}
            />
          ) : (
            <StageEmpty
              title={stills.length === 0 ? 'Make a still first' : 'Pick a still to animate'}
              hint={
                stills.length === 0
                  ? 'Every finished take on Stills can be animated here.'
                  : 'Choose a still, a model and a camera move, then press Make the video.'
              }
              action={
                stills.length === 0 ? (
                  <Button label="Go to Stills" onClick={onGoToStills} />
                ) : (
                  <Button label="Choose a still" icon={<ImagePlus size={16} />} onClick={() => setChoosing(true)} />
                )
              }
            />
          )}
        </StageFrame>
      </Stage>
    );

  const strip =
    takes.length > 0 ? (
      <TakeStrip
        label="Takes"
        items={stripItems}
        value={focus ? focus.id : null}
        onChange={setFocusId}
        next={{
          thumb: selected ? stillThumbUrl(selected.id) : undefined,
          title: selected ? stillTitle(selected) : 'Pick a still',
          ratio: selected ? selected.width / selected.height : undefined,
        }}
        ticked={ticked}
        onTick={toggleTick}
        actions={
          <>
            {ticked.size > 0 && (
              <Button
                label={`Compare ${tickedTakes.length}`}
                size="sm"
                isDisabled={!compare.ok}
                tooltip={compare.ok ? 'Play both side by side (C)' : compare.why}
                onClick={() => setBoard(true)}
              />
            )}
            {readyCount > 0 && (
              <Button label="Clear finished" size="sm" variant="ghost" icon={<ListX size={14} />} onClick={clearFinished} />
            )}
            <Button label="Every clip" size="sm" variant="ghost" icon={<Library size={14} />} tooltip="Every clip you made is in the Library" onClick={onGoToLibrary} />
          </>
        }
      />
    ) : undefined;

  return (
    <>
      <Workbench label="Video settings" saveId="video-controls" controls={controls} foot={foot} stage={stage} strip={strip} />
      <StillPicker
        isOpen={choosing}
        title="Choose the still to animate"
        stills={stills}
        value={selected?.id ?? null}
        onPick={(s: Still) => {
          onPick(s.id);
          setChoosing(false);
        }}
        onClose={() => setChoosing(false)}
      />
      <CompareBoard
        isOpen={board && compare.ok}
        onClose={() => setBoard(false)}
        items={tickedTakes.map((t) => ({
          id: t.id,
          kind: 'clip' as const,
          src: libraryUrl('clip', t.id),
          poster: stillThumbUrl(t.stillId),
          title: t.title,
          detail: `${t.seconds} seconds`,
          ratio: ratioNumber(t.ratio),
        }))}
        pickLabel="Put on the stage"
        onPick={(id) => {
          setFocusId(id);
          setBoard(false);
        }}
      />
      <DeleteItemDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(t) => {
          if (t.kind === 'still' && t.id === pickedStillId) onPick(null);
          if (t.kind === 'clip') dropTake(t.id);
        }}
      />
    </>
  );
}

/** The slice of a take's status query the stage reads. */
type StatusQuery = {
  data?: inferRouterOutputs<AppRouterType>['videoStatus'] | undefined;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

/** One take on the stage: rendering, the finished clip with its actions, or why it didn't render. */
function TakeStage({
  take,
  status,
  state,
  onDismiss,
  full,
  onFull,
}: {
  take: Take;
  status: StatusQuery;
  state: TakeState;
  onDismiss: () => void;
  full: boolean;
  onFull: (open: boolean) => void;
}) {
  const saver = useDownload();
  const url = libraryUrl('clip', take.id);
  const pollFinal = FINAL_CODES.has(errorCode(status.error) ?? '');
  const special = status.error ? classifyRunwayError(status.error) : null;
  const caption = `${take.title}${
    videoResolutionName(take.model, take.resolution) ? ` at ${videoResolutionName(take.model, take.resolution)}` : ''
  }, ${take.seconds} seconds`;
  const working = state === 'rendering' || state === 'queued';

  return (
    <Stage
      title={state === 'ready' ? 'Video' : working ? 'Being made' : state === 'lost' ? 'Lost touch' : "Didn't render"}
      caption={caption}
      actions={
        state === 'ready' ? (
          <>
            <FullSize src={url} kind="clip" title={take.title} alt={`Video: ${take.title}`} iconOnly isOpen={full} onOpenChange={onFull} />
            <StarButton kind="clip" id={take.id} />
            <IconButton
              label={saver.pending ? saver.label('Download') : 'Download'}
              tooltip={saver.pending ? saver.label('Download') : 'Download'}
              size="sm"
              variant="ghost"
              isLoading={saver.pending}
              icon={<Download size={16} />}
              onClick={() => saver.start(url, `film-clip-${take.model}.mp4`)}
            />
          </>
        ) : state === 'failed' ? (
          <Button label="Remove from takes" size="sm" variant="ghost" onClick={onDismiss} />
        ) : undefined
      }
      below={
        <>
          {saver.error && <Banner status="error" title="Download failed" description={saver.error} />}
          {state === 'lost' && (
            <Banner
              status="error"
              title="We lost touch with this video"
              description={
                pollFinal
                  ? `${special?.message ?? 'The engine could not find it.'} It may still appear in the Library.`
                  : `${special?.message ?? 'The check failed.'} It may still be rendering, so check again.`
              }
              endContent={
                <span className={mk.row}>
                  <Button label="Check again" size="sm" isLoading={status.isFetching} onClick={() => void status.refetch()} />
                  {pollFinal && <Button label="Stop waiting" size="sm" variant="ghost" onClick={onDismiss} />}
                </span>
              }
            />
          )}
          {state === 'failed' && (
            <Banner
              status="error"
              title="This video didn't render"
              description={status.data?.error ?? 'The video did not render. Try again.'}
            />
          )}
          {working && (
            <Text type="supporting" as="p">
              Keep working: set up the next shot and it renders alongside this one.
            </Text>
          )}
        </>
      }
    >
      <StageFrame ratio={ratioNumber(take.ratio)} dim={state !== 'ready'}>
        {state === 'ready' ? (
          <video
            src={url}
            poster={stillThumbUrl(take.stillId)}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`Video: ${take.title}`}
          />
        ) : (
          <>
            <img src={stillViewUrl(take.stillId)} alt="" />
            {working && (
              <StageWorking
                label={state === 'queued' ? 'Waiting for a camera' : 'Rolling camera. Video usually takes one to a few minutes'}
                progress={status.data?.progress}
                runKey={take.id}
                since={take.since}
              />
            )}
          </>
        )}
      </StageFrame>
    </Stage>
  );
}

/** An @imgN in the direction that the clip won't have, in words. */
function unknownHandle(direction: string, sent: number, model: string): string | undefined {
  const used = extraImageHandles(direction);
  if (used.length === 0) return undefined;
  if (sent === 0) {
    return `Your direction mentions @img${used[0]}, but no extra images will be sent with ${model}. Add an image, or remove the name.`;
  }
  const bad = used.find((n) => n < 1 || n > sent);
  return bad === undefined
    ? undefined
    : `Your direction mentions @img${bad}, but you only have @img1 to @img${sent}.`;
}

function frameRatio(s: { width: number; height: number } | null): string {
  return s ? `${s.width} / ${s.height}` : '16 / 9';
}

/** "2560 / 1440" as a number, width over height. */
function ratioNumber(frame: string): number {
  const [w, h] = frame.split('/').map((n) => Number(n.trim()));
  return w && h ? w / h : 16 / 9;
}
