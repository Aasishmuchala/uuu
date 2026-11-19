import { Clapperboard, Columns2, Download, ImageUpscale, MapPinned, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Still } from '../api.ts';
import {
  formatCoords,
  LIGHTS,
  type LocationLightId,
  type LocationViewId,
  locationName,
  VIEWS,
} from '../location.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutions,
  type ImageModelId,
  STILL_UPSCALERS,
  type StillUpscalerId,
  UPSCALE_FACTORS,
  type UpscaleFactor,
  upscalerName,
} from '../models.ts';
import { ratioOf } from './director/shared.ts';
import { Banner, Button, IconButton, Switch, Text, TextArea, TextInput, ToggleButton } from './kit.ts';
import { canCompare } from './lib/compare.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
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
import { UpscaleStill, type UpscaleJob } from './UpscaleStill.tsx';
import own from './LocationPage.module.css';

const DIRECTION_MAX = 600;
const PLACE_MAX = 120;
const TAKE_KEY = 'render-to-film:location-take';

type Upload = { src: string; name: string; width: number; height: number; hostedUrl?: string | undefined };

/** The take on the stage: its id, the screenshot it was made from, and its automatic upscale. */
type Take = {
  id: string;
  before?: string | undefined;
  width: number;
  height: number;
  place: string;
  /** Set on a fresh take when "upscale automatically" was on: what to upscale it with. */
  auto?: { upscaler: StillUpscalerId; factor: UpscaleFactor } | undefined;
  /** The automatic upscale's job id, kept so a reload resumes it. */
  upscale?: { id: string } | undefined;
};

export type LocationPageProps = {
  /** Whether this screen is on screen; a hidden one skips the library poll and its keys. */
  active: boolean;
  /** Animate a finished take on the Video screen. */
  onAnimate: (stillId: string) => void;
};

function readTake(): Take | null {
  try {
    const raw = sessionStorage.getItem(TAKE_KEY);
    return raw ? (JSON.parse(raw) as Take) : null;
  } catch {
    return null;
  }
}

