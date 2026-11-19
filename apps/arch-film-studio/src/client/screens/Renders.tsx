import { ImageUp, Images, ScanSearch, Trash2 } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';

import { type ImageSettings, mediaUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import {
  AlertDialog,
  Button,
  EmptyState,
  Heading,
  MetadataList,
  MetadataListItem,
  ResizeHandle,
  Text,
  useResizable,
} from '../kit.ts';
import type { PictureState } from '../lib/progress.ts';
import { capForSpend } from '../lib/selection.ts';
import { altOf, sizeWords } from '../lib/stages.ts';
import { eachLimited, UPLOAD_AT_ONCE, UPLOAD_TYPES, uploadOne } from '../lib/upload.ts';
import { FREE_THINKING, LOCKED_MASTER } from '../lib/words.ts';
import { errorText, FreeButton } from '../money.tsx';
import { ContactSheet, type SheetItem } from '../parts/ContactSheet.tsx';
import { Picture } from '../parts/Picture.tsx';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { SettingsForm } from '../parts/SettingsForm.tsx';
import { type Selection, useSelection } from '../parts/useSelection.ts';
import { trpc } from '../trpc.ts';
import { useApply, useRefresh } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Renders.module.css';

type Row = { key: string; name: string; state: 'waiting' | 'sending' | 'done' | 'refused'; message?: string; code?: string };

let rowCounter = 0;

/** On this screen a picture's dot is its analysis. */
function analysisState(image: ProjectImage): PictureState {
  switch (image.analysis?.state) {
    case 'succeeded':
      return { words: 'Analysed', dot: 'success', working: false };
    case 'running':
    case 'queued':
      return { words: 'Being analysed', dot: 'accent', working: true };
    case 'failed':
      return { words: 'Analysis failed', dot: 'error', working: false };
    default:
      return { words: 'Not analysed', dot: 'neutral', working: false };
  }
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** The renders: drop them in, see them on a contact sheet, set each picture's settings in the inspector. */
export function Renders({ project, focus }: { project: Project; focus?: string | undefined }) {
  const refresh = useRefresh();
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const order = project.images.map((i) => i.id);
  const selection = useSelection(order);
  const panel = useResizable({ defaultSize: 360, minSize: 300, maxSize: 560, autoSaveId: 'arch-film-studio.inspector' });

  // A picture named in the address is the one in the inspector.
  const { set } = selection;
  useEffect(() => {
    if (focus) set([focus]);
  }, [focus, set]);

  const patch = (key: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
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
  const sending = rows.some((r) => r.state === 'waiting' || r.state === 'sending');

  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => (UPLOAD_TYPES as readonly string[]).includes(f.type) || f.type === '');
      if (files.length > 0) void send(files);
    },
  };

  const input = (
    <input
      ref={picker}
      className={styles.hidden}
      type="file"
      multiple
      accept={UPLOAD_TYPES.join(',')}
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = '';
        if (files.length > 0) void send(files);
      }}
    />
  );

  if (project.images.length === 0) {
    return (
      <div className={`${screen.screen} ${styles.fill}`} {...drop}>
        {input}
        <div className={styles.dropAll} data-over={over || undefined}>
          <EmptyState
            icon={<Images size={28} aria-hidden />}
            title="Drop all of this project's renders here"
            description="JPG, PNG or WebP, up to 25 MB each and 200 in a project. Each keeps its original untouched."
            actions={<Button label="Choose renders" variant="primary" icon={<ImageUp size={16} aria-hidden />} onClick={() => picker.current?.click()} />}
          />
          <UploadRows rows={rows} />
        </div>
      </div>
    );
  }

  const items: SheetItem[] = project.images.map((image) => ({
    id: image.id,
    src: mediaUrl(image.thumbKey),
    alt: altOf(image),
    width: image.width,
    height: image.height,
    code: image.code,
    name: image.name,
    meta: sizeWords(image),
    locked: !!image.master?.locked,
    state: analysisState(image),
  }));

  return (
    <div className={screen.split} {...drop}>
      {input}
      <div className={`${screen.splitMain} ${styles.main}`} data-over={over || undefined}>
        <div className={screen.screen}>
          <ScreenHeader title="Renders" sentence={`${project.images.length} of at most 200. Each keeps its original as an untouchable reference; strict mode is on until you change it.`}>
            <Button label="Add renders" variant="secondary" icon={<ImageUp size={16} aria-hidden />} isLoading={sending} onClick={() => picker.current?.click()} />
          </ScreenHeader>
          <UploadRows rows={rows} />
          <ContactSheet items={items} label="Renders" selection={selection} />
          <p className={`${screen.quiet} ${styles.hint}`}>Drop more renders anywhere on this page. Click a picture to see its settings; Shift-click or Cmd-click to pick several.</p>
        </div>
      </div>
      <ResizeHandle resizable={panel} isReversed hasDivider label="Resize the inspector" />
      <aside className={screen.inspector} style={{ width: panel.size, flex: 'none' }} aria-label="Inspector">
        <Inspector project={project} selection={selection} />
      </aside>
    </div>
  );
}

