import { ImagePlus, Plus, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Still } from '../api.ts';
import { Banner, Button, IconButton, Spinner, Text, Tooltip } from './kit.ts';
import { errorMessage } from './lib/runwayErrors.ts';
import { stillTitle } from './lib/titles.ts';
import { stillThumbUrl } from './lib/urls.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { StillPicker } from './parts/StillPicker.tsx';
import styles from './parts/Frames.module.css';

/**
 * One image for a clip: a library still (`stillId`, signed by the server) or
 * an upload (`uploadUrl`, from POST /api/upload, ready once `uploading` ends).
 */
export type FrameImage = {
  key: string;
  src: string;
  name: string;
  stillId?: string | undefined;
  uploadUrl?: string | undefined;
  uploading?: boolean | undefined;
  /** An upload's own pixel size, so a clip can take the shape of its first frame. */
  width?: number | undefined;
  height?: number | undefined;
};

/** A frame between first and last; `at` is how far into the clip, 0 to 1. */
export type MiddleFrame = FrameImage & { at: number };

export type Slot = 'first' | 'last' | 'middle' | 'ref';

type FrameState = {
  first: FrameImage | null;
  last: FrameImage | null;
  middle: MiddleFrame[];
  refs: FrameImage[];
};

const EMPTY: FrameState = { first: null, last: null, middle: [], refs: [] };

const tenth = (at: number) => Math.min(9, Math.max(1, Math.round(at * 10)));

/**
 * Add a frame in between without moving the others: it takes the free tenth
 * of the clip that sits farthest from every frame already placed (and from
 * the clip's start and end), so it lands in the largest gap.
 */
function insertInLargestGap(middle: MiddleFrame[], img: FrameImage): MiddleFrame[] {
  const taken = [0, 10, ...middle.map((m) => tenth(m.at))];
  let best = 5;
  let bestGap = -1;
  for (let t = 1; t <= 9; t++) {
    if (taken.includes(t)) continue;
    const gap = Math.min(...taken.map((x) => Math.abs(x - t)));
    if (gap > bestGap) {
      best = t;
      bestGap = gap;
    }
  }
  return [...middle, { ...img, at: best / 10 }].sort((a, b) => a.at - b.at);
}

/** Keys of in-between frames that share a point in the clip with another. */
export function duplicateMiddle(middle: readonly MiddleFrame[]): Set<string> {
  const out = new Set<string>();
  middle.forEach((m, i) => {
    if (middle.some((o, j) => j !== i && tenth(o.at) === tenth(m.at))) out.add(m.key);
  });
  return out;
}

let counter = 0;
const nextKey = () => `frame-${Date.now().toString(36)}-${counter++}`;