/** A model's largest resolution: the biggest numeric id ("4K"), else the last listed. */
function highestResolution(model: ImageModelId): string {
  const list = imageResolutions(model);
  let best = list[list.length - 1]?.id ?? defaultImageResolution(model);
  let bestN = -1;
  for (const r of list) {
    const n = Number.parseFloat(r.id);
    if (Number.isFinite(n) && n > bestN) {
      bestN = n;
      best = r.id;
    }
  }
  return best;
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
// Between the two numbers: a comma with a space after it, a semicolon or a space. A bare comma
// counts only between two decimals ("12.97,77.59"), so a decimal comma ("12,9716") stays one number.
const SEP = String.raw`(?:\s*,\s+|\s*;\s*|\s+|(?<=\.\d+)\s*,(?=\s*-?\d+\.))`;
const PAIR = new RegExp(String.raw`^\s*${NUM}\s*°?\s*([NSns])?${SEP}${NUM}\s*°?\s*([EWew])?\s*$`);

/** "12.9716, 77.5946" (the Google Earth and Maps copy format) as two numbers, or null. */
function parsePair(text: string): { lat: string; lng: string } | null {
  const m = PAIR.exec(text);
  if (!m) return null;
  const [, a = '', ns = '', b = '', ew = ''] = m;
  const lat = ns.toUpperCase() === 'S' && !a.startsWith('-') ? `-${a}` : a;
  const lng = ew.toUpperCase() === 'W' && !b.startsWith('-') ? `-${b}` : b;
  return { lat, lng };
}

/** The number typed, or null when empty or not a number. */
function toNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rangeError(text: string, min: number, max: number, name: string): string | null {
  if (!text.trim()) return null;
  const n = toNumber(text);
  if (n === null) return `${name} must be a number, like 12.9716.`;
  if (n < min || n > max) return `${name} must be between ${min} and ${max}.`;
  return null;
}

export function LocationPage({ active, onAnimate }: LocationPageProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (active && q.state.data?.stills.some((s) => s.status === 'pending') ? 8_000 : false),
  });
  const saver = useDownload();
  const star = useStar();

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [place, setPlace] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  const uploadSrc = useRef<string | undefined>(undefined);
  uploadSrc.current = upload?.src;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [view, setView] = useState<LocationViewId>('match');
  const [light, setLight] = useState<LocationLightId>('match');
  const [direction, setDirection] = useState('');
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(() => highestResolution('nano-banana-pro'));
  // Off at first: the texture upscaler (Higgsfield 4K) has no price on this Mac
  // yet, so on by default it would hold the button for a step the owner did not ask for.
  const [autoUpscale, setAutoUpscale] = useState(false);
  const [upscaler, setUpscaler] = useState<StillUpscalerId>('creative');
  const [factor, setFactor] = useState<UpscaleFactor>(2);
  const [take, setTake] = useState<Take | null>(readTake);
  const [manualJob, setManualJob] = useState<UpscaleJob | null>(null);
  const [comparing, setComparing] = useState(true);
  const [side, setSide] = useState(false);
  const [full, setFull] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [board, setBoard] = useState(false);
  const upscaleStarted = useRef<string | null>(null);
  // Screenshots picked since the page loaded; a blob from an earlier visit is gone after a reload.
  const liveBlobs = useRef(new Set<string>());
  const takeBefore = useRef<string | undefined>(undefined);

  // When the take moves on, free its screenshot unless it's still the current upload.
  useEffect(() => {
    const prev = takeBefore.current;
    takeBefore.current = take?.before;
    if (prev && prev !== take?.before && prev !== uploadSrc.current && liveBlobs.current.delete(prev)) {
      URL.revokeObjectURL(prev);
    }
  }, [take?.before]);

  useEffect(() => {
    try {
      if (take) sessionStorage.setItem(TAKE_KEY, JSON.stringify(take));
      else sessionStorage.removeItem(TAKE_KEY);
    } catch {
      // Private mode: the take just won't survive a reload.
    }
  }, [take]);

  const create = trpc.location.create.useMutation();
  const upscale = trpc.upscaleStill.useMutation();
  const status = trpc.shotStatus.useQuery(
    { id: take?.id ?? '' },
    {
      enabled: take !== null,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const upscaleId = take?.upscale?.id;
  const upscaleStatus = trpc.shotStatus.useQuery(
    { id: upscaleId ?? '' },
    {
      enabled: upscaleId !== undefined,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );

  const finished = status.data?.done === true;
  const resultUrl = finished ? status.data?.url : undefined;
  const upscaleDone = upscaleStatus.data?.done === true;
  const upscaledUrl = upscaleDone ? upscaleStatus.data?.url : undefined;

  const doneId = finished ? take?.id : undefined;
  useEffect(() => {
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);
  const upscaleDoneId = upscaledUrl ? upscaleId : undefined;
  useEffect(() => {
    if (upscaleDoneId) void utils.library.invalidate();
  }, [upscaleDoneId, utils]);

  const startUpscale = useCallback(
    async (t: Take) => {
      if (!t.auto) return;
      try {
        const { id } = await upscale.mutateAsync({ stillId: t.id, upscaler: t.auto.upscaler, factor: t.auto.factor });
        setTake((cur) => (cur && cur.id === t.id ? { ...cur, upscale: { id } } : cur));
      } catch {
        // Shown beside the picture from upscale.error.
      }
    },
    [upscale]
  );

  // Once the render is done, upscale it once: the ref is keyed on the take id.
  useEffect(() => {
    if (!take || !take.auto || take.upscale || !finished || !resultUrl) return;
    if (upscaleStarted.current === take.id) return;
    upscaleStarted.current = take.id;
    void startUpscale(take);
  }, [take, finished, resultUrl, startUpscale]);

  function retryUpscale() {
    if (!take?.auto) return;
    upscale.reset();
    upscaleStarted.current = take.id;
    const next: Take = { ...take, upscale: undefined };
    setTake(next);
    void startUpscale(next);
  }

  /** Every finished location take, newest first: the take strip. */
  const locations = useMemo(
    () => (library.data?.stills ?? []).filter((s) => s.location && !s.upscaleOf && s.status === 'succeeded').slice(0, 24),
    [library.data]
  );
  const libUpscale = take
    ? library.data?.stills.find((s) => s.upscaleOf === take.id && s.status === 'succeeded')
    : undefined;

  const latError = rangeError(lat, -90, 90, 'Latitude');
  const lngError = rangeError(lng, -180, 180, 'Longitude');
  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);
  const coordsOk = latNum !== null && lngNum !== null && !latError && !lngError;
  const directionTooLong = direction.length > DIRECTION_MAX;
  // A 4K render upscaled 4× is past what the stored copies can be made from, so 4K stops at 2×.
  const fourK = imageResolutions(imageModel).find((r) => r.id === resolution)?.name === '4K';
  const factorChoices = fourK ? UPSCALE_FACTORS.filter((f) => f.id === '2') : UPSCALE_FACTORS;
  const useFactor: UpscaleFactor = fourK ? 2 : factor;
  const rendering = take !== null && !finished;
  const statusErr = status.error ? classifyRunwayError(status.error) : null;
  // The picture, and its upscale when "make it larger" is on.
  const priceItems = [
    { preset: imageModel, resolution },
    ...(autoUpscale ? [{ preset: upscaler, scale: useFactor }] : []),
  ];
  const spend = useSpend(priceItems);
  const retryItems = [{ preset: take?.auto?.upscaler ?? upscaler, scale: take?.auto?.factor ?? useFactor }];
  const retrySpend = useSpend(retryItems);
  const busy = create.isPending || rendering;
  const ready = coordsOk && Boolean(upload?.hostedUrl);
  const takeError = finished && !resultUrl ? (status.data?.error ?? 'The take did not return an image. Try again.') : undefined;

  const upscaleFailed = upscaleDone && !upscaledUrl;
  const upscaleError = upscale.error ?? upscaleStatus.error;
  // Only the status check failed: the upscale may still be running, so check again rather than pay twice.
  const upscalePollError = !upscale.error && upscaleStatus.error !== null && !upscaleDone;
  const upscaling =
    take?.auto !== undefined &&
    finished &&
    Boolean(resultUrl) &&
    !upscaledUrl &&
    !upscaleFailed &&
    !upscaleError;
  const bestId = upscaledUrl && upscaleId ? upscaleId : (libUpscale?.id ?? take?.id);
  const bestIsUpscale = bestId !== undefined && bestId !== take?.id;
  const bestFactor = upscaledUrl ? take?.auto?.factor : libUpscale?.scale;

  function setCoord(which: 'lat' | 'lng', value: string) {
    // Split a pair only when it arrives at once (a paste), not while it is typed key by key.
    const prev = which === 'lat' ? lat : lng;
    const pair = value.length - prev.length > 1 ? parsePair(value) : null;
    if (pair) {
      setLat(pair.lat);
      setLng(pair.lng);
    } else if (which === 'lat') setLat(value);
    else setLng(value);
  }

  async function onFile(file: File) {
    setUploadError(null);
    const src = URL.createObjectURL(file);
    liveBlobs.current.add(src);
    let width: number;
    let height: number;
    try {
      const bitmap = await createImageBitmap(file);
      ({ width, height } = bitmap);
      bitmap.close();
    } catch {
      liveBlobs.current.delete(src);
      URL.revokeObjectURL(src);
      setUploadError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
      return;
    }
    setUpload((prev) => {
      if (prev && prev.src !== take?.before && liveBlobs.current.delete(prev.src)) URL.revokeObjectURL(prev.src);
      return { src, name: file.name, width, height };
    });
    setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setUpload((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      setUpload((cur) => {
        if (cur?.src !== src) return cur;
        if (src !== takeBefore.current && liveBlobs.current.delete(src)) URL.revokeObjectURL(src);
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
    if (!ready || busy || directionTooLong || !upload?.hostedUrl || latNum === null || lngNum === null) return;
    upscale.reset();
    try {
      const { id, width, height } = await create.mutateAsync({
        url: upload.hostedUrl,
        width: upload.width,
        height: upload.height,
        lat: latNum,
        lng: lngNum,
        place: place.trim(),
        view,
        light,
        direction,
        imageModel,
        resolution,
      });
      setManualJob(null);
      setSide(false);
      setTake({
        id,
        before: upload.src,
        width,
        height,
        place: locationName({ lat: latNum, lng: lngNum, place }),
        auto: autoUpscale ? { upscaler, factor: useFactor } : undefined,
      });
      void utils.library.invalidate();
    } catch {
      // Shown under the button from create.error.
    }
  }

  const showEarlier = useCallback(
    (s: Still) => {
      upscale.reset();
      setManualJob(null);
      setSide(false);
      setTake({
        id: s.id,
        width: s.width,
        height: s.height,
        place: s.location ? locationName(s.location) : 'Location',
      });
    },
    [upscale]
  );

  // With nothing on the stage, the newest location take is shown: reading only, nothing is sent.
  const showedNewest = useRef(false);
  useEffect(() => {
    if (showedNewest.current || take || upload || !locations[0]) return;
    showedNewest.current = true;
    showEarlier(locations[0]);
  }, [take, upload, locations, showEarlier]);

  /** "Reuse settings": the take's place, view, light, direction and model fill the form. Nothing is sent. */
  function reuse(s: Still) {
    const loc = s.location;
    if (!loc) return;
    setLat(String(loc.lat));
    setLng(String(loc.lng));
    setPlace((loc.place ?? '').slice(0, PLACE_MAX));
    if (VIEWS.some((v) => v.id === loc.view)) setView(loc.view);
    if (LIGHTS.some((l) => l.id === loc.light)) setLight(loc.light);
    setDirection((s.direction ?? '').slice(0, DIRECTION_MAX));
    if (IMAGE_MODELS.some((m) => m.id === s.imageModel)) {
      setImageModel(s.imageModel);
      const res = s.resolution && imageResolutions(s.imageModel).some((r) => r.id === s.resolution);
      setResolution(res ? s.resolution! : highestResolution(s.imageModel));
    }
  }

  const ratio = take ? ratioOf(take.width, take.height) : upload ? ratioOf(upload.width, upload.height) : 16 / 9;
  const aspect = take ? `${take.width} / ${take.height}` : upload ? `${upload.width} / ${upload.height}` : '16 / 9';
  // A blob from an earlier visit is gone after a reload; compare only with a live source.
  const before =
    take?.before && (!take.before.startsWith('blob:') || liveBlobs.current.has(take.before)) ? take.before : undefined;
  const shownName = take?.place ?? 'Location';
  const factorLabel = bestFactor ? `-${bestFactor}x` : '';
  const hasUpscaleCopy = bestIsUpscale;
  const shownStill = take ? library.data?.stills.find((s) => s.id === take.id) : undefined;
  const showResult = Boolean(take && resultUrl && !upscaling && bestId);

  // ---- The take strip: every location take, newest first, with the one in progress.
  const stripItems: TakeStripItem[] = [
    ...(take && !locations.some((s) => s.id === take.id)
      ? [
          {
            id: take.id,
            kind: 'still' as const,
            thumb: resultUrl ? stillThumbUrl(take.id) : before,
            title: take.place,
            state: rendering ? ('rendering' as const) : takeError ? ('failed' as const) : ('ready' as const),
            ratio,
            progress: rendering ? status.data?.progress : undefined,
          },
        ]
      : []),
    ...locations.map((s) => ({
      id: s.id,
      kind: 'still' as const,
      thumb: stillThumbUrl(s.id),
      title: s.location ? locationName(s.location) : 'Location',
      state: 'ready' as const,
      ratio: ratioOf(s.width, s.height),
      since: Date.parse(s.createdAt) || undefined,
    })),
  ];
  const tickedStills = locations.filter((s) => ticked.has(s.id));
  const compare = canCompare(tickedStills.map(() => ({ kind: 'still' as const })));
  const order = stripItems.map((i) => i.id);
  const at = take ? order.indexOf(take.id) : -1;
  const step = (by: -1 | 1) => {
    const next = locations.find((s) => s.id === order[at + by]);
    if (next) showEarlier(next);
  };

  useKeys(
    [
      { key: 'ArrowLeft', onKey: () => step(-1), disabled: at < 0 || busy },
      { key: 'ArrowRight', onKey: () => step(1), disabled: at < 0 || busy },
      { key: 's', onKey: () => take && star.toggle('still', take.id), disabled: !showResult },
      { key: 'c', onKey: () => (compare.ok ? setBoard(true) : setComparing((v) => !v)), disabled: !showResult && !compare.ok },
      { key: 'f', onKey: () => setFull(true), disabled: !showResult },
    ],
    active
  );

  const buttonLabel = create.isPending
    ? 'Starting the render…'
    : rendering
      ? 'Rendering the location…'
      : uploading
        ? 'Uploading the screenshot…'
        : directionTooLong
          ? 'Shorten the direction first'
          : !upload
            ? 'Upload a screenshot first'
            : !coordsOk
              ? 'Enter the coordinates first'
              : 'Render location';

  // ---- The stage.
  const stage = (
    <Stage
      title={take ? shownName : 'Location'}
      caption={
        take
          ? showResult
            ? `Saved to your library, tagged @location${hasUpscaleCopy && bestFactor ? `, upscaled ${bestFactor}×` : ''}`
            : undefined
          : upload
            ? `${upload.name}, ${upload.width} × ${upload.height}`
            : 'A Google Earth screenshot, made into a photograph of the same place'
      }
      actions={
        take && showResult && bestId ? (
          <>
            {before && (
              <ToggleButton
                label="Compare with your screenshot"
                tooltip="Compare with your screenshot (C)"
                size="sm"
                isIconOnly
                icon={<Columns2 size={16} />}
                isPressed={comparing}
                onPressedChange={(on: boolean) => setComparing(on)}
              />
            )}
            <FullSize
              src={libraryUrl('still', bestId)}
              kind="still"
              title={shownName}
              alt={`Location still: ${shownName}`}
              iconOnly
              isOpen={full}
              onOpenChange={setFull}
            />
            <StarButton kind="still" id={take.id} />
            <IconButton
              label={saver.pending ? saver.label(hasUpscaleCopy ? 'Download upscaled' : 'Download') : hasUpscaleCopy ? 'Download upscaled' : 'Download'}
              tooltip={saver.pending ? saver.label('Download') : hasUpscaleCopy ? 'Download upscaled' : 'Download'}
              size="sm"
              variant="ghost"
              isLoading={saver.pending}
              icon={<Download size={16} />}
              onClick={() => saver.start(libraryUrl('still', bestId), `location-${slugify(shownName)}${factorLabel}.png`)}
            />
            {shownStill?.location && (
              <IconButton
                label="Reuse settings"
                tooltip="Fill the form with how this was made"
                size="sm"
                variant="ghost"
                icon={<SlidersHorizontal size={16} />}
                isDisabled={busy}
                onClick={() => reuse(shownStill)}
              />
            )}
            {!take.auto && !hasUpscaleCopy && (
              <ToggleButton
                label="Upscale"
                tooltip="Upscale"
                size="sm"
                isIconOnly
                icon={<ImageUpscale size={16} />}
                isPressed={side}
                onPressedChange={(on: boolean) => setSide(on)}
              />
            )}
            <span className={own.gap} />
            <Button label="Make a video" size="sm" icon={<Clapperboard size={16} />} onClick={() => onAnimate(bestId)} />
          </>
        ) : undefined
      }
      below={
        <>
          {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
          {take && showResult && (upscaleError || upscaleFailed) && (
            <div className={own.upscaleError}>
              <ErrorNote error={upscaleError ?? { message: upscaleStatus.data?.error ?? 'The upscale did not return an image.' }} />
              {upscalePollError ? (
                <Button
                  label="Check again"
                  size="sm"
                  isLoading={upscaleStatus.isFetching}
                  onClick={() => void upscaleStatus.refetch()}
                />
              ) : (
                <Buy items={retryItems}>
                  <Button label="Retry the upscale" size="sm" isDisabled={retrySpend.blocked} onClick={retryUpscale} />
                </Buy>
              )}
            </div>
          )}
          {take && rendering && status.error && (
            <Banner
              status="warning"
              title="Lost track of the take"
              description={`${statusErr?.message ?? 'The status check failed.'} The render may still be running, so check again before starting another.`}
              endContent={
                <span className={own.row}>
                  <Button label="Check again" size="sm" isLoading={status.isFetching} onClick={() => void status.refetch()} />
                  <Button label="Stop waiting" size="sm" variant="ghost" onClick={() => setTake(null)} />
                </span>
              }
            />
          )}
          {takeError && <Banner status="error" title="The take didn't finish" description={takeError} />}
        </>
      }
    >
      {showResult && bestId ? (
        <StageFrame ratio={ratio}>
          {before && comparing ? (
            <CompareSlider
              before={before}
              after={stillViewUrl(bestId)}
              afterFallback={stillThumbUrl(bestId)}
              beforeAlt="The Google Earth screenshot"
              afterAlt={`Photoreal aerial photograph of ${shownName}`}
              beforeLabel="Screenshot"
              afterLabel="Photograph"
            />
          ) : (
            <img src={stillViewUrl(bestId)} alt={`Photoreal aerial photograph of ${shownName}`} decoding="async" />
          )}
        </StageFrame>
      ) : (rendering && !status.error) || create.isPending || upscaling ? (
        <StageFrame ratio={ratio} dim>
          {(before ?? upload?.src) && <img src={before ?? upload!.src} alt="The screenshot being rendered" />}
          <StageWorking
            label={
              create.isPending
                ? 'Starting the take'
                : upscaling
                  ? `Upscaling ${take?.auto?.factor ?? useFactor}× for detailed textures`
                  : 'Rendering the location'
            }
            progress={upscaling ? upscaleStatus.data?.progress : status.data?.progress}
            runKey={upscaling ? (upscaleId ?? take?.id) : take?.id}
          />
        </StageFrame>
      ) : upload ? (
        <StageFrame ratio={ratioOf(upload.width, upload.height)}>
          <img src={upload.src} alt="The screenshot to render" decoding="async" />
        </StageFrame>
      ) : (
        <StageEmpty
          title="Your photoreal location will appear here"
          hint="Drop a Google Earth screenshot, enter where it was taken, then press Render location."
        />
      )}
    </Stage>
  );

  const sidePanel =
    side && take && showResult && !take.auto && !hasUpscaleCopy ? (
      <UpscaleStill
        key={`up-${take.id}`}
        stillId={take.id}
        aspectRatio={aspect}
        name={`location-${slugify(shownName)}`}
        job={manualJob}
        onJob={setManualJob}
      />
    ) : undefined;

  const strip =
    stripItems.length > 0 ? (
      <TakeStrip
        label="Locations"
        items={stripItems}
        value={take?.id ?? null}
        onChange={(id) => {
          const s = locations.find((x) => x.id === id);
          if (s && !busy) showEarlier(s);
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
                label={`Compare ${tickedStills.length}`}
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

  // ---- The controls: the screenshot and the place lead.
  const controls = (
    <>
      <BenchGroup
        title="Screenshot"
        description="A Google Earth screenshot of the spot, with labels and the interface turned off if possible."
      >
        <ImageDropZone
          onFile={(f) => void onFile(f)}
          disabled={busy || uploading}
          actionLabel={upload ? 'Replace screenshot' : 'Choose a screenshot'}
        >
          {upload ? (
            <figure className={own.source} style={{ aspectRatio: `${upload.width} / ${upload.height}` }}>
              <img src={upload.src} alt={`Uploaded screenshot: ${upload.name}`} data-dim={uploading || undefined} />
            </figure>
          ) : (
            <div className={own.drop}>
              <MapPinned size={18} aria-hidden />
              <Text type="supporting">Drop your Google Earth screenshot here.</Text>
            </div>
          )}
        </ImageDropZone>
        {uploading && <Note>Uploading the screenshot…</Note>}
        <ErrorNote error={uploadError} />
      </BenchGroup>

      <BenchGroup title="Place" description="Where the screenshot was taken, in decimal degrees.">
        <div className={own.pair}>
          <TextInput
            label="Latitude"
            value={lat}
            onChange={(v: string) => setCoord('lat', v)}
            placeholder="For example 51.5072"
            isDisabled={busy}
            status={latError ? { type: 'error', message: latError } : undefined}
            statusVariant="detached"
            inputMode="decimal"
            width="100%"
          />
          <TextInput
            label="Longitude"
            value={lng}
            onChange={(v: string) => setCoord('lng', v)}
            placeholder="For example -0.1276"
            isDisabled={busy}
            status={lngError ? { type: 'error', message: lngError } : undefined}
            statusVariant="detached"
            inputMode="decimal"
            width="100%"
          />
        </div>
        <TextInput
          label="Place name"
          isOptional
          value={place}
          onChange={(v: string) => setPlace(v.slice(0, PLACE_MAX))}
          placeholder="For example: Kensington, London"
          isDisabled={busy}
          width="100%"
        />
        <Note>
          {coordsOk && latNum !== null && lngNum !== null
            ? formatCoords(latNum, lngNum)
            : 'Paste "12.9716, 77.5946" into either field to fill both.'}
        </Note>
      </BenchGroup>

      <BenchGroup title="View and light" description="Small moves only. Nothing new is added to the site.">
        <OptionSelect label="View" options={VIEWS} value={view} onChange={(id) => setView(id as LocationViewId)} disabled={busy} />
        <OptionSelect label="Light" options={LIGHTS} value={light} onChange={(id) => setLight(id as LocationLightId)} disabled={busy} />
        <TextArea
          label="Extra direction"
          isOptional
          value={direction}
          onChange={setDirection}
          rows={3}
          maxLength={DIRECTION_MAX}
          isDisabled={busy}
          placeholder="For example: autumn, wet pavements, lamps on"
          width="100%"
        />
      </BenchGroup>

      <BenchGroup title="Model" description="Re-draws the screenshot as a photograph.">
        <div className={own.pair}>
          <OptionSelect
            label="Image model"
            options={IMAGE_MODELS}
            value={imageModel}
            onChange={(id) => {
              const m = id as ImageModelId;
              setImageModel(m);
              setResolution(highestResolution(m));
            }}
            disabled={busy}
            showHint={false}
          />
          <OptionSelect
            label="Resolution"
            options={imageResolutions(imageModel)}
            value={resolution}
            onChange={setResolution}
            disabled={busy || imageResolutions(imageModel).length < 2}
            showHint={false}
          />
        </div>
      </BenchGroup>

      <BenchGroup title="Upscale" description="Adds fine texture to the finished render.">
        <Switch
          label="Upscale automatically when the render is done"
          description="Off: you can upscale the result by hand."
          value={autoUpscale}
          onChange={setAutoUpscale}
          isDisabled={busy}
        />
        {autoUpscale && (
          <div className={own.pair}>
            <OptionSelect
              label="Upscaler"
              options={STILL_UPSCALERS}
              value={upscaler}
              onChange={(id) => setUpscaler(id as StillUpscalerId)}
              disabled={busy}
              showHint={false}
            />
            <OptionSelect
              label="Scale"
              options={factorChoices}
              value={String(useFactor)}
              onChange={(id) => setFactor(id === '4' ? 4 : 2)}
              disabled={busy}
              showHint={false}
            />
          </div>
        )}
      </BenchGroup>
    </>
  );

  const foot = (
    <>
      <Buy items={priceItems}>
        <Button
          label={buttonLabel}
          variant="primary"
          icon={<MapPinned size={16} />}
          width="100%"
          isLoading={busy}
          isDisabled={!ready || directionTooLong || spend.blocked}
          onClick={() => void run()}
        />
      </Buy>
      <Note>
        {imageModelName(imageModel)}
        {autoUpscale ? `, then upscaled ${useFactor}× with ${upscalerName(upscaler)}` : ''}. Each picture shows its price
        before you make it.
      </Note>
      <ErrorNote error={create.error} />
    </>
  );

  return (
    <>
      <Workbench
        label="Location settings"
        saveId="location-controls"
        controls={controls}
        foot={foot}
        stage={stage}
        strip={strip}
        side={sidePanel}
      />
      <CompareBoard
        isOpen={board && compare.ok}
        onClose={() => setBoard(false)}
        items={tickedStills.map((s) => ({
          id: s.id,
          kind: 'still' as const,
          src: stillViewUrl(s.id),
          title: s.location ? locationName(s.location) : 'Location',
          ratio: ratioOf(s.width, s.height),
        }))}
        pickLabel="Put on the stage"
        onPick={(id) => {
          const s = locations.find((x) => x.id === id);
          if (s && !busy) showEarlier(s);
          setBoard(false);
        }}
      />
    </>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'location';
}
