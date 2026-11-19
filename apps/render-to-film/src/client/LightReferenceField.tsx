import { useState } from 'react';
import { GalleryHorizontal, RotateCcw, SunMedium, Trash2 } from 'lucide-react';

import type { CastSheet } from './CastSheetField.tsx';
import { Banner, Button, StatusDot, Text } from './kit.ts';
import { errorMessage } from './lib/runwayErrors.ts';
import { MediaGrid, MediaGridSkeleton } from './parts/MediaGrid.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import styles from './parts/RefField.module.css';

/** One of the visitor's finished stills, as the picker shows it. */
export type StillChoice = {
  id: string;
  src: string;
  alt: string;
  caption: string;
};

export type LightReferenceFieldProps = {
  /** Same shape as a cast sheet: a local preview, and its hosted URL once uploaded. */
  image: CastSheet | null;
  uploading: boolean;
  /** The upload failure (the route's body or an Error), shown beside the zone. */
  error: unknown;
  /** Set while an area is marked: the rest of the frame keeps the render's light. */
  lockedReason?: string | undefined;
  modelName: string;
  disabled?: boolean | undefined;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** Finished stills whose light can be matched, newest first. */
  stills: readonly StillChoice[];
  /** The library behind `stills` is still loading. */
  stillsLoading?: boolean | undefined;
  /** Why the library could not be loaded, when it could not. */
  stillsError?: unknown;
  onRetryStills?: (() => void) | undefined;
  /** The still being matched, when the reference is one of the visitor's stills. */
  matched: StillChoice | null;
  onMatch: (stillId: string | null) => void;
};

/**
 * The optional lighting reference in the Look group: a photo whose light the still copies, and
 * nothing else from it, or one of the visitor's own stills for a matching series. While one is
 * in, the look presets are switched off.
 */
export function LightReferenceField({
  image,
  uploading,
  error,
  lockedReason,
  disabled = false,
  onFile,
  onRemove,
  stills,
  stillsLoading = false,
  stillsError,
  onRetryStills,
  matched,
  onMatch,
}: LightReferenceFieldProps) {
  const locked = disabled || uploading || lockedReason !== undefined;
  const [picking, setPicking] = useState(false);
  if (matched) {
    return (
      <div className={styles.field}>
        <div className={styles.head}>
          <Text type="label">Lighting reference: one of your stills</Text>
          <Text type="supporting" as="p">
            Every view you shoot now gets this still&rsquo;s exact light, for a matching series. Swap the render above
            for each view.
          </Text>
        </div>
        <div className={styles.body}>
          <figure className={styles.thumb}>
            <img src={matched.src} alt={`Matching the light of ${matched.alt}`} data-dim={lockedReason ? true : undefined} />
          </figure>
          <div className={styles.side}>
            <Text type="supporting" maxLines={1}>
              {matched.caption}
            </Text>
            <Button
              label="Stop matching"
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              isDisabled={disabled}
              onClick={() => onMatch(null)}
            />
          </div>
        </div>
        {lockedReason && (
          <Text type="supporting" as="p">
            {lockedReason}
          </Text>
        )}
      </div>
    );
  }
  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <Text type="label">Lighting reference</Text>
        <Text type="supporting" as="p">
          Optional. A photo whose light to match: time of day, sun, shadows, sky and grade. Nothing else in it is copied.
        </Text>
      </div>

      <ImageDropZone onFile={onFile} disabled={locked} actionLabel={image ? 'Replace' : 'Choose photo'}>
        {image ? (
          <div className={styles.body}>
            <figure className={styles.thumb}>
              <img
                src={image.src}
                alt={`Lighting reference: ${image.name}`}
                data-dim={uploading || lockedReason ? true : undefined}
              />
              {uploading && (
                <span className={styles.state}>
                  <StatusDot variant="accent" label="Uploading" tooltip="Uploading" isPulsing />
                </span>
              )}
            </figure>
            <div className={styles.side}>
              <Text type="supporting" maxLines={1}>
                {uploading ? 'Uploading…' : image.name}
              </Text>
              <Button
                label="Remove"
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                isDisabled={disabled || uploading}
                onClick={onRemove}
              />
            </div>
          </div>
        ) : (
          <div className={styles.empty} data-disabled={locked || undefined}>
            <SunMedium size={16} aria-hidden />
            <Text type="supporting">{uploading ? 'Uploading…' : 'Drop a lighting photo here'}</Text>
          </div>
        )}
      </ImageDropZone>

      {!image &&
        (picking ? (
          <>
            {stills.length > 0 ? (
              <MediaGrid
                label="Match the light of one of your stills"
                density="small"
                items={stills.map((s) => ({ id: s.id, kind: 'still' as const, thumb: s.src, title: s.caption, ratio: 3 / 2 }))}
                active={null}
                onActivate={(id) => {
                  if (locked) return;
                  setPicking(false);
                  onMatch(id);
                }}
              />
            ) : stillsLoading ? (
              <div role="status" aria-live="polite">
                <MediaGridSkeleton count={3} density="small" />
              </div>
            ) : stillsError != null ? (
              <Banner
                status="error"
                title="Your stills could not be loaded"
                description={errorMessage(stillsError)}
                endContent={
                  onRetryStills ? (
                    <Button label="Try again" size="sm" icon={<RotateCcw size={14} />} onClick={onRetryStills} />
                  ) : undefined
                }
              />
            ) : (
              <Text type="supporting" as="p">
                No finished stills yet. Make one, then match the next views to its light.
              </Text>
            )}
            <div className={styles.actions}>
              <Button label="Cancel" size="sm" variant="ghost" onClick={() => setPicking(false)} />
            </div>
          </>
        ) : (
          <div className={styles.actions}>
            <Button
              label="Match one of your stills"
              size="sm"
              icon={<GalleryHorizontal size={14} />}
              isDisabled={locked}
              onClick={() => setPicking(true)}
            />
          </div>
        ))}
      {lockedReason && image && (
        <Text type="supporting" as="p">
          {lockedReason}
        </Text>
      )}
      {error != null && <Banner status="error" title="The lighting reference didn't upload" description={errorMessage(error)} />}
    </div>
  );
}
