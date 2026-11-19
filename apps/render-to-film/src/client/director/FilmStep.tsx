import { Clapperboard, Film, Scissors } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import type { Clip, Still } from '../../api.ts';
import {
  defaultVideoResolution,
  defaultVideoSeconds,
  MOTIONS,
  type MotionId,
  MOVE_STYLES,
  type MoveStyleId,
  snapVideoSeconds,
  SPEEDS,
  type SpeedId,
  VIDEO_MODELS,
  videoDurations,
  type VideoModelId,
  videoModelName,
  videoResolutions,
} from '../../models.ts';
import type { FramePlan, StoryboardJob } from '../../storyboard-api.ts';
import { Banner, Button, EmptyState, StatusDot, Switch, Text, TextArea } from '../kit.ts';
import { libraryUrl, stillThumbUrl } from '../lib/download.ts';
import { ErrorNote } from '../parts/ErrorNote.tsx';
import { OptionSelect } from '../parts/OptionSelect.tsx';
import { StageWorking } from '../parts/Stage.tsx';
import { StarButton } from '../parts/StarButton.tsx';
import { BenchGroup, Note } from '../parts/Workbench.tsx';
import { trpc } from '../trpc.ts';
import { Buy, SpendNote, useSpend } from '../ui/Price.tsx';
import own from '../DirectorPage.module.css';
import { ratioOf } from './shared.ts';

const DIRECTION_MAX = 600;

type FilmSettings = {
  videoModel: VideoModelId;
  resolution: string;
  seconds: number;
  moveStyle: MoveStyleId;
  speed: SpeedId;
  direction: string;
  onlyInImage: boolean;
  archviz: boolean;
  /** A camera move per frame (its image index); unset frames use the suggested move. */
  moves: Record<number, MotionId>;
};

function defaults(): FilmSettings {
  return {
    videoModel: 'seedance-2',
    resolution: defaultVideoResolution('seedance-2'),
    seconds: defaultVideoSeconds('seedance-2'),
    moveStyle: 'steady',
    speed: 'slow',
    direction: '',
    onlyInImage: true,
    archviz: true,
    moves: {},
  };
}

const settingsKey = (jobId: string) => `render-to-film:film:${jobId}`;

/** The saved film settings of a storyboard, checked against what this version offers. */
function readSettings(jobId: string): FilmSettings {
  if (!jobId) return defaults();
  try {
    const raw = localStorage.getItem(settingsKey(jobId));
    if (raw) {
      const d = defaults();
      const saved = { ...d, ...(JSON.parse(raw) as Partial<FilmSettings>) };
      if (VIDEO_MODELS.some((m) => m.id === saved.videoModel)) {
        // Anything an older version saved that this one no longer offers
        // falls back to the default, so no clip is refused for it.
        const moves: Record<number, MotionId> = {};
        if (saved.moves && typeof saved.moves === 'object') {
          for (const [k, v] of Object.entries(saved.moves)) {
            if (MOTIONS.some((m) => m.id === v)) moves[Number(k)] = v;
          }
        }
        return {
          ...saved,
          resolution: typeof saved.resolution === 'string' ? saved.resolution : d.resolution,
          seconds: typeof saved.seconds === 'number' ? saved.seconds : d.seconds,
          moveStyle: MOVE_STYLES.some((m) => m.id === saved.moveStyle) ? saved.moveStyle : d.moveStyle,
          speed: SPEEDS.some((m) => m.id === saved.speed) ? saved.speed : d.speed,
          direction: typeof saved.direction === 'string' ? saved.direction.slice(0, DIRECTION_MAX) : '',
          onlyInImage: typeof saved.onlyInImage === 'boolean' ? saved.onlyInImage : d.onlyInImage,
          archviz: typeof saved.archviz === 'boolean' ? saved.archviz : d.archviz,
          moves,
        };
      }
    }
  } catch {
    // Unreadable or private mode: start from the defaults.
  }
  return defaults();
}

/** The film settings for a storyboard, kept in this browser so a reload keeps them. */
function useFilmSettings(jobId: string) {
  const [state, setState] = useState(() => ({ jobId, settings: readSettings(jobId) }));
  // A new storyboard brings its own settings.
  const settings = state.jobId === jobId ? state.settings : readSettings(jobId);
  if (state.jobId !== jobId) setState({ jobId, settings });
  useEffect(() => {
    if (!state.jobId) return;
    try {
      localStorage.setItem(settingsKey(state.jobId), JSON.stringify(state.settings));
    } catch {
      // Private mode: the settings just won't survive a reload.
    }
  }, [state]);
  const set = (patch: Partial<FilmSettings>) =>
    setState((prev) => (prev.jobId === jobId ? { jobId, settings: { ...prev.settings, ...patch } } : prev));
  return [settings, set] as const;
}

