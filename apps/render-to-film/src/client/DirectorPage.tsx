import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Columns2,
  Download,
  Film,
  ImagePlus,
  LayoutGrid,
  Projector,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { Still } from '../api.ts';
import { lookLabel } from '../looks.ts';
import { defaultImageResolution, IMAGE_MODELS, imageModelName, imageResolutions, type ImageModelId } from '../models.ts';
import type { FrameChoice, FramePlan, StoryboardJob } from '../storyboard-api.ts';
import { MAX_STORYBOARD_IMAGES, STORYLINES, type StorylineId, storylineName } from '../storyboard.ts';
import { FilmBoard, FilmControls, FilmFoot, useFilm } from './director/FilmStep.tsx';
import { FrameControls } from './director/FrameControls.tsx';
import { ratioOf, slugify } from './director/shared.ts';
import { TakeImage } from './director/TakeImage.tsx';
import { Banner, Button, IconButton, Skeleton, StatusDot, Switch, Text, TextArea, ToggleButton } from './kit.ts';
import { canCompare } from './lib/compare.ts';
import { boardUploads } from './lib/boardForm.ts';
import { shootInLoop } from './lib/shootAll.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { CompareBoard } from './parts/CompareBoard.tsx';
import { CompareSlider } from './parts/CompareSlider.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
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
import own from './DirectorPage.module.css';

const STORY_MAX = 1500;
const UPLOADS_AT_ONCE = 3;

type Upload = {
  key: string;
  src: string;
  name: string;
  width: number;
  height: number;
  hostedUrl?: string | undefined;
  error?: unknown;
};

type SaveState = 'saving' | 'saved' | { error: unknown };

/** What the stage shows: the board, one frame (its image index), or the film. */
type View = 'board' | 'film' | number;

export type DirectorPageProps = {
  /** Whether this screen is on screen; a hidden one polls slowly, skips the library and its keys. */
  active: boolean;
  /** Animate a finished frame on the Video screen. */
  onAnimate: (stillId: string) => void;
  /** Cut the film's clips on the Edit screen. */
  onGoToEdit: () => void;
};

function uploadErrorFrom(e: unknown): unknown {
  if (isUploadFailure(e)) return { message: e.message };
  return e instanceof Error ? e : { message: 'The image could not be uploaded. Try again.' };
}