function revoke(img: FrameImage | null | undefined) {
  if (img?.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

/** The images picked on the Video tab: frames, in-between frames and extras. */
export function useVideoFrames() {
  const [state, setState] = useState<FrameState>(EMPTY);
  const [frameError, setFrameError] = useState<unknown>(null);
  const [refError, setRefError] = useState<unknown>(null);
  const live = useRef(state);
  live.current = state;
  useEffect(
    () => () => {
      const s = live.current;
      [s.first, s.last, ...s.middle, ...s.refs].forEach(revoke);
    },
    []
  );

  const place = useCallback((slot: Slot, img: FrameImage) => {
    setState((s) => {
      switch (slot) {
        case 'first':
          revoke(s.first);
          return { ...s, first: img };
        case 'last':
          revoke(s.last);
          return { ...s, last: img };
        case 'middle':
          return { ...s, middle: insertInLargestGap(s.middle, img) };
        case 'ref':
          return { ...s, refs: [...s.refs, img] };
      }
    });
  }, []);

  const patch = useCallback((key: string, p: Partial<FrameImage>) => {
    const upd = <T extends FrameImage>(i: T): T => (i.key === key ? { ...i, ...p } : i);
    setState((s) => ({
      first: s.first && upd(s.first),
      last: s.last && upd(s.last),
      middle: s.middle.map(upd),
      refs: s.refs.map(upd),
    }));
  }, []);

  const remove = useCallback((key: string) => {
    setState((s) => {
      const hit = [s.first, s.last, ...s.middle, ...s.refs].find((i) => i?.key === key);
      revoke(hit);
      return {
        first: s.first?.key === key ? null : s.first,
        last: s.last?.key === key ? null : s.last,
        middle: s.middle.filter((m) => m.key !== key),
        refs: s.refs.filter((r) => r.key !== key),
      };
    });
  }, []);

  const setAt = useCallback((key: string, at: number) => {
    setState((s) => ({
      ...s,
      middle: s.middle.map((m) => (m.key === key ? { ...m, at } : m)).sort((a, b) => a.at - b.at),
    }));
  }, []);

  const addStill = useCallback(
    (slot: Slot, still: { id: string; src: string; name: string }) => {
      place(slot, { key: nextKey(), src: still.src, name: still.name, stillId: still.id });
    },
    [place]
  );

  const addFile = useCallback(
    async (slot: Slot, file: File) => {
      const setErr = slot === 'ref' ? setRefError : setFrameError;
      setErr(null);
      const key = nextKey();
      place(slot, { key, src: URL.createObjectURL(file), name: file.name, uploading: true });
      try {
        const { width, height } = await measure(file);
        const uploadUrl = await uploadRender(file);
        patch(key, { uploadUrl, uploading: false, width, height });
      } catch (e) {
        remove(key);
        setErr(
          isUploadFailure(e)
            ? { message: e.message }
            : e instanceof Error
              ? e
              : { message: 'That image could not be uploaded. Try again.' }
        );
      }
    },
    [place, patch, remove]
  );

  return {
    ...state,
    frameError,
    refError,
    clearErrors: () => {
      setFrameError(null);
      setRefError(null);
    },
    uploading: [state.first, state.last, ...state.middle, ...state.refs].some((i) => i?.uploading),
    addStill,
    addFile,
    remove,
    setAt,
  };
}

export type VideoFramesApi = ReturnType<typeof useVideoFrames>;

/** An image file's own pixel size. */
async function measure(file: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new Error('That file could not be read as an image. Use a PNG, JPEG or WebP.');
  }
}

/**
 * The wire form of the first frame: a still id, or an upload with its pixel
 * size (the clip is shaped like this frame).
 */
export function firstFrameRef(
  img: FrameImage
): { stillId: string } | { uploadUrl: string; width: number; height: number } | null {
  if (img.stillId) return { stillId: img.stillId };
  return img.uploadUrl && img.width && img.height
    ? { uploadUrl: img.uploadUrl, width: img.width, height: img.height }
    : null;
}

/** The wire form of an image: a still id or an uploaded URL. */
export function frameRef(img: FrameImage): { stillId: string } | { uploadUrl: string } | null {
  if (img.stillId) return { stillId: img.stillId };
  return img.uploadUrl ? { uploadUrl: img.uploadUrl } : null;
}

type ChooserTarget = { slot: Slot; title: string };

function Thumb({ img, alt }: { img: FrameImage; alt: string }) {
  return (
    <figure className={styles.thumb}>
      <img src={img.src} alt={alt} data-dim={img.uploading ? '' : undefined} />
      {img.uploading && (
        <span className={styles.busy} role="status">
          <Spinner size="sm" shade="onMedia" aria-label="Uploading" />
        </span>
      )}
    </figure>
  );
}

function UploadError({ error, title }: { error: unknown; title: string }) {
  if (error == null) return null;
  return <Banner status="error" title={title} description={errorMessage(error)} />;
}

/** One frame of the shot: its picture, its name, where it sits and what can be done with it. */
function FrameRow({
  img,
  alt,
  title,
  name,
  children,
  locked = false,
}: {
  img: FrameImage;
  alt: string;
  title: string;
  name: string;
  children?: ReactNode;
  locked?: boolean;
}) {
  return (
    <div className={styles.row} data-locked={locked || undefined}>
      <Thumb img={img} alt={alt} />
      <div className={styles.body}>
        <Text type="label">{title}</Text>
        <Text type="supporting" maxLines={1}>
          {name}
        </Text>
        <div className={styles.rowActions}>{children}</div>
      </div>
    </div>
  );
}

export type FramesFieldProps = {
  frames: VideoFramesApi;
  modelName: string;
  /** Most ordered frames the model takes (first + in between + last). */
  limit: number;
  seconds: number;
  /** The still picked for the shot, the default first frame. */
  picked: { src: string; name: string } | null;
  /** Finished stills to choose a frame from. */
  stills: readonly Still[];
  /** Models that take a last frame / frames in between, for the muted notes. */
  endModels: readonly string[];
  middleModels: readonly string[];
  /** The model takes a last frame or extra images, not both, and extras are in use. */
  lastBlockedByExtras: boolean;
  disabled: boolean;
};

const stillImage = (s: Still) => ({ id: s.id, src: stillThumbUrl(s.id), name: stillTitle(s) });

/** First frame, optional in-between frames and an optional last frame. */
export function FramesField({
  frames,
  modelName,
  limit,
  seconds,
  picked,
  stills,
  endModels,
  middleModels,
  lastBlockedByExtras,
  disabled,
}: FramesFieldProps) {
  const [chooser, setChooser] = useState<ChooserTarget | null>(null);
  const canLast = limit >= 2;
  const maxMiddle = Math.max(0, limit - 2);
  const canMiddle = maxMiddle > 0;
  const usedMiddle = frames.middle.slice(0, maxMiddle);
  const dupes = duplicateMiddle(usedMiddle);

  const choose = (slot: Slot, title: string) => setChooser({ slot, title });
  const pickStill = (s: Still) => {
    if (!chooser) return;
    frames.addStill(chooser.slot, stillImage(s));
    setChooser(null);
  };
  const pickFile = (file: File) => {
    if (!chooser) return;
    void frames.addFile(chooser.slot, file);
    setChooser(null);
  };

  const first = frames.first;
  const last = frames.last;
  const lastLocked = !canLast || lastBlockedByExtras;
  const canAddMiddle = canMiddle && usedMiddle.length < maxMiddle;
  return (
    <div className={styles.list}>
      {!first && (
        <Text type="supporting" as="p">
          {picked
            ? 'The shot starts on the still you picked. Set frames only if you need them.'
            : 'Pick a still first; the shot starts on it.'}
        </Text>
      )}

      {first && (
        <FrameRow img={first} alt={`First frame: ${first.name}`} title="First frame" name={first.name}>
          <Button label="Change" size="sm" variant="ghost" icon={<ImagePlus size={14} />} isDisabled={disabled} onClick={() => choose('first', 'Choose the first frame')} />
          <Button label="Use picked still" size="sm" variant="ghost" icon={<Undo2 size={14} />} isDisabled={disabled} onClick={() => frames.remove(first.key)} />
        </FrameRow>
      )}

      {usedMiddle.map((m, i) => {
        const duplicate = dupes.has(m.key);
        return (
          <FrameRow key={m.key} img={m} alt={`Frame ${i + 2}: ${m.name}`} title={`Frame ${i + 2} of the shot`} name={m.name}>
            <div className={styles.position}>
              <OptionSelect
                label={`Frame ${i + 2} reached at`}
                labelHidden
                size="sm"
                showHint={false}
                options={POSITIONS.map((p) => ({
                  id: String(p),
                  name: `At ${((p / 10) * seconds).toFixed(1)} s`,
                }))}
                value={String(Math.min(9, Math.max(1, Math.round(m.at * 10))))}
                onChange={(id) => frames.setAt(m.key, Number(id) / 10)}
                disabled={disabled}
              />
            </div>
            <IconButton label={`Remove frame ${i + 2}`} tooltip="Remove" size="sm" variant="ghost" icon={<Trash2 size={14} />} isDisabled={disabled} onClick={() => frames.remove(m.key)} />
            {duplicate && (
              <p className={styles.problem} role="alert">
                Another frame sits at the same point. Move one of them to continue.
              </p>
            )}
          </FrameRow>
        );
      })}

      {last && (
        <FrameRow img={last} alt={`Last frame: ${last.name}`} title="Last frame" name={canLast ? last.name : 'Not sent with this model'} locked={lastLocked}>
          <Button label="Change" size="sm" variant="ghost" icon={<ImagePlus size={14} />} isDisabled={disabled || lastLocked} onClick={() => choose('last', 'Choose the last frame')} />
          <IconButton label="Remove the last frame" tooltip="Remove" size="sm" variant="ghost" icon={<X size={14} />} isDisabled={disabled} onClick={() => frames.remove(last.key)} />
        </FrameRow>
      )}

      {(!first || canAddMiddle || (!last && !lastLocked)) && (
        <div className={styles.options}>
          {!first && (
            <Button label="First frame" size="sm" icon={<Plus size={14} />} isDisabled={disabled} onClick={() => choose('first', 'Choose the first frame')} />
          )}
          {canAddMiddle && (
            <Button label="Frame in between" size="sm" icon={<Plus size={14} />} isDisabled={disabled} onClick={() => choose('middle', 'Add a frame in between')} />
          )}
          {!last && !lastLocked && (
            <Button label="Last frame" size="sm" icon={<Plus size={14} />} isDisabled={disabled} onClick={() => choose('last', 'Choose the last frame')} />
          )}
        </div>
      )}

      {!canLast && (
        <Text type="supporting" as="p">
          {modelName} starts on the first frame only and can&rsquo;t take a last frame
          {frames.last ? ', so your last frame is kept but not sent' : ''}. Models with a last frame:{' '}
          {endModels.join(', ')}.
        </Text>
      )}
      {canLast && !canMiddle && (
        <Text type="supporting" as="p">
          {modelName} takes a first and a last frame
          {middleModels.length > 0 ? `. Frames in between work with ${middleModels.join(', ')}.` : '.'}
          {frames.middle.length > 0 ? ' Your frames in between are kept but not sent.' : ''}
        </Text>
      )}
      {canLast && lastBlockedByExtras && (
        <Text type="supporting" as="p">
          {modelName} can use a last frame or extra images, not both. Remove the extra images to add a last frame.
        </Text>
      )}
      {canMiddle && frames.middle.length > maxMiddle && (
        <Text type="supporting" as="p">
          {modelName} takes {maxMiddle} frames in between; the others are kept but not sent.
        </Text>
      )}

      <UploadError error={frames.frameError} title="That image didn't upload" />
      <StillPicker
        isOpen={chooser !== null}
        title={chooser?.title ?? ''}
        stills={stills}
        onPick={pickStill}
        onFile={pickFile}
        onClose={() => setChooser(null)}
      />
    </div>
  );
}

const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type RefsFieldProps = {
  frames: VideoFramesApi;
  modelName: string;
  /** Extra images the model takes; 0 = none. */
  limit: number;
  stills: readonly Still[];
  extraModels: readonly string[];
  /** Why adding is off for a model that does take extras (a last frame is set). */
  blockedReason?: string | undefined;
  disabled: boolean;
  /** Append `@imgN` to the direction. */
  onInsert: (handle: string) => void;
};

/** The extra images, each named @img1, @img2 and so on, in order. */
export function RefsField({
  frames,
  modelName,
  limit,
  stills,
  extraModels,
  blockedReason,
  disabled,
  onInsert,
}: RefsFieldProps) {
  const [open, setOpen] = useState(false);
  const supported = limit > 0;
  const full = frames.refs.length >= limit;
  const locked = disabled || !supported || blockedReason !== undefined;
  return (
    <div className={styles.list}>
      {frames.refs.length === 0 ? (
        <Text type="supporting" as="p">
          {supported
            ? 'No extra images yet. Add a bench, a person, a material or any detail, then name it in your direction.'
            : `${modelName} can't take extra images. Pick ${extraModels.join(', ')} to use them.`}
        </Text>
      ) : (
        <div className={styles.refs}>
          {frames.refs.map((r, i) => (
            <figure className={styles.ref} key={r.key}>
              <Thumb img={r} alt={`@img${i + 1}: ${r.name}`} />
              <div className={styles.refFoot}>
                <Tooltip content="Put it in the direction">
                  <button
                    type="button"
                    className={styles.handle}
                    disabled={disabled}
                    aria-label={`Insert @img${i + 1} into the direction`}
                    onClick={() => onInsert(`@img${i + 1}`)}
                  >
                    @img{i + 1}
                  </button>
                </Tooltip>
                <IconButton label={`Remove @img${i + 1}`} tooltip="Remove" size="sm" variant="ghost" icon={<X size={14} />} isDisabled={disabled} onClick={() => frames.remove(r.key)} />
              </div>
            </figure>
          ))}
        </div>
      )}
      <div>
        <Button
          label={full && supported ? `All ${limit} added` : 'Add an image'}
          size="sm"
          icon={<ImagePlus size={14} />}
          isDisabled={locked || full}
          onClick={() => setOpen(true)}
        />
      </div>
      {!supported && frames.refs.length > 0 && (
        <Text type="supporting" as="p">
          {modelName} can&rsquo;t take extra images, so these are kept but not sent. Models that can:{' '}
          {extraModels.join(', ')}.
        </Text>
      )}
      {supported && frames.refs.length > 0 && (
        <Text type="supporting" as="p">
          Removing an image renumbers the rest. {modelName} takes up to {limit}.
        </Text>
      )}
      {blockedReason && (
        <Text type="supporting" as="p">
          {blockedReason}
        </Text>
      )}
      <UploadError error={frames.refError} title="That image didn't upload" />
      <StillPicker
        isOpen={open}
        title={`Add @img${frames.refs.length + 1}`}
        stills={stills}
        onPick={(s) => {
          frames.addStill('ref', stillImage(s));
          setOpen(false);
        }}
        onFile={(file) => {
          void frames.addFile('ref', file);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
