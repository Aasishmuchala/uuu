import {
  Clapperboard,
  Columns2,
  Download,
  ImageUpscale,
  Pencil,
  ScanEye,
  Sparkles,
  SquareDashedMousePointer,
  SunMedium,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';

import {
  ACTIVITIES,
  AGES,
  ANGLES,
  CROWDS,
  DEFAULT_PEOPLE_OPTIONS,
  ETHNICITIES,
  LOOKS,
  litFromReference,
  lookLabel,
  WARDROBES,
  type ActivityId,
  type AgeId,
  type AngleId,
  type CrowdId,
  type EthnicityId,
  type LookId,
  type WardrobeId,
} from '../looks.ts';
import {
  castSheetModelNames,
  aspectDims,
  defaultImageResolution,
  imageAspectOptions,
  imageModelHasAspect,
  IMAGE_MODELS,
  imageModelName,
  imageModelTakesCastSheet,
  imageResolutionName,
  imageResolutions,
  MATCH_RENDER,
  type ImageModelId,
  maskedEditFit,
} from '../models.ts';
import type { Still } from '../api.ts';
import { CastSheetField, type CastSheet } from './CastSheetField.tsx';
import { Banner, Button, IconButton, Switch, Text, TextArea, TextInput, ToggleButton } from './kit.ts';
import { LightReferenceField } from './LightReferenceField.tsx';
import { canCompare } from './lib/compare.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { exportMaskPng, maskCoverage, type MaskStroke } from './lib/mask.ts';
import { takePreset } from './lib/reuse.ts';
import { isUploadFailure, uploadMask, uploadRender } from './lib/uploadRender.ts';
import { CompareBoard } from './parts/CompareBoard.tsx';
import { CompareSlider } from './parts/CompareSlider.tsx';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { Stage, StageEmpty, StageFrame, StageWorking } from './parts/Stage.tsx';
import { StarButton, useStar } from './parts/StarButton.tsx';
import { TakeStrip, type TakeStripItem } from './parts/TakeStrip.tsx';
import { useKeys } from './parts/useKeys.ts';
import { BenchGroup, Note, Workbench } from './parts/Workbench.tsx';
import { PeopleCheck } from './PeopleCheck.tsx';
import { trpc } from './trpc.ts';
import { FullSize } from './ui/FullSize.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { MaskOverlay, MaskPainter } from './ui/MaskPainter.tsx';
import { Buy, useSpend } from './ui/Price.tsx';
import { UpscaleStill, type UpscaleJob } from './UpscaleStill.tsx';
import mk from './screens/Make.module.css';

type Source = {
  src: string;
  name: string;
  width: number;
  height: number;
  /** Hosted URL from `/api/upload`, once uploaded; reused across takes. */
  hostedUrl?: string | undefined;
  /** The chosen file itself: the page may not fetch its own blob: address (connect-src 'self'). */
  file?: Blob | undefined;
};

/** What a take was made with, so a fix re-take can repeat it exactly. */
type ShotSettings = {
  imageModel: ImageModelId;
  resolution: string;
  /** "match" or a ratio the model offers, e.g. "9:16". */
  aspectRatio: string;
  look: LookId;
  angle: AngleId;
  /** "Only what's in the image": nothing new appears but the people asked for. */
  onlyInImage: boolean;
  crowd: CrowdId;
  people: string;
  ethnicity: EthnicityId;
  age: AgeId;
  wardrobe: WardrobeId;
  activity: ActivityId;
  /** Hosted cast sheet URL, when one was uploaded; re-takes send it again. */
  castSheetUrl?: string | undefined;
  /** Hosted lighting reference; while set, the look preset is not used. */
  lightRefUrl?: string | undefined;
  /** Or one of the visitor's finished stills, for a matching series. */
  lightFromStillId?: string | undefined;
  direction: string;
  /**
   * A marked edit: the stored mask and the strokes it was drawn from. Only
   * that area changes; re-takes send the same mask.
   */
  maskKey?: string | undefined;
  maskStrokes?: readonly MaskStroke[] | undefined;
};

type Shot = ShotSettings & { id: string; source: Source; fixed: boolean };

/** A take of this visit and what it came back as. */
type Take = { shot: Shot; since: number; url?: string | undefined; error?: string | undefined };

const SAMPLE: Source = {
  src: '/sample-render.jpg',
  name: 'sample-render.jpg',
  width: 2560,
  height: 1440,
};

/** Longest extra direction the server takes, in characters. */
const DIRECTION_MAX = 600;

/** How long a finished marked take keeps retrying its restore before the error is final. */
const COMPOSITE_RETRY_MS = 60_000;

export type StillsPageProps = {
  /** True while Stills is on screen: its keys work and a preset from History is read. */
  active: boolean;
  /** Open the Video screen with this still picked. */
  onAnimate: (stillId: string) => void;
};

export function StillsPage({ active, onAnimate }: StillsPageProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const [source, setSource] = useState<Source>(SAMPLE);
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [aspectRatio, setAspectRatio] = useState<string>(MATCH_RENDER);
  const [look, setLook] = useState<LookId>('golden-hour');
  const [direction, setDirection] = useState('');
  const [angle, setAngle] = useState<AngleId>('as-rendered');
  const [onlyInImage, setOnlyInImage] = useState(true);
  const [crowd, setCrowd] = useState<CrowdId>('none');
  const [people, setPeople] = useState('');
  const [ethnicity, setEthnicity] = useState<EthnicityId>(DEFAULT_PEOPLE_OPTIONS.ethnicity);
  const [age, setAge] = useState<AgeId>(DEFAULT_PEOPLE_OPTIONS.age);
  const [wardrobe, setWardrobe] = useState<WardrobeId>(DEFAULT_PEOPLE_OPTIONS.wardrobe);
  const [activity, setActivity] = useState<ActivityId>(DEFAULT_PEOPLE_OPTIONS.activity);
  const [cast, setCast] = useState<CastSheet | null>(null);
  const [castUploading, setCastUploading] = useState(false);
  const [castError, setCastError] = useState<unknown>(null);
  const [lightRef, setLightRef] = useState<CastSheet | null>(null);
  const [lightUploading, setLightUploading] = useState(false);
  const [lightError, setLightError] = useState<unknown>(null);
  /** A finished still whose light every new view matches (a series). */
  const [matchStillId, setMatchStillId] = useState<string | null>(null);
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'submitting'>('idle');
  const [marking, setMarking] = useState(false);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  /** The stored mask for exactly these strokes on this source, once uploaded. */
  const [savedMask, setSavedMask] = useState<{ src: string; strokes: readonly MaskStroke[]; key: string } | null>(null);
  const markedShare = useMemo(
    () => maskCoverage(strokes, source.width, source.height),
    [strokes, source.width, source.height]
  );
  const hasMark = markedShare > 0;
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  /** Every take of this visit, newest first, with what it came back as. */
  const [takes, setTakes] = useState<Take[]>([]);
  /** The take on the stage: null follows the newest; 'source' shows the render being set up. */
  const [focus, setFocus] = useState<string | null>(null);
  /** The panel beside the stage. */
  const [side, setSide] = useState<'people' | 'upscale' | null>(null);
  const [comparing, setComparing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [board, setBoard] = useState(false);
  const [full, setFull] = useState(false);
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  /**
   * Upscales by the still they belong to. Kept here, not in the panel, so an
   * upscale keeps running and stays visible when a new take replaces its still.
   */
  const [upscales, setUpscales] = useState<Record<string, UpscaleJob>>({});
  const setUpscaleJob = (stillId: string, job: UpscaleJob | null) =>
    setUpscales((cur) => {
      const next = { ...cur };
      if (job) next[stillId] = job;
      else delete next[stillId];
      return next;
    });

  // A take's compare slider keeps its render's object URL alive; free it once
  // a newer take replaces it and it is no longer the picked source either.
  const prevShotSrc = useRef<string | undefined>(undefined);
  const shotSrc = shot?.source.src;
  useEffect(() => {
    const prev = prevShotSrc.current;
    prevShotSrc.current = shotSrc;
    if (prev && prev !== shotSrc && prev.startsWith('blob:') && prev !== sourceRef.current.src) {
      URL.revokeObjectURL(prev);
    }
  }, [shotSrc]);

  // When this take first came back finished but not yet restored.
  const compositeSince = useRef<{ id: string; at: number } | null>(null);
  const compositeGaveUp = (at: number) => {
    if (!shot) return true;
    if (compositeSince.current?.id !== shot.id) compositeSince.current = { id: shot.id, at };
    return at - compositeSince.current.at > COMPOSITE_RETRY_MS;
  };
  const createShot = trpc.createShot.useMutation();
  const status = trpc.shotStatus.useQuery(
    { id: shot?.id ?? '' },
    {
      enabled: shot !== null,
      // A marked take whose untouched area is still being restored keeps polling.
      refetchInterval: (q) =>
        q.state.data?.done && (!q.state.data.compositePending || compositeGaveUp(q.state.dataUpdatedAt))
          ? false
          : 2500,
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const finished =
    status.data?.done === true &&
    (!status.data.compositePending || compositeGaveUp(status.dataUpdatedAt));
  const doneId = finished ? shot?.id : undefined;
  useEffect(() => {
    // The library now has this take; the other tab's lists should show it.
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);

  const rendering = shot !== null && !finished && !status.error;
  const busy = phase !== 'idle' || rendering;
  const castSupported = imageModelTakesCastSheet(imageModel);
  const resultUrl = finished ? status.data?.url : undefined;
  const maskFit = hasMark ? maskedEditFit(imageModel, source.width, source.height) : ({ ok: true } as const);
  const taskError = finished && !status.data?.url
    ? status.data?.error ?? 'The generation did not return an image. Try again.'
    : undefined;
  const shownError = error ?? status.error;
  const directionTooLong = direction.length > DIRECTION_MAX;

  async function onFile(file: File) {
    setError(null);
    const src = URL.createObjectURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      setSource((prev) => {
        // The finished take's compare slider may still show the old render.
        if (prev.src.startsWith('blob:') && prev.src !== shotRef.current?.source.src) {
          URL.revokeObjectURL(prev.src);
        }
        return { src, name: file.name, width: bitmap.width, height: bitmap.height, file };
      });
      bitmap.close();
      // A mark belongs to the render it was drawn on.
      setStrokes([]);
      setSavedMask(null);
      setMarking(false);
    } catch {
      URL.revokeObjectURL(src);
      setError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
    }
  }

  /** Upload an extra reference photo (cast sheet or lighting) into its own slot. */
  async function uploadReference(
    file: File,
    slot: {
      set: Dispatch<SetStateAction<CastSheet | null>>;
      setUploading: (v: boolean) => void;
      setError: (e: unknown) => void;
      what: string;
    }
  ) {
    slot.setError(null);
    const src = URL.createObjectURL(file);
    slot.set((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return { src, name: file.name };
    });
    slot.setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      slot.set((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      slot.set((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      slot.setError(
        isUploadFailure(e)
          ? { message: e.message }
          : e instanceof Error
            ? e
            : { message: `The ${slot.what} could not be uploaded. Try again.` }
      );
    } finally {
      slot.setUploading(false);
    }
  }

  const onCastFile = (file: File) =>
    uploadReference(file, {
      set: setCast,
      setUploading: setCastUploading,
      setError: setCastError,
      what: 'cast sheet',
    });

  const onLightFile = (file: File) =>
    uploadReference(file, {
      set: setLightRef,
      setUploading: setLightUploading,
      setError: setLightError,
      what: 'lighting reference',
    });

  function removeCast() {
    setCastError(null);
    setCast((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  function removeLightRef() {
    setLightError(null);
    setLightRef((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  async function submit(settings: ShotSettings, from: Source, fixes = '') {
    setError(null);
    try {
      let hostedUrl = from.hostedUrl;
      if (!hostedUrl) {
        setPhase('uploading');
        const blob: Blob = from.file ?? (await (await fetch(from.src)).blob());
        hostedUrl = await uploadRender(blob);
        const uploaded = { ...from, hostedUrl };
        setSource((cur) => (cur.src === from.src ? uploaded : cur));
      }
      let maskKey = settings.maskKey;
      if (!maskKey && settings.maskStrokes && settings.maskStrokes.length > 0) {
        setPhase('uploading');
        maskKey = await uploadMask(await exportMaskPng(settings.maskStrokes, from.width, from.height));
        const stored = { src: from.src, strokes: settings.maskStrokes, key: maskKey };
        setSavedMask(stored);
      }
      setPhase('submitting');
      const { id } = await createShot.mutateAsync({
        ...settings,
        imageUrl: hostedUrl,
        people: settings.crowd === 'none' ? '' : settings.people,
        castSheetUrl:
          settings.crowd !== 'none' && imageModelTakesCastSheet(settings.imageModel)
            ? settings.castSheetUrl
            : undefined,
        lightRefUrl: maskKey ? undefined : settings.lightRefUrl,
        lightFromStillId: maskKey ? undefined : settings.lightFromStillId,
        fixes,
        width: from.width,
        height: from.height,
        maskKey,
        ...(maskKey ? { aspectRatio: MATCH_RENDER, angle: 'as-rendered' as const } : {}),
      });
      const made: Shot = {
        ...settings,
        ...(maskKey ? { aspectRatio: MATCH_RENDER, angle: 'as-rendered' as const } : {}),
        maskKey,
        id,
        source: { ...from, hostedUrl },
        fixed: fixes !== '',
      };
      setShot(made);
      // The session's takes, newest first; the stage follows the newest.
      setTakes((prev) => [{ shot: made, since: Date.now() }, ...prev.filter((t) => t.shot.id !== id)]);
      setFocus(null);
    } catch (e) {
      setError(isUploadFailure(e) ? e.body ?? e : e);
    } finally {
      setPhase('idle');
    }
  }

  const run = () =>
    submit(
      {
        imageModel,
        resolution,
        aspectRatio,
        look,
        angle,
        onlyInImage,
        crowd,
        people,
        ethnicity,
        age,
        wardrobe,
        activity,
        castSheetUrl: cast?.hostedUrl,
        lightRefUrl: hasMark || matchedStill ? undefined : lightRef?.hostedUrl,
        lightFromStillId: hasMark ? undefined : matchedStill?.id,
        direction,
        ...(hasMark
          ? {
              maskStrokes: strokes,
              maskKey:
                savedMask && savedMask.src === source.src && savedMask.strokes === strokes
                  ? savedMask.key
                  : undefined,
            }
          : {}),
      },
      source
    );

  /** Re-take a finished take (the one on the stage) with the people check's corrections. */
  async function fix(fixes: string, target: Shot | null = shot) {
    if (!target || busy) return;
    setFixing(true);
    try {
      await submit(target, target.source, fixes.slice(0, 2000));
    } finally {
      setFixing(false);
    }
  }

  const { planBlocked, unavailable } = classifyRunwayError(shownError);
  // One take of the chosen model (the people check is the app's thinking, not a picture).
  const priceItems = [{ preset: imageModel, resolution }];
  const spend = useSpend(priceItems);

  const lookName = shot ? lookLabel(shot.look, litFromReference(shot)) : lookLabel(look);
  const finishedStills = (library.data?.stills ?? []).filter((s) => s.status === 'succeeded');
  const stillItem = (s: Still) => ({
    id: s.id,
    src: stillThumbUrl(s.id),
    alt: `${lookLabel(s.look, litFromReference(s))} still from ${new Date(s.createdAt).toLocaleString()}`,
    caption: lookLabel(s.look, litFromReference(s)),
  });
  const matchedStill = finishedStills.find((s) => s.id === matchStillId);
  /** A lighting reference is in and will be sent: the presets step aside. */
  const usingLightRef = (lightRef !== null || matchedStill !== undefined) && !hasMark;

  // A take that finished keeps what it came back as, so the strip and the stage can show it later.
  const finishedId = finished ? shot?.id : undefined;
  useEffect(() => {
    if (!finishedId) return;
    const url = status.data?.url ?? undefined;
    const failed = url ? undefined : (status.data?.error ?? 'The generation did not return an image. Try again.');
    setTakes((prev) => prev.map((t) => (t.shot.id === finishedId ? { ...t, url, error: failed } : t)));
    // A take with people gets its people check beside it at once, as it always has.
    if (url && shotRef.current?.crowd !== 'none') setSide('people');
  }, [finishedId]);

  // "Use again" and "Reuse settings" fill the form; nothing is sent until the priced button.
  useEffect(() => {
    if (!active) return;
    const p = takePreset('still');
    if (!p) return;
    if (p.imageModel) {
      const m = p.imageModel as ImageModelId;
      setImageModel(m);
      setResolution(p.resolution ?? defaultImageResolution(m));
      setAspectRatio(p.aspectRatio ?? MATCH_RENDER);
    }
    if (p.look) setLook(p.look as LookId);
    if (p.angle) setAngle(p.angle as AngleId);
    if (p.crowd) setCrowd(p.crowd as CrowdId);
    if (p.people !== undefined) setPeople(p.people);
    if (p.ethnicity) setEthnicity(p.ethnicity as EthnicityId);
    if (p.age) setAge(p.age as AgeId);
    if (p.wardrobe) setWardrobe(p.wardrobe as WardrobeId);
    if (p.activity) setActivity(p.activity as ActivityId);
    if (p.direction !== undefined) setDirection(p.direction);
    const from = p.source;
    if (from) {
      setSource((prev) => {
        if (prev.src.startsWith('blob:') && prev.src !== shotRef.current?.source.src) URL.revokeObjectURL(prev.src);
        return { src: from.url, name: 'The render of the take you picked', width: from.width, height: from.height, hostedUrl: from.url };
      });
      setStrokes([]);
      setSavedMask(null);
      setMarking(false);
    }
    setError(null);
    setFocus('source');
  }, [active]);

  const latest = takes[0] ?? null;
  const viewed = focus === 'source' ? null : (focus ? takes.find((t) => t.shot.id === focus) : undefined) ?? latest;
  const viewedShot = viewed?.shot ?? null;
  const viewingLatest = viewedShot !== null && viewedShot.id === shot?.id;
  const viewedUrl = viewedShot ? (viewingLatest ? resultUrl : viewed?.url ? stillViewUrl(viewedShot.id) : undefined) : undefined;
  const viewedError = viewedShot ? (viewingLatest ? taskError : viewed?.error) : undefined;
  const viewedRendering = viewingLatest && rendering;
  const viewedLook = viewedShot ? lookLabel(viewedShot.look, litFromReference(viewedShot)) : lookName;
  /** The render a take was made from: its hosted copy outlives the page's own preview of it. */
  const renderOf = (s: Shot) => (viewingLatest && s.id === shot?.id ? s.source.src : (s.source.hostedUrl ?? s.source.src));
  const star = useStar();

  const stripItems: TakeStripItem[] = takes.map((t) => {
    const isLatest = t.shot.id === shot?.id;
    const working = isLatest && rendering;
    return {
      id: t.shot.id,
      kind: 'still',
      thumb: t.url ? stillThumbUrl(t.shot.id) : (t.shot.source.hostedUrl ?? t.shot.source.src),
      title: lookLabel(t.shot.look, litFromReference(t.shot)),
      state: working
        ? 'rendering'
        : t.error
          ? 'failed'
          : t.url
            ? 'ready'
            : isLatest && status.error
              ? 'lost'
              : 'rendering',
      ratio: ratioOf(shotFrame(t.shot)),
      progress: working ? status.data?.progress : undefined,
      since: t.since,
    };
  });
  const tickedTakes = takes.filter((t) => ticked.has(t.shot.id) && t.url);
  const compare = canCompare(tickedTakes.map(() => ({ kind: 'still' as const })));
  const toggleTick = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  const order = ['source', ...takes.map((t) => t.shot.id)];
  const at = focus === 'source' ? 0 : viewedShot ? order.indexOf(viewedShot.id) : 0;
  const step = (by: number) => {
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setFocus(next);
  };

  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => step(-1) },
      { key: 'ArrowRight', onKey: () => step(1) },
      { key: 's', onKey: () => viewedShot && viewedUrl && star.toggle('still', viewedShot.id), disabled: !viewedUrl },
      {
        key: 'c',
        onKey: () => (compare.ok ? setBoard(true) : setComparing((v) => !v)),
        disabled: !viewedUrl && !compare.ok,
      },
      { key: 'f', onKey: () => setFull(true), disabled: !viewedUrl },
    ],
    active && !marking
  );

  const settingsLine = (s: Shot) =>
    [
      `${imageModelName(s.imageModel)} at ${imageResolutionName(s.imageModel, s.resolution) ?? 'its own size'}`,
      s.aspectRatio !== MATCH_RENDER ? s.aspectRatio : '',
      lookLabel(s.look, litFromReference(s)).toLowerCase(),
      s.fixed ? 'with fixes' : '',
      s.maskKey ? 'only the marked area changed' : '',
      s.angle !== 'as-rendered' ? (ANGLES.find((a) => a.id === s.angle)?.name.toLowerCase() ?? '') : '',
    ]
      .filter(Boolean)
      .join(', ');

  const stageRatio = viewedShot ? ratioOf(shotFrame(viewedShot)) : source.width / source.height;
  const working = phase !== 'idle' || viewedRendering;
  const workingLabel =
    phase === 'uploading'
      ? 'Uploading your render'
      : phase === 'submitting'
        ? fixing
          ? 'Starting the corrected take'
          : 'Starting the take'
        : 'Lighting the scene and developing the frame';

  const stage = marking ? (
    <Stage title="Mark the area to change" caption="Everything outside it stays exactly as rendered.">
      <div className={mk.painter} style={{ '--r': source.width / source.height } as CSSProperties}>
        <MaskPainter
          src={source.src}
          alt={`Source render: ${source.name}. Paint to mark the area to edit.`}
          width={source.width}
          height={source.height}
          strokes={strokes}
          onChange={setStrokes}
          onDone={() => setMarking(false)}
          disabled={busy}
        />
      </div>
    </Stage>
  ) : (
    <Stage
      title={viewedShot && !working ? viewedLook : 'Your render'}
      caption={
        viewedShot && !working
          ? settingsLine(viewedShot)
          : `${source.name}, ${source.width} × ${source.height}`
      }
      actions={
        viewedShot && viewedUrl && !working ? (
          <>
            <ToggleButton
              label="Compare with render"
              tooltip="Compare with render (C)"
              size="sm"
              isIconOnly
              icon={<Columns2 size={16} />}
              isPressed={comparing}
              onPressedChange={(on: boolean) => setComparing(on)}
            />
            <FullSize
              src={libraryUrl('still', viewedShot.id)}
              kind="still"
              title={viewedLook}
              alt={`Photoreal ${viewedLook.toLowerCase()} version of the render`}
              iconOnly
              isOpen={full}
              onOpenChange={setFull}
            />
            <StarButton kind="still" id={viewedShot.id} />
            <IconButton
              label={saver.pending ? saver.label('Download') : 'Download'}
              tooltip={saver.pending ? saver.label('Download') : 'Download'}
              size="sm"
              variant="ghost"
              isLoading={saver.pending}
              icon={<Download size={16} />}
              onClick={() => saver.start(libraryUrl('still', viewedShot.id), `film-still-${viewedShot.look}.png`)}
            />
            {!viewedShot.maskKey && matchStillId !== viewedShot.id && (
              <IconButton
                label="Use this light for other views"
                tooltip="Use this light for other views"
                size="sm"
                variant="ghost"
                icon={<SunMedium size={16} />}
                onClick={() => {
                  removeLightRef();
                  setMatchStillId(viewedShot.id);
                }}
              />
            )}
            {viewedShot.crowd !== 'none' && (
              <ToggleButton
                label="People check"
                tooltip="People check"
                size="sm"
                isIconOnly
                icon={<ScanEye size={16} />}
                isPressed={side === 'people'}
                onPressedChange={(on: boolean) => setSide(on ? 'people' : null)}
              />
            )}
            <ToggleButton
              label="Upscale"
              tooltip="Upscale"
              size="sm"
              isIconOnly
              icon={<ImageUpscale size={16} />}
              isPressed={side === 'upscale'}
              onPressedChange={(on: boolean) => setSide(on ? 'upscale' : null)}
            />
            <span className={mk.gap} />
            <Button label="Make a video" size="sm" icon={<Clapperboard size={16} />} onClick={() => onAnimate(viewedShot.id)} />
          </>
        ) : undefined
      }
      below={
        <>
          {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
          {!working && viewedError && <Banner status="error" title="This take didn't render" description={viewedError} />}
        </>
      }
    >
      <StageFrame ratio={stageRatio} dim={working}>
        {working ? (
          <>
            <img src={viewedShot && phase === 'idle' ? renderOf(viewedShot) : source.src} alt={`Source render: ${source.name}`} />
            <StageWorking
              label={workingLabel}
              progress={phase === 'idle' ? status.data?.progress : undefined}
              runKey={phase === 'idle' ? shot?.id : phase}
            />
          </>
        ) : viewedShot && viewedUrl ? (
          comparing ? (
            <CompareSlider
              before={renderOf(viewedShot)}
              after={viewedUrl}
              beforeAlt="Original render"
              afterAlt={`Photoreal ${viewedLook.toLowerCase()} version of the render`}
              afterFallback={stillViewUrl(viewedShot.id)}
            />
          ) : (
            <img src={viewedUrl} alt={`Photoreal ${viewedLook.toLowerCase()} version of the render`} />
          )
        ) : viewedShot ? (
          <img src={renderOf(viewedShot)} alt="Original render" />
        ) : (
          <>
            <img src={source.src} alt={`Source render: ${source.name}`} />
            {hasMark && <MaskOverlay strokes={strokes} />}
          </>
        )}
      </StageFrame>
      {!viewedShot && !working && takes.length === 0 && (
        <div className={mk.hint}>
          <Text type="supporting">Pick a look and press {hasMark ? 'Edit the marked area' : 'Make it cinematic'}. A take usually lands in under a minute.</Text>
        </div>
      )}
    </Stage>
  );

  const upscaleOthers = Object.entries(upscales).filter(([stillId]) => stillId !== viewedShot?.id);
  const sidePanel =
    side && viewedShot && viewedUrl && !marking ? (
      <div className={mk.side}>
        {side === 'people' && viewedShot.crowd !== 'none' ? (
          <PeopleCheck
            key={viewedShot.id}
            stillId={viewedShot.id}
            autoRun
            onFix={(f) => void fix(f, viewedShot)}
            fixing={fixing || busy}
            retake={[{ preset: viewedShot.imageModel, resolution: viewedShot.resolution }]}
          />
        ) : (
          <>
            <UpscaleStill
              key={`up-${viewedShot.id}`}
              stillId={viewedShot.id}
              aspectRatio={shotFrame(viewedShot)}
              name={`film-still-${viewedShot.look}`}
              job={upscales[viewedShot.id] ?? null}
              onJob={(job) => setUpscaleJob(viewedShot.id, job)}
            />
            {upscaleOthers.map(([stillId, job]) => (
              <UpscaleStill
                key={`up-${stillId}`}
                stillId={stillId}
                aspectRatio={job.aspectRatio}
                name={job.name}
                job={job}
                onJob={(next) => setUpscaleJob(stillId, next)}
                earlier
              />
            ))}
          </>
        )}
      </div>
    ) : undefined;

  const strip =
    takes.length > 0 ? (
      <TakeStrip
        label="Takes"
        items={stripItems}
        value={focus === 'source' ? null : (viewedShot?.id ?? null)}
        onChange={(id) => setFocus(id ?? 'source')}
        next={{ thumb: source.src, title: source.name, ratio: source.width / source.height }}
        ticked={ticked}
        onTick={toggleTick}
        actions={
          ticked.size > 0 ? (
            <>
              <Button label="Clear ticks" size="sm" variant="ghost" onClick={() => setTicked(new Set())} />
              <Button
                label={`Compare ${tickedTakes.length}`}
                size="sm"
                isDisabled={!compare.ok}
                tooltip={compare.ok ? 'Compare side by side (C)' : compare.why}
                onClick={() => setBoard(true)}
              />
            </>
          ) : undefined
        }
      />
    ) : undefined;

  const controls = (
    <>
      <BenchGroup
        title="Render"
        description={
          marking
            ? 'Paint on the stage the area that may change. Press Done there when it is right.'
            : 'Drop an image on it, or replace it.'
        }
      >
        {!marking && (
          <ImageDropZone onFile={onFile} disabled={busy}>
            <figure className={mk.source} style={{ aspectRatio: `${source.width} / ${source.height}` }}>
              <img src={source.src} alt={`Source render: ${source.name}`} />
              {hasMark && <MaskOverlay strokes={strokes} />}
            </figure>
          </ImageDropZone>
        )}
        {!marking && (
          <div className={mk.row}>
            <Button
              label={hasMark ? 'Edit marked area' : 'Mark an area to edit'}
              size="sm"
              variant={hasMark ? 'secondary' : 'ghost'}
              icon={hasMark ? <Pencil size={14} /> : <SquareDashedMousePointer size={14} />}
              isDisabled={busy}
              onClick={() => setMarking(true)}
            />
            {hasMark && (
              <Button label="Remove mark" size="sm" variant="ghost" icon={<X size={14} />} isDisabled={busy} onClick={() => setStrokes([])} />
            )}
          </div>
        )}
        <Note>
          {source.name}, {source.width} × {source.height}
          {hasMark &&
            `. About ${Math.max(1, Math.round(markedShare * 100))}% marked: only that area will change, the rest is kept pixel for pixel.`}
        </Note>
      </BenchGroup>

      <Switch
        label="Only what's in the image"
        description={
          onlyInImage
            ? 'Nothing new appears: no added objects, buildings or places beyond the frame. People you ask for are the only addition.'
            : "Off: the model may add or reveal things the render doesn't show."
        }
        value={onlyInImage}
        onChange={setOnlyInImage}
        isDisabled={busy}
      />

      <BenchGroup title="Model" description="Which model develops the still, and how large.">
        <OptionSelect
          label="Image model"
          options={IMAGE_MODELS}
          value={imageModel}
          onChange={(id) => {
            const next = id as ImageModelId;
            setImageModel(next);
            setResolution(defaultImageResolution(next));
            // Keep the frame shape when the new model offers it.
            if (!imageModelHasAspect(next, aspectRatio)) setAspectRatio(MATCH_RENDER);
            setError(null);
          }}
          disabled={busy}
        />
        <div className={mk.pair}>
          <OptionSelect
            label="Resolution"
            options={imageResolutions(imageModel)}
            value={resolution}
            onChange={setResolution}
            disabled={busy || imageResolutions(imageModel).length < 2}
            showHint={false}
          />
          <OptionSelect
            label="Aspect ratio"
            options={imageAspectOptions(imageModel)}
            value={hasMark ? MATCH_RENDER : aspectRatio}
            onChange={setAspectRatio}
            disabled={busy || hasMark}
            disabledMessage={hasMark ? "A marked edit keeps the render's own frame." : undefined}
            showHint={false}
          />
        </div>
        {hasMark ? (
          <Note>A marked edit keeps the render&rsquo;s own frame.</Note>
        ) : (
          aspectRatio !== MATCH_RENDER && (
            <Note>A different shape crops in, or continues only what is already at the render&rsquo;s edges.</Note>
          )
        )}
      </BenchGroup>

      <BenchGroup
        title="Look"
        description={
          hasMark
            ? 'With a marked area, the look only shapes what changes inside it; the rest keeps the render’s light.'
            : usingLightRef
              ? 'Lit from your lighting reference. Remove it to pick a preset look.'
              : 'The light and grade the scene is shot in, from a preset or your own reference photo.'
        }
      >
        <OptionSelect
          label="Cinematic look"
          options={LOOKS}
          value={look}
          onChange={(id) => setLook(id as LookId)}
          disabled={busy || usingLightRef}
          disabledMessage={usingLightRef ? 'Lit from your lighting reference.' : undefined}
        />
        <LightReferenceField
          image={lightRef}
          uploading={lightUploading}
          error={lightError}
          lockedReason={
            hasMark ? 'Not used while an area is marked: the rest of the frame keeps the render’s own light.' : undefined
          }
          modelName={imageModelName(imageModel)}
          disabled={busy}
          onFile={(f) => void onLightFile(f)}
          onRemove={removeLightRef}
          stills={finishedStills.slice(0, 24).map(stillItem)}
          stillsLoading={library.isLoading}
          stillsError={library.error}
          onRetryStills={() => void library.refetch()}
          matched={matchedStill ? stillItem(matchedStill) : null}
          onMatch={(id) => {
            setMatchStillId(id);
            if (id) removeLightRef();
          }}
        />
      </BenchGroup>

      <BenchGroup
        title="Camera angle"
        description={
          hasMark
            ? 'A marked edit keeps the camera where it is, so the unmarked area can stay untouched.'
            : "Small moves around your render's own viewpoint, so only what is in the image appears."
        }
      >
        <OptionSelect
          label="Camera angle"
          labelHidden
          options={ANGLES}
          value={hasMark ? 'as-rendered' : angle}
          onChange={(id) => setAngle(id as AngleId)}
          disabled={busy || hasMark}
        />
      </BenchGroup>

      <BenchGroup title="People" description="Optional. Adds photoreal people, lit and scaled to match the scene.">
        <OptionSelect
          label="People in the shot"
          options={CROWDS}
          value={crowd}
          onChange={(id) => setCrowd(id as CrowdId)}
          disabled={busy}
        />
        {crowd !== 'none' && (
          <>
            <div className={mk.pair}>
              <OptionSelect label="Ethnicity" options={ETHNICITIES} value={ethnicity} onChange={(id) => setEthnicity(id as EthnicityId)} disabled={busy} showHint={false} />
              <OptionSelect label="Age range" options={AGES} value={age} onChange={(id) => setAge(id as AgeId)} disabled={busy} showHint={false} />
              <OptionSelect label="Wardrobe" options={WARDROBES} value={wardrobe} onChange={(id) => setWardrobe(id as WardrobeId)} disabled={busy} showHint={false} />
              <OptionSelect label="Activity" options={ACTIVITIES} value={activity} onChange={(id) => setActivity(id as ActivityId)} disabled={busy} showHint={false} />
            </div>
            <TextInput
              label="Anything else about them"
              value={people}
              onChange={(v: string) => setPeople(v.slice(0, 400))}
              isDisabled={busy}
              isOptional
              placeholder="For example: a woman reading on the pool edge"
              width="100%"
            />
            <CastSheetField
              sheet={cast}
              uploading={castUploading}
              error={castError}
              supported={castSupported}
              modelName={imageModelName(imageModel)}
              alternatives={castSheetModelNames()}
              disabled={busy}
              onFile={(f) => void onCastFile(f)}
              onRemove={removeCast}
            />
          </>
        )}
      </BenchGroup>

      <BenchGroup
        title="Extra direction"
        description={
          hasMark
            ? 'What should happen inside the marked area, for example: replace the paving with wet stone.'
            : 'Optional. Anything the shot should add or change.'
        }
      >
        <TextArea
          label="Extra direction"
          isLabelHidden
          value={direction}
          onChange={setDirection}
          rows={3}
          maxLength={DIRECTION_MAX}
          isDisabled={busy}
          placeholder="For example: a light breeze moving the leaves, warmer water reflections"
          width="100%"
        />
        {directionTooLong && (
          <Banner
            status="warning"
            title="Your extra direction is too long"
            description={`It is over ${DIRECTION_MAX} characters. Shorten it and try again.`}
          />
        )}
      </BenchGroup>
    </>
  );

  const foot = (
    <>
      <Buy items={priceItems}>
        <Button
          label={
            phase === 'uploading'
              ? 'Uploading…'
              : phase === 'submitting'
                ? 'Starting…'
                : rendering
                  ? 'Rendering…'
                  : hasMark
                    ? 'Edit the marked area'
                    : resultUrl
                      ? 'Make another take'
                      : 'Make it cinematic'
          }
          variant="primary"
          icon={<Sparkles size={16} />}
          width="100%"
          isLoading={busy}
          isDisabled={busy || spend.blocked || castUploading || lightUploading || planBlocked || unavailable || !maskFit.ok || directionTooLong}
          onClick={() => void run()}
        />
      </Buy>
      <Note>
        Uses {imageModelName(imageModel)} at {imageResolutionName(imageModel, resolution)}
        {aspectRatio !== MATCH_RENDER && !hasMark ? `, ${aspectRatio}` : ''}
        {hasMark ? ', changing only the marked area' : ''}. Each picture shows its price before you make it.
        {crowd !== 'none' && cast?.hostedUrl && castSupported && ' The cast sheet is sent as a second reference image.'}
        {usingLightRef &&
          (matchedStill
            ? ' Lit to match your chosen still, for a matching series.'
            : ' Lit from your lighting reference; only its light is used.')}
      </Note>
      {!maskFit.ok && <Banner status="warning" title="This model can't keep the render's frame" description={maskFit.reason} />}
      <ErrorNote error={shownError} />
    </>
  );

  return (
    <>
      <Workbench label="Still settings" saveId="stills-controls" controls={controls} foot={foot} stage={stage} strip={strip} side={sidePanel} />
      <CompareBoard
        isOpen={board && compare.ok}
        onClose={() => setBoard(false)}
        items={tickedTakes.map((t) => ({
          id: t.shot.id,
          kind: 'still' as const,
          src: stillViewUrl(t.shot.id),
          title: lookLabel(t.shot.look, litFromReference(t.shot)),
          detail: settingsLine(t.shot),
          ratio: ratioOf(shotFrame(t.shot)),
        }))}
        pickLabel="Put on the stage"
        onPick={(id) => {
          setFocus(id);
          setBoard(false);
        }}
      />
    </>
  );
}

/** The CSS aspect-ratio of a take: its chosen ratio, else the render's own. */
function frameOf(ratio: string, source: Source): string {
  const dims = ratio === MATCH_RENDER ? undefined : aspectDims(ratio);
  return dims ? `${dims.width} / ${dims.height}` : `${source.width} / ${source.height}`;
}

function shotFrame(shot: Shot): string {
  return frameOf(shot.aspectRatio, shot.source);
}

/** "2560 / 1440" as a number, width over height. */
function ratioOf(frame: string): number {
  const [w, h] = frame.split('/').map((n) => Number(n.trim()));
  return w && h ? w / h : 16 / 9;
}