/** Whether an image URL loads, without showing it: the uploads expire after a day or so. */
function useImageLoads(url: string | undefined): boolean | null {
  const [state, setState] = useState<{ url: string | undefined; ok: boolean | null }>({ url, ok: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => live && setState({ url, ok: true });
    probe.onerror = () => live && setState({ url, ok: false });
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return false;
  return state.url === url ? state.ok : null;
}

const SAVE_WORDS = (save: SaveState | undefined) => (save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : '');

export function DirectorPage({ active, onAnimate, onGoToEdit }: DirectorPageProps) {
  const utils = trpc.useUtils();
  // A take or clip rendering, or one the board knows of that the library
  // hasn't caught up with yet, keeps the library fresh.
  const boardWaiting = useRef(false);
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) =>
      active &&
      (boardWaiting.current ||
        q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 8_000
        : false,
  });

  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploadsCount = useRef(0);
  uploadsCount.current = uploads.length;
  const [overflow, setOverflow] = useState(0);
  const [storyline, setStoryline] = useState<StorylineId>('day-in-the-life');
  const [story, setStory] = useState('');
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [jobId, setJobId] = useState<string | null>(null);
  const [view, setView] = useState<View>('board');

  const plan = trpc.storyboard.plan.useMutation();
  // With no plan made here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.storyboard.job.useQuery(jobId ? { id: jobId } : {}, {
    refetchInterval: (q) => (q.state.data?.status === 'planning' ? (active ? 4000 : 15_000) : false),
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;

  // ---- Project images: each uploads as soon as it is added, a few at a time.
  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(0);
  const pump = useCallback(() => {
    while (running.current < UPLOADS_AT_ONCE && queue.current.length > 0) {
      const next = queue.current.shift()!;
      running.current += 1;
      uploadRender(next.file)
        .then((hostedUrl) => setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, hostedUrl } : u))))
        .catch((e: unknown) =>
          setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, error: uploadErrorFrom(e) } : u)))
        )
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, []);

  const filesRef = useRef(new Map<string, File>());
  // Images kept or on their way in, counted at once so two quick drops can't
  // both take the same free room.
  const taken = useRef(0);
  async function addFiles(files: File[]) {
    const room = Math.max(0, MAX_STORYBOARD_IMAGES - taken.current);
    setOverflow(Math.max(0, files.length - room));
    const accepted = files.slice(0, room);
    taken.current += accepted.length;
    const added: Upload[] = [];
    for (const file of accepted) {
      const src = URL.createObjectURL(file);
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const bitmap = await createImageBitmap(file);
        added.push({ key, src, name: file.name, width: bitmap.width, height: bitmap.height });
        bitmap.close();
        filesRef.current.set(key, file);
        queue.current.push({ key, file });
      } catch {
        added.push({
          key,
          src,
          name: file.name,
          width: 16,
          height: 9,
          error: { message: 'This file could not be read as an image. Try a PNG, JPEG or WebP.' },
        });
      }
    }
    setUploads((list) => [...list, ...added].slice(0, MAX_STORYBOARD_IMAGES));
    pump();
  }

  function removeUpload(key: string) {
    if (uploads.some((u) => u.key === key)) taken.current = Math.max(0, taken.current - 1);
    queue.current = queue.current.filter((q) => q.key !== key);
    filesRef.current.delete(key);
    setUploads((list) => {
      const gone = list.find((u) => u.key === key);
      if (gone && gone.src.startsWith('blob:')) URL.revokeObjectURL(gone.src);
      return list.filter((u) => u.key !== key);
    });
    setOverflow(0);
  }

  function retryUpload(key: string) {
    const file = filesRef.current.get(key);
    if (!file) return;
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined } : u)));
    queue.current.push({ key, file });
    pump();
  }

  const pendingUploads = uploads.filter((u) => !u.hostedUrl && !u.error).length;
  const failedUploads = uploads.filter((u) => u.error).length;
  // Until the new plan's first poll lands there is no job to show, and the
  // button must not start (and bill) a second plan meanwhile.
  const planning = plan.isPending || (jobId !== null && job.isPending) || current?.status === 'planning';
  const storyTooLong = story.length > STORY_MAX;
  const ready = uploads.length > 0 && pendingUploads === 0 && failedUploads === 0 && !storyTooLong;

  async function runPlan() {
    if (!ready || planning) return;
    try {
      const { id } = await plan.mutateAsync({
        images: uploads.map((u) => ({ url: u.hostedUrl!, width: u.width, height: u.height, name: u.name })),
        storyline,
        story,
        imageModel,
        resolution,
      });
      setJobId(id);
      setView('board');
      void utils.storyboard.job.invalidate();
    } catch {
      // Shown under the button from plan.error.
    }
  }

  // ---- The board: the person's picks per frame, saved as they change them.
  const [drafts, setDrafts] = useState<Record<number, FrameChoice>>({});
  const [saves, setSaves] = useState<Record<number, SaveState>>({});
  const [shooting, setShooting] = useState<Record<number, boolean>>({});
  const [shootErrors, setShootErrors] = useState<Record<number, unknown>>({});
  const boardId = current?.status === 'planned' ? current.id : undefined;
  const loadedBoard = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!boardId || loadedBoard.current === boardId || !current) return;
    loadedBoard.current = boardId;
    const initial: Record<number, FrameChoice> = {};
    for (const [k, v] of Object.entries(current.choices ?? {})) initial[Number(k)] = v;
    setDrafts(initial);
    setSaves({});
    setShooting({});
    setShootErrors({});
    setView('board');
    // After a reload the panel is empty: show what this board was made from, so the panel and
    // the board agree and "Plan again" can use the same images.
    if (uploadsCount.current === 0) {
      setUploads(boardUploads(current.images));
      setStoryline(current.storyline);
      setStory(current.story);
      setImageModel(current.imageModel);
      if (imageResolutions(current.imageModel).some((r) => r.id === current.resolution)) setResolution(current.resolution);
    }
  }, [boardId, current]);

  const noteTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // One frame's saves go one after another, so a quick run of changes is
  // stored in the order it was made.
  const saveChains = useRef(new Map<number, Promise<unknown>>());
  const save = useCallback(
    (id: string, image: number, patch: FrameChoice) => {
      setSaves((s) => ({ ...s, [image]: 'saving' }));
      const chains = saveChains.current;
      const next = (chains.get(image) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => utils.client.storyboard.choose.mutate({ id, image, ...patch }))
        .then(() => {
          if (chains.get(image) === next) setSaves((s) => ({ ...s, [image]: 'saved' }));
        })
        .catch((error: unknown) => setSaves((s) => ({ ...s, [image]: { error } })));
      chains.set(image, next);
    },
    [utils]
  );
  const onChoose = useCallback(
    (image: number, patch: FrameChoice) => {
      if (!boardId) return;
      setDrafts((d) => ({ ...d, [image]: { ...d[image], ...patch } }));
      const timers = noteTimers.current;
      if (patch.note !== undefined) {
        clearTimeout(timers.get(image));
        setSaves((s) => ({ ...s, [image]: 'saving' }));
        timers.set(
          image,
          setTimeout(() => {
            timers.delete(image);
            save(boardId, image, patch);
          }, 800)
        );
      } else {
        save(boardId, image, patch);
      }
    },
    [boardId, save]
  );

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const refetchJob = job.refetch;
  // Frames whose shoot is on its way, and frames sent since "Shoot all" was
  // pressed, kept outside render so the loop reads them as they are now.
  const inFlight = useRef(new Set<number>());
  const sentSinceAll = useRef(new Set<number>());
  const shoot = useCallback(
    async (image: number) => {
      if (!boardId) return;
      if (inFlight.current.has(image)) return;
      inFlight.current.add(image);
      // A note still waiting to save rides along with the shoot instead.
      const noteWaiting = noteTimers.current.has(image);
      clearTimeout(noteTimers.current.get(image));
      noteTimers.current.delete(image);
      setShooting((s) => ({ ...s, [image]: true }));
      setShootErrors((e) => ({ ...e, [image]: undefined }));
      try {
        // The current picks ride along, so a change a moment ago is never lost.
        await utils.client.storyboard.shoot.mutate({ id: boardId, image, ...draftsRef.current[image], take: undefined });
        sentSinceAll.current.add(image);
        // The new take is the one the frame uses from now on.
        setDrafts((d) => ({ ...d, [image]: { ...d[image], take: undefined } }));
        if (noteWaiting) setSaves((s) => ({ ...s, [image]: 'saved' }));
        await Promise.all([refetchJob(), utils.library.invalidate()]);
      } catch (error) {
        setShootErrors((e) => ({ ...e, [image]: error }));
        // The shoot didn't go, so the note it carried is saved on its own.
        const note = draftsRef.current[image]?.note;
        if (noteWaiting && note !== undefined) save(boardId, image, { note });
      } finally {
        inFlight.current.delete(image);
        setShooting((s) => ({ ...s, [image]: false }));
      }
    },
    [boardId, utils, refetchJob, save]
  );

  const stillById = useMemo(() => new Map((library.data?.stills ?? []).map((s) => [s.id, s])), [library.data]);
  /** Every take of each frame that is in the library, newest first. */
  const allTakes = useMemo(() => {
    const out = new Map<number, Still[]>();
    for (const shot of current?.shots ?? []) {
      const still = stillById.get(shot.stillId);
      if (!still) continue;
      out.set(shot.image, [...(out.get(shot.image) ?? []), still]);
    }
    return out;
  }, [current?.shots, stillById]);
  /** Each frame's take: the one picked, else the newest. */
  const takes = useMemo(() => {
    const out = new Map<number, Still>();
    for (const [image, list] of allTakes) {
      const picked = drafts[image]?.take;
      const take = (picked ? list.find((s) => s.id === picked && s.status === 'succeeded') : undefined) ?? list[0];
      if (take) out.set(image, take);
    }
    return out;
  }, [allTakes, drafts]);
  // A shot whose take the library doesn't list yet (the server puts lost ones
  // back as it loads the board) waits for the next library refresh.
  const missingTake = (current?.shots ?? []).some((shot) => !allTakes.has(shot.image));
  boardWaiting.current =
    missingTake || Object.values(shooting).some(Boolean) || [...takes.values()].some((t) => t.status === 'pending');
  const frames = useMemo(() => (current?.status === 'planned' ? (current.plan ?? []) : []), [current]);
  const shotFrames = frames.filter((f) => takes.get(f.image)?.status === 'succeeded');
  const chosen = useMemo(
    () => new Set(frames.filter((f) => drafts[f.image]?.selected).map((f) => f.image)),
    [frames, drafts]
  );
  const allChosen = shotFrames.length > 0 && shotFrames.every((f) => chosen.has(f.image));
  const [pickError, setPickError] = useState<unknown>(undefined);
  function chooseAll() {
    if (!boardId) return;
    // Choosing all keeps frames already chosen that are being re-shot.
    const images = allChosen ? [] : [...new Set([...chosen, ...shotFrames.map((f) => f.image)])];
    const set = new Set(images);
    setDrafts((d) => {
      const out = { ...d };
      for (const f of frames) out[f.image] = { ...out[f.image], selected: set.has(f.image) };
      return out;
    });
    setPickError(undefined);
    utils.client.storyboard.pick.mutate({ id: boardId, images }).catch((error: unknown) => setPickError(error));
  }
  const onMade = useCallback(() => Promise.all([refetchJob(), utils.library.invalidate()]), [refetchJob, utils]);
  const unshot = frames.filter((f) => {
    const t = takes.get(f.image);
    return !shooting[f.image] && (!t || t.status === 'failed');
  });
  const [shootingAll, setShootingAll] = useState(false);
  // The frames still to shoot, each a picture of the board's model.
  const shootAllItems = current
    ? [{ preset: current.imageModel, resolution: current.resolution, count: unshot.length }]
    : [];
  const shootAllSpend = useSpend(shootAllItems);
  const takesRef = useRef(takes);
  takesRef.current = takes;
  async function shootAll() {
    setShootingAll(true);
    sentSinceAll.current.clear();
    try {
      // A frame shot meanwhile by its own button is not shot again.
      for (const f of unshot) {
        const state = { inFlight: inFlight.current, sent: sentSinceAll.current, take: takesRef.current.get(f.image) };
        if (shootInLoop(f.image, state)) await shoot(f.image);
      }
    } finally {
      setShootingAll(false);
    }
  }

  const film = useFilm({
    job: current?.status === 'planned' ? current : undefined,
    frames,
    takes,
    chosen,
    clips: library.data?.clips ?? [],
    onMade,
  });

  // ---- One frame on the stage.
  const frameIndex = typeof view === 'number' ? frames.findIndex((f) => f.image === view) : -1;
  const frame = frameIndex >= 0 ? frames[frameIndex] : undefined;
  const img = frame && current ? current.images[frame.image] : undefined;
  const sourceOk = useImageLoads(img?.url);
  const take = frame ? takes.get(frame.image) : undefined;
  const frameRendering = frame ? Boolean(shooting[frame.image]) || take?.status === 'pending' : false;
  const done = take?.status === 'succeeded' ? take : undefined;
  const choice = frame ? drafts[frame.image] : undefined;
  const frameSave = frame ? saves[frame.image] : undefined;
  const reshootItems = current ? [{ preset: current.imageModel, resolution: current.resolution }] : [];
  const reshoot = useSpend(reshootItems);
  const [compare, setCompare] = useState(true);
  const [full, setFull] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [board, setBoard] = useState(false);
  const saver = useDownload();
  const star = useStar();

  // A frame left behind keeps nothing ticked.
  useEffect(() => {
    setTicked(new Set());
    setFull(false);
  }, [view]);
  // A storyboard planned again leaves the frame that was open.
  useEffect(() => {
    if (typeof view === 'number' && frames.length > 0 && frameIndex < 0) setView('board');
  }, [view, frames.length, frameIndex]);

  const frameTakes = useMemo(() => (frame ? (allTakes.get(frame.image) ?? []) : []), [allTakes, frame]);
  const stripItems: TakeStripItem[] = frameTakes.map((t, i) => ({
    id: t.id,
    kind: 'still',
    thumb: t.status === 'succeeded' ? stillThumbUrl(t.id) : undefined,
    title: `Take ${frameTakes.length - i}${i === 0 ? ', newest' : ''}`,
    state: t.status === 'succeeded' ? 'ready' : t.status === 'failed' ? 'failed' : 'rendering',
    ratio: ratioOf(t.width, t.height),
    since: Date.parse(t.createdAt) || undefined,
  }));
  const tickedTakes = frameTakes.filter((t) => ticked.has(t.id) && t.status === 'succeeded');
  const compareCheck = canCompare(tickedTakes.map(() => ({ kind: 'still' as const })));

  const goFrame = (by: -1 | 1) => {
    if (frameIndex < 0) return;
    const next = frames[frameIndex + by];
    if (next) setView(next.image);
  };
  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => goFrame(-1), disabled: frameIndex < 0 },
      { key: 'ArrowRight', onKey: () => goFrame(1), disabled: frameIndex < 0 },
      { key: 'Escape', onKey: () => setView('board'), disabled: view === 'board' },
      { key: 's', onKey: () => done && star.toggle('still', done.id), disabled: !done },
      {
        key: 'c',
        onKey: () => (compareCheck.ok ? setBoard(true) : setCompare((v) => !v)),
        disabled: !done && !compareCheck.ok,
      },
      { key: 'f', onKey: () => setFull(true), disabled: !done },
    ],
    active
  );

  const settled = current?.status === 'planned';

  // ---- The controls panel: the brief, one frame's choices, or the film's settings.
  const brief = (
    <>
      {settled && (
        <Note>Plan again to start a new storyboard from these images. The frames you shot stay in your library.</Note>
      )}
      <BenchGroup
        title="Project images"
        description={`Renders or photos of one project, up to ${MAX_STORYBOARD_IMAGES}. Each uploads as you add it.`}
      >
        <ImageDropZone
          onFiles={(files) => void addFiles(files)}
          disabled={planning || uploads.length >= MAX_STORYBOARD_IMAGES}
          actionLabel={uploads.length ? 'Add images' : 'Choose images'}
        >
          <div className={own.drop}>
            <ImagePlus size={18} aria-hidden />
            <Text type="supporting">
              {uploads.length >= MAX_STORYBOARD_IMAGES
                ? `That is the full ${MAX_STORYBOARD_IMAGES}. Remove one to add another.`
                : 'Drop your project images here, several at once.'}
            </Text>
          </div>
        </ImageDropZone>
        {overflow > 0 && (
          <Banner
            status="warning"
            title={`${overflow} image${overflow === 1 ? ' was' : 's were'} left out`}
            description={`A storyboard takes up to ${MAX_STORYBOARD_IMAGES} images. Remove one to add another.`}
          />
        )}
        {uploads.length > 0 && (
          <ul className={own.thumbs} aria-label="Project images">
            {uploads.map((u) => {
              const waiting = !u.hostedUrl && !u.error;
              return (
                <li key={u.key} className={own.thumb} style={{ '--r': ratioOf(u.width, u.height) } as CSSProperties}>
                  <img src={u.src} alt={u.name} data-dim={waiting || Boolean(u.error) || undefined} />
                  {waiting && (
                    <span className={own.thumbState}>
                      <StatusDot variant="accent" label="Uploading" tooltip="Uploading" isPulsing />
                    </span>
                  )}
                  <span className={own.thumbRemove}>
                    <IconButton
                      label={`Remove ${u.name}`}
                      tooltip="Remove"
                      size="sm"
                      variant="secondary"
                      icon={<X size={14} />}
                      isDisabled={planning}
                      onClick={() => removeUpload(u.key)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {uploads
          .filter((u) => u.error)
          .map((u) => (
            <ErrorNote
              key={u.key}
              error={u.error}
              action={
                <Button
                  label={filesRef.current.has(u.key) ? 'Try again' : 'Remove'}
                  size="sm"
                  variant="ghost"
                  onClick={() => (filesRef.current.has(u.key) ? retryUpload(u.key) : removeUpload(u.key))}
                />
              }
            />
          ))}
      </BenchGroup>

      <BenchGroup title="Story" description="The narrative the frames are ordered, lit and peopled for.">
        <OptionSelect
          label="Storyline"
          options={STORYLINES}
          value={storyline}
          onChange={(id) => setStoryline(id as StorylineId)}
          disabled={planning}
        />
        <TextArea
          label="Your story"
          isOptional
          value={story}
          onChange={setStory}
          rows={4}
          maxLength={STORY_MAX}
          isDisabled={planning}
          placeholder="For example: a family's first weekend in the house, from Friday arrival to dinner on the terrace"
          width="100%"
        />
      </BenchGroup>

      <BenchGroup title="Model" description="Shoots each frame from its image.">
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
            disabled={planning}
            showHint={false}
          />
          <OptionSelect
            label="Resolution"
            options={imageResolutions(imageModel)}
            value={resolution}
            onChange={setResolution}
            disabled={planning || imageResolutions(imageModel).length < 2}
            showHint={false}
          />
        </div>
      </BenchGroup>
    </>
  );

  const briefFoot = (
    <>
      <Button
        label={
          planning
            ? 'Planning the storyboard…'
            : uploads.length === 0
              ? 'Add project images first'
              : pendingUploads > 0
                ? 'Uploading the images…'
                : failedUploads > 0
                  ? 'Retry or remove the failed upload'
                  : storyTooLong
                    ? 'Shorten your story first'
                    : `Plan ${uploads.length} frame${uploads.length === 1 ? '' : 's'}`
        }
        variant="primary"
        icon={<Projector size={16} />}
        width="100%"
        isLoading={planning}
        isDisabled={!ready}
        onClick={() => void runPlan()}
      />
      <Note>
        The app plans the storyboard. Nothing is shot until you say so; each frame you shoot with{' '}
        {imageModelName(imageModel)} shows its price before you make it.
      </Note>
      <ErrorNote error={plan.error} />
    </>
  );

  const frameFoot = frame && current && (
    <>
      <Buy items={reshootItems} note={false}>
        <Button
          label={frameRendering ? 'Shooting…' : done || take?.status === 'failed' ? 'Reshoot this frame' : 'Shoot this frame'}
          variant="primary"
          icon={<Clapperboard size={16} />}
          width="100%"
          isLoading={frameRendering}
          isDisabled={reshoot.blocked || shootingAll}
          onClick={() => void shoot(frame.image)}
        />
      </Buy>
      <Note>
        {reshoot.blocked && reshoot.why ? `${reshoot.why} ` : shootingAll ? 'Every frame is being shot; this one waits its turn. ' : ''}A {done ? 'reshoot' : 'take'} with{' '}
        {imageModelName(current.imageModel)} shows its price before you make it.
        {done ? ' The earlier take stays in the strip below the picture.' : ''}
      </Note>
      {frameSave && typeof frameSave === 'object' && <ErrorNote error={frameSave.error} />}
      <ErrorNote error={shootErrors[frame.image]} />
    </>
  );

  const frameControls = frame && (
    <>
      <div className={own.frameHead}>
        <Text type="supporting" as="p">
          Frame {frameIndex + 1} of {frames.length}, {frame.space === 'interior' ? 'interior' : 'exterior'}
          <span className={own.saveState} role="status">
            {SAVE_WORDS(frameSave)}
          </span>
        </Text>
        {frame.beat && <Text as="p">{frame.beat}</Text>}
      </div>
      <Switch
        label="Use in film"
        description={done ? 'Chosen frames become the clips of the film, in story order.' : 'Shoot this frame first, then choose it for the film.'}
        value={Boolean(choice?.selected)}
        onChange={(selected: boolean) => onChoose(frame.image, { selected })}
        isDisabled={!done}
      />
      <FrameControls frame={frame} choice={choice} disabled={frameRendering} onChoose={onChoose} />
    </>
  );

  // ---- The stage.
  let stage;
  let strip;
  if (!settled) {
    const firstImage = uploads[0]?.src ?? current?.images[0]?.url;
    stage = (
      <Stage title="Storyboard" caption={planning ? undefined : 'Each frame comes back with a recommended light, camera move and people.'}>
        {planning ? (
          <StageFrame ratio={uploads[0] ? ratioOf(uploads[0].width, uploads[0].height) : 16 / 9} dim>
            {firstImage && <img src={firstImage} alt="The first project image" />}
            <StageWorking
              label={
                plan.isPending
                  ? 'Sending the images to Claude'
                  : `Planning ${current?.images.length ?? uploads.length} frames: order, light, camera and people`
              }
              runKey={current?.id}
            />
          </StageFrame>
        ) : current?.status === 'failed' ? (
          <StageEmpty
            title="The storyboard wasn't planned"
            hint={current.error ?? 'Plan the storyboard again.'}
            action={
              <Button
                label={ready ? 'Plan again' : 'Add the images again to plan'}
                icon={<RotateCcw size={14} />}
                isDisabled={!ready}
                onClick={() => void runPlan()}
              />
            }
          />
        ) : job.isLoading ? (
          <BoardSkeleton />
        ) : (
          <StageEmpty
            title="Your storyboard will appear here"
            hint="Add the project's images, pick a storyline, then press Plan. Each frame comes back ready to shoot."
          />
        )}
      </Stage>
    );
  } else if (view === 'film') {
    stage = (
      <Stage
        title="The film"
        caption={`${film.film.length} of ${chosen.size || frames.length} chosen frame${film.film.length === 1 ? '' : 's'} ready to become clips, in story order`}
        actions={<BoardButton onClick={() => setView('board')} />}
      >
        <div className={own.scroll}>
          <FilmBoard film={film} job={current} chosenCount={chosen.size} />
        </div>
      </Stage>
    );
  } else if (frame) {
    const title = `${frameIndex + 1}. ${frame.title}`;
    const ratio = done ? ratioOf(done.width, done.height) : ratioOf(img?.width, img?.height);
    const showCompare = compare && done && img && sourceOk === true;
    stage = (
      <Stage
        title={frame.title}
        caption={done ? `${lookLabel(done.look)}, take ${frameTakes.length - frameTakes.indexOf(done)} of ${frameTakes.length}` : (frame.beat || undefined)}
        actions={
          <>
            <BoardButton onClick={() => setView('board')} />
            <IconButton label="Frame before" tooltip="Frame before (Left arrow)" size="sm" variant="ghost" icon={<ChevronLeft size={16} />} isDisabled={frameIndex === 0} onClick={() => goFrame(-1)} />
            <Text type="supporting" hasTabularNumbers>
              {frameIndex + 1} of {frames.length}
            </Text>
            <IconButton label="Frame after" tooltip="Frame after (Right arrow)" size="sm" variant="ghost" icon={<ChevronRight size={16} />} isDisabled={frameIndex === frames.length - 1} onClick={() => goFrame(1)} />
            {done && (
              <>
                <span className={own.gap} />
                {img && sourceOk !== false && (
                  <ToggleButton
                    label="Compare with your image"
                    tooltip="Compare with your image (C)"
                    size="sm"
                    isIconOnly
                    icon={<Columns2 size={16} />}
                    isPressed={compare}
                    onPressedChange={(on: boolean) => setCompare(on)}
                  />
                )}
                <FullSize
                  src={libraryUrl('still', done.id)}
                  kind="still"
                  title={title}
                  alt={`Film still: ${frame.title}`}
                  iconOnly
                  isOpen={full}
                  onOpenChange={setFull}
                />
                <StarButton kind="still" id={done.id} />
                <IconButton
                  label={saver.pending ? saver.label('Download') : 'Download'}
                  tooltip={saver.pending ? saver.label('Download') : 'Download'}
                  size="sm"
                  variant="ghost"
                  isLoading={saver.pending}
                  icon={<Download size={16} />}
                  onClick={() => saver.start(libraryUrl('still', done.id), `storyboard-${frameIndex + 1}-${slugify(frame.title)}.png`)}
                />
                <IconButton
                  label="Reuse this take's settings"
                  tooltip="Reuse this take's light, camera and people"
                  size="sm"
                  variant="ghost"
                  icon={<SlidersHorizontal size={16} />}
                  isDisabled={frameRendering}
                  onClick={() => onChoose(frame.image, { look: done.look, angle: done.angle, crowd: done.crowd })}
                />
                <Button label="Make a video" size="sm" icon={<Clapperboard size={16} />} onClick={() => onAnimate(done.id)} />
              </>
            )}
          </>
        }
        below={
          <>
            {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
            {take?.status === 'failed' && !frameRendering && (
              <Banner status="error" title="This frame didn't render" description={take.error ?? 'Shoot it again.'} />
            )}
            {done && compare && img && sourceOk === false && (
              <Text type="supporting" as="p">
                Your uploaded image is no longer kept, so only the film still can be shown.
              </Text>
            )}
          </>
        }
      >
        {frameRendering ? (
          <StageFrame ratio={ratio} dim>
            {img && sourceOk !== false && <img src={img.url} alt={`Your image: ${img.name || frame.title}`} />}
            <StageWorking
              label={shooting[frame.image] ? 'Starting the take' : 'Shooting the frame'}
              runKey={take?.id ?? `${current.id}-${frame.image}`}
            />
          </StageFrame>
        ) : showCompare ? (
          <StageFrame ratio={ratio}>
            <CompareSlider
              key={done.id}
              before={img.url}
              after={stillViewUrl(done.id)}
              afterFallback={stillThumbUrl(done.id)}
              beforeAlt={`Your image: ${img.name || frame.title}`}
              afterAlt={`Film still: ${frame.title}`}
              beforeLabel="Your image"
              afterLabel="Film still"
            />
          </StageFrame>
        ) : done ? (
          <StageFrame ratio={ratio}>
            <TakeImage key={done.id} full stillId={done.id} alt={`Film still: ${frame.title}`} />
          </StageFrame>
        ) : img && sourceOk !== false ? (
          <StageFrame ratio={ratio}>
            <img src={img.url} alt={`Your image: ${img.name || frame.title}`} />
          </StageFrame>
        ) : (
          <StageEmpty title="This frame isn't shot yet" hint="Its uploaded image is no longer kept. Plan a new storyboard to shoot it." />
        )}
      </Stage>
    );
    strip =
      frameTakes.length > 0 ? (
        <TakeStrip
          label="Takes of this frame"
          items={stripItems}
          value={done?.id ?? null}
          onChange={(id) => {
            // Only a finished take can be the frame's picture.
            if (id && frameTakes.some((t) => t.id === id && t.status === 'succeeded')) onChoose(frame.image, { take: id });
          }}
          ticked={ticked}
          onTick={(id) =>
            setTicked((cur) => {
              const next = new Set(cur);
              if (next.has(id)) next.delete(id);
              else if (next.size < 4) next.add(id);
              return next;
            })
          }
          actions={
            ticked.size > 0 ? (
              <>
                <Button label="Clear ticks" size="sm" variant="ghost" onClick={() => setTicked(new Set())} />
                <Button
                  label={`Compare ${tickedTakes.length}`}
                  size="sm"
                  isDisabled={!compareCheck.ok}
                  tooltip={compareCheck.ok ? 'Compare side by side (C)' : compareCheck.why}
                  onClick={() => setBoard(true)}
                />
              </>
            ) : undefined
          }
        />
      ) : undefined;
  } else {
    stage = (
      <Stage
        title={`Storyboard: ${storylineName(current.storyline)}`}
        caption={`${frames.length} frame${frames.length === 1 ? '' : 's'} in story order, shot with ${imageModelName(current.imageModel)}`}
        actions={
          <>
            {shotFrames.length > 0 && (
              <Button
                label={allChosen ? 'Clear the film choice' : 'Choose all shot frames'}
                size="sm"
                variant="ghost"
                icon={<CircleCheck size={16} />}
                onClick={chooseAll}
              />
            )}
            {unshot.length > 0 && (
              <Buy items={shootAllItems} note={false}>
                <Button
                  label={
                    shootingAll
                      ? 'Shooting the frames…'
                      : unshot.length === frames.length
                        ? `Shoot all ${frames.length} frames`
                        : `Shoot the other ${unshot.length} frame${unshot.length === 1 ? '' : 's'}`
                  }
                  size="sm"
                  icon={<Clapperboard size={16} />}
                  isLoading={shootingAll}
                  isDisabled={shootAllSpend.blocked}
                  tooltip={shootAllSpend.blocked && shootAllSpend.why ? shootAllSpend.why : undefined}
                  onClick={() => void shootAll()}
                />
              </Buy>
            )}
          </>
        }
        below={<ErrorNote error={pickError} />}
      >
        <div className={own.scroll}>
          <ol className={own.board} aria-label="Storyboard frames in story order">
            {frames.map((f, i) => (
              <FrameCard
                key={`${current.id}-${f.image}`}
                order={i + 1}
                frame={f}
                job={current}
                take={takes.get(f.image)}
                chosen={chosen.has(f.image)}
                shooting={Boolean(shooting[f.image])}
                onOpen={setView}
              />
            ))}
            <li>
              <FilmCard
                chosen={chosen.size}
                ready={film.film.length}
                made={film.film.filter(({ frame: ff }) => film.clipFor.get(ff.image)?.status === 'succeeded').length}
                thumbs={film.film.slice(0, 4).map(({ frame: ff }) => takes.get(ff.image)!.id)}
                onOpen={() => setView('film')}
              />
            </li>
          </ol>
          <Text type="supporting" as="p">
            Every frame is saved to your library, tagged @storyboard. Shoot within a day or so of planning: the uploaded
            images are only kept that long.
          </Text>
        </div>
      </Stage>
    );
  }

  const controls = !settled || view === 'board' ? brief : view === 'film' ? <FilmControls film={film} /> : frameControls;
  const foot = !settled || view === 'board' ? briefFoot : view === 'film' ? <FilmFoot film={film} onGoToEdit={onGoToEdit} /> : frameFoot;

  return (
    <>
      <Workbench
        label={!settled || view === 'board' ? 'Storyboard brief' : view === 'film' ? 'Film settings' : 'Frame settings'}
        saveId="director-controls"
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
      {frame && (
        <CompareBoard
          isOpen={board && compareCheck.ok}
          onClose={() => setBoard(false)}
          items={tickedTakes.map((t) => ({
            id: t.id,
            kind: 'still' as const,
            src: stillViewUrl(t.id),
            title: `Take ${frameTakes.length - frameTakes.indexOf(t)}`,
            detail: lookLabel(t.look),
            ratio: ratioOf(t.width, t.height),
          }))}
          pickLabel="Use for this frame"
          onPick={(id) => {
            onChoose(frame.image, { take: id });
            setBoard(false);
          }}
        />
      )}
    </>
  );
}

function BoardButton({ onClick }: { onClick: () => void }) {
  return <IconButton label="Back to the board" tooltip="Back to the board (Esc)" size="sm" variant="ghost" icon={<LayoutGrid size={16} />} onClick={onClick} />;
}

type FrameCardProps = {
  order: number;
  frame: FramePlan;
  job: StoryboardJob;
  take: Still | undefined;
  chosen: boolean;
  shooting: boolean;
  onOpen: (image: number) => void;
};

/** One frame on the board: its picture at its own shape, its title and where it stands. Memoised. */
const FrameCard = memo(function FrameCard({ order, frame, job, take, chosen, shooting, onOpen }: FrameCardProps) {
  const [sourceBroken, setSourceBroken] = useState(false);
  const img = job.images[frame.image];
  const rendering = shooting || take?.status === 'pending';
  const done = take?.status === 'succeeded' ? take : undefined;
  const state = rendering ? 'Being shot' : done ? 'Shot' : take?.status === 'failed' ? "Didn't render" : 'Not shot yet';
  const dot = rendering ? 'accent' : done ? 'success' : take?.status === 'failed' ? 'error' : 'neutral';
  return (
    <li className={own.card}>
      <button
        type="button"
        className={own.cardFrame}
        style={{ '--r': ratioOf(img?.width, img?.height) } as CSSProperties}
        onClick={() => onOpen(frame.image)}
        aria-label={`Open frame ${order}: ${frame.title}, ${state.toLowerCase()}`}
      >
        {done ? (
          <TakeImage key={done.id} stillId={done.id} alt="" />
        ) : img && !sourceBroken ? (
          <img
            src={img.url}
            alt=""
            loading="lazy"
            decoding="async"
            data-dim={rendering || undefined}
            onError={() => setSourceBroken(true)}
          />
        ) : null}
        {!done && !rendering && img && !sourceBroken && <span className={own.sourceTag}>Your image</span>}
        {rendering && <span className={own.cardBar} aria-hidden />}
        {chosen && done && (
          <span className={own.inFilm}>
            <Film size={12} aria-hidden /> In the film
          </span>
        )}
      </button>
      <div className={own.cardText}>
        <div className={own.cardTitle}>
          <StatusDot variant={dot} label={state} tooltip={state} isPulsing={rendering} />
          <Text type="label" maxLines={1}>
            {frame.title}
          </Text>
          <span className={own.space}>
            <Text type="supporting">{frame.space === 'interior' ? 'Interior' : 'Exterior'}</Text>
          </span>
        </div>
        {frame.beat && (
          <Text type="supporting" as="p" maxLines={2}>
            {frame.beat}
          </Text>
        )}
        {!done && !rendering && (!img || sourceBroken) && (
          <Text type="supporting" as="p">
            This uploaded image is no longer kept. Plan a new storyboard to shoot it.
          </Text>
        )}
      </div>
    </li>
  );
});

/** The board's last card: the film, made from the frames chosen for it. */
function FilmCard({
  chosen,
  ready,
  made,
  thumbs,
  onOpen,
}: {
  chosen: number;
  ready: number;
  made: number;
  thumbs: readonly string[];
  onOpen: () => void;
}) {
  return (
    <div className={own.card}>
      <button type="button" className={`${own.cardFrame} ${own.filmFrame}`} onClick={onOpen} aria-label="Open the film">
        {thumbs.length > 0 ? (
          <span className={own.mosaic} data-count={thumbs.length}>
            {thumbs.map((id) => (
              <img key={id} src={stillThumbUrl(id)} alt="" loading="lazy" decoding="async" />
            ))}
          </span>
        ) : (
          <span className={own.filmEmpty}>
            <Film size={20} aria-hidden />
          </span>
        )}
      </button>
      <div className={own.cardText}>
        <div className={own.cardTitle}>
          <StatusDot
            variant={made > 0 && made === ready ? 'success' : ready > 0 ? 'accent' : 'neutral'}
            label={made > 0 ? `${made} of ${ready} clips made` : 'No clips yet'}
          />
          <Text type="label">The film</Text>
        </div>
        <Text type="supporting" as="p">
          {ready === 0
            ? chosen > 0
              ? 'The frames you chose are not shot yet.'
              : 'Choose shot frames for the film, then make their clips here.'
            : `${ready} frame${ready === 1 ? '' : 's'} chosen, ${made} clip${made === 1 ? '' : 's'} made.`}
        </Text>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className={own.scroll}>
      <ul className={own.board} aria-label="Loading your storyboard">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={own.card}>
            <div className={own.cardFrame} data-skeleton>
              <Skeleton radius={1} index={i} />
            </div>
            <Skeleton height={14} width="60%" index={i} />
            <Skeleton height={12} width="85%" index={i} />
          </li>
        ))}
      </ul>
    </div>
  );
}