/**
 * A move that suits the frame's place in the story: the film opens by
 * pulling back to reveal, interiors push gently in, exteriors drift
 * sideways (alternating, so cuts don't repeat), and the last frame rises
 * away.
 */
export function suggestedMove(frame: FramePlan, order: number, count: number): MotionId {
  if (count > 1 && order === 1) return 'pull-out';
  if (count > 2 && order === count) return frame.space === 'interior' ? 'pull-out' : 'crane-up';
  if (frame.space === 'interior') return 'push-in';
  return order % 2 === 0 ? 'drift-left' : 'drift-right';
}

export type FilmInput = {
  job: StoryboardJob | undefined;
  frames: readonly FramePlan[];
  /** Each frame's take (the picked one, else the newest). */
  takes: ReadonlyMap<number, Still>;
  /** Frames chosen for the film. */
  chosen: ReadonlySet<number>;
  clips: readonly Clip[];
  onMade: () => Promise<unknown>;
};

/**
 * The Director's film step: the chosen frames, shot as clips in story order. Held by the page
 * for as long as the storyboard is open, so a run of clips keeps its place (and its button
 * stays held) while the owner looks at a frame.
 */
export function useFilm({ job, frames, takes, chosen, clips, onMade }: FilmInput) {
  const utils = trpc.useUtils();
  const [s, set] = useFilmSettings(job?.id ?? '');
  const [making, setMaking] = useState<number | null>(null);
  /** The frames the running batch makes, for its "clip N of M" count. */
  const [batch, setBatch] = useState<readonly number[]>([]);
  const [errors, setErrors] = useState<Record<number, unknown>>({});
  const [batchError, setBatchError] = useState<unknown>(null);

  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  /** Each frame's newest clip of its current take that is still in the
   * library; a reshoot or a new pick needs a new clip. */
  const clipFor = useMemo(() => {
    const out = new Map<number, Clip>();
    for (const c of job?.clips ?? []) {
      if (out.has(c.image)) continue;
      const clip = clipById.get(c.clipId);
      if (clip && clip.stillId === takes.get(c.image)?.id) out.set(c.image, clip);
    }
    return out;
  }, [job?.clips, clipById, takes]);

  const ordered = frames.map((f, i) => ({ frame: f, order: i + 1 }));
  const film = ordered.filter(({ frame }) => chosen.has(frame.image) && takes.get(frame.image)?.status === 'succeeded');
  const durations = videoDurations(s.videoModel);
  const resolutions = videoResolutions(s.videoModel);
  const resolution = resolutions.some((r) => r.id === s.resolution) ? s.resolution : defaultVideoResolution(s.videoModel);
  const seconds = snapVideoSeconds(s.videoModel, s.seconds);
  const moveOf = (frame: FramePlan, order: number) => s.moves[frame.image] ?? suggestedMove(frame, order, frames.length);
  const busy = making !== null;
  const madeAny = film.some(({ frame }) => clipFor.has(frame.image));
  const rendering = film.filter(({ frame }) => clipFor.get(frame.image)?.status === 'pending').length;
  const missing = film.filter(({ frame }) => {
    const c = clipFor.get(frame.image);
    return !c || c.status === 'failed';
  });

  // A clip is one buy; the gate (allowance, model ready) is the same for all of them.
  const clipItems = [{ preset: s.videoModel, seconds, resolution, count: missing.length }];
  const oneClip = [{ preset: s.videoModel, seconds, resolution }];
  const spend = useSpend(clipItems);

  async function make(list: typeof film) {
    if (!job) return;
    setBatchError(null);
    setBatch(list.map(({ frame }) => frame.image));
    for (const { frame, order } of list) {
      const take = takes.get(frame.image);
      if (!take) continue;
      setMaking(frame.image);
      setErrors((e) => ({ ...e, [frame.image]: undefined }));
      try {
        const move = moveOf(frame, order);
        const { id } = await utils.client.createVideo.mutate({
          stillId: take.id,
          videoModel: s.videoModel,
          resolution,
          motion: move,
          moveStyle: s.moveStyle,
          speed: s.speed,
          seconds,
          direction: s.direction,
          onlyInImage: s.onlyInImage,
          archviz: s.archviz,
        });
        await utils.client.storyboard.recordClip.mutate({ id: job.id, image: frame.image, clipId: id });
        await onMade();
      } catch (error) {
        // A refusal (no allowance left, a model that is not ready) stops the run
        // (the next frame would fail the same way) and shows once, under the button.
        const code = (error as { data?: { code?: string } } | null)?.data?.code;
        if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
          setBatchError(error);
          break;
        }
        setErrors((e) => ({ ...e, [frame.image]: error }));
      }
    }
    setMaking(null);
  }

  const anyTravel = film.some(({ frame, order }) => {
    const m = moveOf(frame, order);
    return m !== 'still-life' && m !== 'focus-pull';
  });

  return {
    s,
    set,
    takes,
    film,
    clipFor,
    durations,
    resolutions,
    resolution,
    seconds,
    moveOf,
    busy,
    making,
    batch,
    madeAny,
    rendering,
    missing,
    clipItems,
    oneClip,
    spend,
    make,
    errors,
    batchError,
    anyTravel,
  };
}