function UploadRows({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className={styles.rows} aria-label="Uploads">
      {rows.map((r) => (
        <li key={r.key} className={styles.row} data-state={r.state}>
          <span className={styles.rowName}>{r.name}</span>
          <span className={styles.rowState} role={r.state === 'refused' ? 'alert' : undefined}>
            {r.state === 'waiting' ? 'Waiting' : r.state === 'sending' ? 'Sending' : r.state === 'done' ? `Added as ${r.code}` : r.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Inspector({ project, selection }: { project: Project; selection: Selection }) {
  const picked = selection.ids.map((id) => project.images.find((i) => i.id === id)).filter((i): i is ProjectImage => !!i);
  if (picked.length === 0) {
    return (
      <div className={styles.inspectorEmpty}>
        <Text type="body" color="secondary" as="p">
          Select a picture to see its settings and what the analysis saw.
        </Text>
        <Text type="supporting" color="secondary" as="p">
          Pick several to set them all at once.
        </Text>
      </div>
    );
  }
  if (picked.length === 1) return <One key={picked[0]!.id} project={project} image={picked[0]!} onRemoved={selection.clear} />;
  return <Several key={picked.map((i) => i.id).join()} project={project} images={picked} />;
}

function One({ project, image, onRemoved }: { project: Project; image: ProjectImage; onRemoved: () => void }) {
  const apply = useApply();
  const save = trpc.image.setSettings.useMutation({ onSuccess: apply });
  const analyse = trpc.image.analyse.useMutation({ onSuccess: apply });
  const remove = trpc.image.remove.useMutation({
    onSuccess: (p) => {
      apply(p);
      setAsking(false);
      onRemoved();
    },
  });
  const [asking, setAsking] = useState(false);
  const locked = !!image.master?.locked;
  const analysis = image.analysis;
  const analysing = analysis?.state === 'running';

  return (
    <>
      <div className={screen.inspectorHead}>
        <Picture src={mediaUrl(image.workKey)} alt={altOf(image, 'the render')} width={image.width} height={image.height} />
        <div className={styles.titleRow}>
          <Heading level={2} maxLines={1}>
            {image.code}
          </Heading>
          <Button label={`Remove ${image.code}`} variant="ghost" size="sm" isIconOnly icon={<Trash2 size={15} aria-hidden />} tooltip="Remove from the project" onClick={() => setAsking(true)} />
        </div>
        <Text type="supporting" color="secondary" maxLines={1}>
          {image.name}, <span className="num">{sizeWords(image)}</span>
        </Text>
      </div>

      <section className={styles.block} aria-label="Analysis">
        <Heading level={4} accessibilityLevel={3}>
          What the analysis saw
        </Heading>
        {analysis?.state === 'succeeded' && analysis.result ? (
          <>
            <Text type="body" as="p">
              {analysis.result.summary}
            </Text>
            <MetadataList>
              <MetadataListItem label="Space">{analysis.result.spaceType}</MetadataListItem>
              <MetadataListItem label="Camera">{analysis.result.camera}</MetadataListItem>
              <MetadataListItem label="Lighting">{analysis.result.lighting}</MetadataListItem>
              {analysis.result.materials.length > 0 && <MetadataListItem label="Materials">{analysis.result.materials.join(', ')}</MetadataListItem>}
            </MetadataList>
          </>
        ) : (
          <Text type="supporting" color="secondary" as="p">
            {analysing ? 'Looking at the render…' : 'Not analysed yet. An analysis helps the storyboard later.'}
          </Text>
        )}
        {analysis?.state === 'failed' && (
          <p className={screen.error} role="alert">
            {analysis.error}
          </p>
        )}
        <FreeButton
          label={analysis?.state === 'succeeded' ? 'Analyse again' : 'Analyse'}
          note={FREE_THINKING}
          size="sm"
          icon={<ScanSearch size={15} aria-hidden />}
          loading={analyse.isPending || analysing}
          error={errorText(analyse.error)}
          onPress={() => analyse.mutate({ projectId: project.id, imageIds: [image.id] })}
        />
      </section>

      <hr className={screen.divider} />

      <section className={styles.block} aria-label="Settings">
        <Heading level={4} accessibilityLevel={3}>
          Settings
        </Heading>
        {locked && (
          <Text type="supporting" color="secondary" as="p">
            {LOCKED_MASTER} Its settings stay as they were made.
          </Text>
        )}
        <SettingsForm
          settings={image.settings}
          disabled={locked}
          disabledWhy={locked ? LOCKED_MASTER : null}
          saving={save.isPending}
          error={errorText(save.error)}
          onSave={(settings) => save.mutate({ projectId: project.id, imageId: image.id, settings })}
        />
      </section>

      <AlertDialog
        isOpen={asking}
        onOpenChange={(open: boolean) => {
          if (!open) {
            remove.reset();
            setAsking(false);
          }
        }}
        title={`Remove ${image.code}?`}
        description={errorText(remove.error) ?? 'Its upload, its versions and its master leave the project.'}
        actionLabel={`Remove ${image.code}`}
        isActionLoading={remove.isPending}
        onAction={() => {
          if (!remove.isPending) remove.mutate({ projectId: project.id, imageId: image.id });
        }}
      />
    </>
  );
}

function Several({ project, images }: { project: Project; images: ProjectImage[] }) {
  const apply = useApply();
  const utils = trpc.useUtils();
  const save = trpc.image.setSettings.useMutation();
  const analyse = trpc.image.analyse.useMutation({ onSuccess: apply });
  const [draft, setDraft] = useState<ImageSettings>(images[0]!.settings);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const open = images.filter((i) => !i.master?.locked);
  const sent = capForSpend(images.map((i) => i.id));

  // One picture at a time, in order; the first refusal stops the rest and says which.
  const applyAll = async () => {
    setApplying(true);
    setResult(null);
    let done = 0;
    for (const image of open) {
      try {
        const p = await save.mutateAsync({ projectId: project.id, imageId: image.id, settings: draft });
        apply(p);
        done += 1;
      } catch (err) {
        setResult(`${image.code} was not changed: ${errorText(err)} ${done} before it were.`);
        break;
      }
    }
    if (done === open.length) setResult(`Applied to ${done} ${done === 1 ? 'picture' : 'pictures'}.`);
    setApplying(false);
    void utils.project.get.invalidate({ id: project.id });
  };

  return (
    <>
      <div className={screen.inspectorHead}>
        <Heading level={2}>{images.length} pictures</Heading>
        <Text type="supporting" color="secondary" as="p">
          {images.map((i) => i.code).join(', ')}
        </Text>
      </div>
      <FreeButton
        label={`Analyse ${Math.min(sent.length, images.length)}`}
        note={FREE_THINKING}
        size="sm"
        icon={<ScanSearch size={15} aria-hidden />}
        loading={analyse.isPending}
        error={errorText(analyse.error)}
        why={images.length > sent.length ? `Up to ${sent.length} at a time. The first ${sent.length} are sent.` : null}
        onPress={() => analyse.mutate({ projectId: project.id, imageIds: sent })}
      />
      <hr className={screen.divider} />
      <section className={styles.block} aria-label="Settings for all">
        <Heading level={4} accessibilityLevel={3}>
          Settings for all of them
        </Heading>
        <Text type="supporting" color="secondary" as="p">
          Starts from {images[0]!.code}. Nothing changes until you apply.
          {open.length < images.length ? ` ${images.length - open.length} with a locked master stay as they are.` : ''}
        </Text>
        <SettingsForm settings={draft} disabled={applying} saving={false} error={null} onSave={setDraft} />
        <FreeButton
          label={`Apply to ${open.length} ${open.length === 1 ? 'picture' : 'pictures'}`}
          note="No charge"
          variant="primary"
          loading={applying}
          disabled={open.length === 0}
          onPress={() => void applyAll()}
        />
        {result && (
          <Text type="supporting" color="secondary" as="p">
            {result}
          </Text>
        )}
      </section>
    </>
  );
}
