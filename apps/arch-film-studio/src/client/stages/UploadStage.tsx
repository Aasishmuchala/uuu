import { CircleAlert, CircleCheck, ImageUp, Images, LoaderCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button as AriaButton, DropZone, FileTrigger } from 'react-aria-components';

import { mediaUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import { Section } from '../layouts/Section.tsx';
import { altOf, sizeWords } from '../lib/stages.ts';
import { eachLimited, UPLOAD_AT_ONCE, UPLOAD_TYPES, uploadOne } from '../lib/upload.ts';
import { errorText } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply, useRefresh } from '../useApply.ts';
import { Button } from '../ui/Button.tsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import appStyles from '../App.module.css';
import styles from '../Stages.module.css';

type Row = { key: string; name: string; state: 'waiting' | 'sending' | 'done' | 'refused'; message?: string; code?: string };

let rowCounter = 0;

export function UploadStage({ project, onNext }: { project: Project; onNext: () => void }) {
  const refresh = useRefresh();
  const [rows, setRows] = useState<Row[]>([]);
  const sending = rows.some((r) => r.state === 'waiting' || r.state === 'sending');

  const patch = (key: string, change: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const send = async (files: File[]) => {
    const added: Row[] = files.map((f) => ({ key: `u${++rowCounter}`, name: f.name, state: 'waiting' }));
    setRows((all) => [...added, ...all.filter((r) => r.state !== 'done')]);
    await eachLimited(files, UPLOAD_AT_ONCE, async (file, i) => {
      const key = added[i]!.key;
      patch(key, { state: 'sending' });
      const r = await uploadOne(project.id, file);
      if (r.ok) {
        patch(key, { state: 'done', code: r.image.code });
        refresh(project.id);
      } else patch(key, { state: 'refused', message: r.message });
    });
  };

  return (
    <>
      <Section
        title="Renders"
        description="Every image keeps its original as an untouchable reference. Strict image-only mode is on by default."
      >
        <DropZone
          className={appStyles.dropzone}
          getDropOperation={(types) => (UPLOAD_TYPES.some((t) => types.has(t)) ? 'copy' : 'cancel')}
          onDrop={async (e) => {
            const files: File[] = [];
            for (const item of e.items) if (item.kind === 'file') files.push(await item.getFile());
            if (files.length > 0) void send(files);
          }}
        >
          <Images size={28} aria-hidden className={appStyles.dropIcon} />
          <p className={appStyles.dropTitle}>Drop all your renders here</p>
          <p className={appStyles.dropHint}>JPG, PNG or WebP. Upload the whole project at once.</p>
          <FileTrigger
            acceptedFileTypes={[...UPLOAD_TYPES]}
            allowsMultiple
            onSelect={(list) => {
              const files = list ? Array.from(list) : [];
              if (files.length > 0) void send(files);
            }}
          >
            <AriaButton className={styles.chooseButton}>
              <ImageUp size={16} aria-hidden />
              Choose images
            </AriaButton>
          </FileTrigger>
        </DropZone>

        {rows.length > 0 && (
          <ul className={styles.uploadRows} aria-label="Uploads">
            {rows.map((r) => (
              <li key={r.key} className={styles.uploadRow} data-state={r.state}>
                {r.state === 'done' ? (
                  <CircleCheck size={14} aria-hidden />
                ) : r.state === 'refused' ? (
                  <CircleAlert size={14} aria-hidden />
                ) : (
                  <LoaderCircle size={14} aria-hidden className={styles.spin} />
                )}
                <span className={styles.uploadName}>{r.name}</span>
                <span className={styles.uploadState} role={r.state === 'refused' ? 'alert' : undefined}>
                  {r.state === 'waiting'
                    ? 'Waiting'
                    : r.state === 'sending'
                      ? 'Sending'
                      : r.state === 'done'
                        ? `Added as ${r.code}`
                        : r.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="In this project" description={`${project.images.length} of at most 200 renders.`}>
        {project.images.length === 0 ? (
          <EmptyState
            title="No renders yet"
            hint="Once uploaded, each image gets its own analysis, settings and before/after review."
          />
        ) : (
          <>
            <ul className={styles.grid}>
              {project.images.map((image) => (
                <Thumb key={image.id} project={project} image={image} />
              ))}
            </ul>
            <div className={styles.rowEnd}>
              <Button variant="primary" disabled={sending} onPress={onNext}>
                Go to Enhance
              </Button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}

function Thumb({ project, image }: { project: Project; image: ProjectImage }) {
  const apply = useApply();
  const [asking, setAsking] = useState(false);
  const remove = trpc.image.remove.useMutation({
    onSuccess: (p) => {
      apply(p);
      setAsking(false);
    },
  });
  return (
    <li className={styles.tile}>
      <img className={styles.thumb} src={mediaUrl(image.thumbKey)} alt={altOf(image)} loading="lazy" />
      <div className={styles.tileText}>
        <span className={styles.code}>{image.code}</span>
        <span className={styles.name} title={image.name}>
          {image.name}
        </span>
        <span className={styles.meta}>{sizeWords(image)}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={styles.tileRemove}
        icon={<Trash2 size={14} aria-hidden />}
        aria-label={`Remove ${image.code}`}
        onPress={() => setAsking(true)}
      />
      <ConfirmDialog
        isOpen={asking}
        title={`Remove ${image.code}?`}
        confirmLabel="Remove"
        loading={remove.isPending}
        error={errorText(remove.error) ?? undefined}
        onConfirm={() => remove.mutate({ projectId: project.id, imageId: image.id })}
        onCancel={() => {
          remove.reset();
          setAsking(false);
        }}
      >
        Its upload, its versions and its master leave the project.
      </ConfirmDialog>
    </li>
  );
}