export type Film = ReturnType<typeof useFilm>;

/** The film's settings, in the controls panel: the same camera presets as the Video screen. */
export function FilmControls({ film }: { film: Film }) {
  const { s, set, busy, durations, resolutions, resolution, seconds, anyTravel } = film;
  const secondsOptions = durations.map((n) => ({ id: String(n), name: `${n} seconds` }));
  return (
    <>
      <BenchGroup title="Model" description="Which model turns each chosen frame into a clip.">
        <OptionSelect
          label="Video model"
          options={VIDEO_MODELS}
          value={s.videoModel}
          onChange={(id) => {
            const m = id as VideoModelId;
            set({ videoModel: m, resolution: defaultVideoResolution(m), seconds: snapVideoSeconds(m, s.seconds) });
          }}
          disabled={busy}
        />
        <div className={own.pair}>
          <OptionSelect
            label="Resolution"
            options={resolutions}
            value={resolution}
            onChange={(r) => set({ resolution: r })}
            disabled={busy || resolutions.length < 2}
            showHint={false}
          />
          <OptionSelect
            label="Clip length"
            options={secondsOptions}
            value={String(seconds)}
            onChange={(id) => set({ seconds: Number(id) })}
            disabled={busy || durations.length < 2}
            showHint={false}
          />
        </div>
      </BenchGroup>

      <BenchGroup title="Camera" description="Each frame keeps its own move, chosen on its card. These shape them all.">
        <div className={own.pair}>
          <OptionSelect
            label="Movement style"
            options={MOVE_STYLES}
            value={s.moveStyle}
            onChange={(id) => set({ moveStyle: id as MoveStyleId })}
            disabled={busy}
            showHint={false}
          />
          <OptionSelect
            label="Speed"
            options={SPEEDS}
            value={s.speed}
            onChange={(id) => set({ speed: id as SpeedId })}
            disabled={busy || !anyTravel}
            showHint={false}
          />
        </div>
        <Switch
          label="Architectural film style"
          description={
            s.archviz
              ? 'True verticals, a level horizon and one smooth motion-control move, like a luxury property film.'
              : 'Off: the clips move like the Video screen, without the architectural rules.'
          }
          value={s.archviz}
          onChange={(archviz: boolean) => set({ archviz })}
          isDisabled={busy}
        />
        <Switch
          label="Only what's in the image"
          description={
            s.onlyInImage
              ? 'Nothing new appears: no added objects, people or places beyond the frame.'
              : "Off: the model may add or reveal things the image doesn't show."
          }
          value={s.onlyInImage}
          onChange={(onlyInImage: boolean) => set({ onlyInImage })}
          isDisabled={busy}
        />
      </BenchGroup>

      <BenchGroup title="Direction" description="Optional. Said to every clip.">
        <TextArea
          label="Direction for every clip"
          isLabelHidden
          value={s.direction}
          onChange={(direction: string) => set({ direction: direction.slice(0, DIRECTION_MAX) })}
          rows={2}
          maxLength={DIRECTION_MAX}
          isDisabled={busy}
          placeholder="For example: leaves stir in a light breeze, water ripples softly"
          width="100%"
        />
      </BenchGroup>
    </>
  );
}

