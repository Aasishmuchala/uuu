import { Trash2, Users } from 'lucide-react';

import { Banner, Button, StatusDot, Text } from './kit.ts';
import { errorMessage } from './lib/runwayErrors.ts';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import styles from './parts/RefField.module.css';

/** The cast sheet the visitor picked: a local preview, and its hosted URL once uploaded. */
export type CastSheet = {
  src: string;
  name: string;
  hostedUrl?: string | undefined;
};

export type CastSheetFieldProps = {
  sheet: CastSheet | null;
  uploading: boolean;
  /** The upload failure (the route's body or an Error), shown beside the zone. */
  error: unknown;
  /** False when the chosen image model takes only the render. */
  supported: boolean;
  modelName: string;
  /** Up to two models that do take a cast sheet. */
  alternatives: readonly string[];
  disabled?: boolean | undefined;
  onFile: (file: File) => void;
  onRemove: () => void;
};

/**
 * The optional second picture in the People group: photos of the people to cast. Small, with
 * its name and Remove once in, and a plain notice when the model can't take it.
 */
export function CastSheetField({
  sheet,
  uploading,
  error,
  supported,
  modelName,
  alternatives,
  disabled = false,
  onFile,
  onRemove,
}: CastSheetFieldProps) {
  const locked = disabled || uploading || !supported;
  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <Text type="label">Cast sheet</Text>
        <Text type="supporting" as="p">
          Optional. Photos of the people to cast; their faces, build and clothing are matched.
        </Text>
      </div>

      <ImageDropZone onFile={onFile} disabled={locked} actionLabel={sheet ? 'Replace' : 'Choose photo'}>
        {sheet ? (
          <div className={styles.body}>
            <figure className={styles.thumb}>
              <img src={sheet.src} alt={`Cast sheet: ${sheet.name}`} data-dim={uploading || !supported || undefined} />
              {uploading && (
                <span className={styles.state}>
                  <StatusDot variant="accent" label="Uploading" tooltip="Uploading" isPulsing />
                </span>
              )}
            </figure>
            <div className={styles.side}>
              <Text type="supporting" maxLines={1}>
                {uploading ? 'Uploading…' : sheet.name}
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
            <Users size={16} aria-hidden />
            <Text type="supporting">{uploading ? 'Uploading…' : 'Drop a cast sheet here'}</Text>
          </div>
        )}
      </ImageDropZone>

      {!supported && (
        <Banner
          status="warning"
          title="No cast sheet with this model"
          description={`${modelName} can’t take a cast sheet${alternatives.length > 0 ? `; pick ${alternatives.join(' or ')}` : ''}.${sheet ? ' Your uploaded sheet is kept but will not be sent.' : ''}`}
        />
      )}
      {error != null && <Banner status="error" title="The cast sheet didn't upload" description={errorMessage(error)} />}
    </div>
  );
}