/** The film's price and its one button, at the foot of the controls. */
export function FilmFoot({ film, onGoToEdit }: { film: Film; onGoToEdit: () => void }) {
  const { film: list, missing, busy, making, batch, spend, clipItems, oneClip, seconds, s, madeAny, rendering } = film;
  return (
    <>
      <Buy items={clipItems} note={false}>
        <Button
          label={
            busy
              ? `Starting clip ${batch.indexOf(making ?? -1) + 1} of ${batch.length}…`
              : list.length === 0
                ? 'Choose frames for the film first'
                : missing.length === 0
                  ? 'Every chosen frame has a clip'
                  : missing.length === list.length
                    ? `Make ${list.length} clip${list.length === 1 ? '' : 's'}`
                    : `Make the other ${missing.length} clip${missing.length === 1 ? '' : 's'}`
          }
          variant="primary"
          icon={<Clapperboard size={16} />}
          width="100%"
          isLoading={busy}
          isDisabled={(missing.length === 0 && !busy) || spend.blocked}
          onClick={() => void film.make(missing)}
        />
      </Buy>
      <SpendNote items={oneClip} />
      <Note>
        {list.length} clip{list.length === 1 ? '' : 's'} of {seconds} seconds with {videoModelName(s.videoModel)}. Each
        clip shows its price before you make it.
      </Note>
      {madeAny && (
        <Button
          label={
            rendering > 0
              ? `${rendering} clip${rendering === 1 ? ' is' : 's are'} still rendering`
              : 'Cut them on the Edit screen'
          }
          icon={<Scissors size={16} />}
          width="100%"
          isDisabled={rendering > 0}
          onClick={onGoToEdit}
        />
      )}
      <ErrorNote error={film.batchError} />
    </>
  );
}

/** The film on the stage: each chosen frame as its clip, in story order, with its camera move. */
export function FilmBoard({ film, job, chosenCount }: { film: Film; job: StoryboardJob; chosenCount: number }) {
  const { film: list, clipFor, making, busy, spend, oneClip, errors, moveOf } = film;
  if (list.length === 0) {
    return (
      <div className={own.emptyBoard}>
        <EmptyState
          title="Choose the frames for your film"
          description={
            chosenCount > 0
              ? 'The frames you chose are not shot yet. Shoot them, then come back here.'
              : 'Open a shot frame and turn on Use in film, or choose all shot frames on the board. They become clips here.'
          }
        />
      </div>
    );
  }
  return (
    <ol className={own.clips} aria-label="Clips in story order">
      {list.map(({ frame, order }) => {
        const still = film.takes.get(frame.image);
        const clip = clipFor.get(frame.image);
        const starting = making === frame.image;
        const pending = starting || clip?.status === 'pending';
        const state = pending ? 'Being made' : clip?.status === 'succeeded' ? 'Ready' : clip?.status === 'failed' ? "Didn't render" : 'Not made yet';
        return (
          <li key={frame.image} className={own.clip}>
            <div className={own.clipFrame} style={{ '--r': ratioOf(still?.width, still?.height) } as CSSProperties}>
              {clip?.status === 'succeeded' && !starting ? (
                <video
                  key={clip.id}
                  src={libraryUrl('clip', clip.id)}
                  poster={still ? stillThumbUrl(still.id) : undefined}
                  preload="none"
                  playsInline
                  controls
                  aria-label={`Clip ${order}: ${frame.title}`}
                />
              ) : (
                still && (
                  <img src={stillThumbUrl(still.id)} alt={`Film still: ${frame.title}`} loading="lazy" decoding="async" data-dim={pending || undefined} />
                )
              )}
              {pending && (
                <StageWorking label={starting ? 'Starting the clip' : 'Rendering the clip'} runKey={clip?.id ?? `${job.id}-${frame.image}`} />
              )}
            </div>
            <div className={own.clipHead}>
              <StatusDot
                variant={pending ? 'accent' : clip?.status === 'succeeded' ? 'success' : clip?.status === 'failed' ? 'error' : 'neutral'}
                label={state}
                tooltip={state}
                isPulsing={pending}
              />
              <Text type="label" maxLines={1}>
                {frame.title}
              </Text>
              {clip?.status === 'succeeded' && (
                <span className={own.clipEnd}>
                  <Text type="supporting" maxLines={1}>
                    {videoModelName(clip.videoModel)}
                  </Text>
                  <StarButton kind="clip" id={clip.id} />
                </span>
              )}
            </div>
            <OptionSelect
              label="Camera move"
              options={MOTIONS}
              value={moveOf(frame, order)}
              onChange={(id) => film.set({ moves: { ...film.s.moves, [frame.image]: id as MotionId } })}
              disabled={busy}
              showHint={false}
              size="sm"
            />
            {clip?.status === 'failed' && !starting && (
              <Banner status="error" title="This clip didn't render" description={clip.error ?? 'Make it again.'} />
            )}
            {clip?.status === 'succeeded' && (
              <Buy items={oneClip} note={false}>
                <Button
                  label="Make again"
                  size="sm"
                  variant="ghost"
                  icon={<Film size={14} />}
                  isDisabled={busy || spend.blocked}
                  onClick={() => void film.make([{ frame, order }])}
                />
              </Buy>
            )}
            <ErrorNote error={errors[frame.image]} />
          </li>
        );
      })}
    </ol>
  );
}
