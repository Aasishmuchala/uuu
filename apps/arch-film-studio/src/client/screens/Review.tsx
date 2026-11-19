import { Check, Grid2x2, MessageSquare, RectangleHorizontal, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  approvedEnhancement,
  ENHANCEMENT_KEYS,
  ENHANCEMENT_LABELS,
  type EnhancementRun,
  FIDELITY_LABELS,
  latestEnhancement,
  LIGHTING_LABELS,
  mediaUrl,
  OUTPUT_LABELS,
  outputUrl,
  type Project,
  type ProjectImage,
} from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL, ENHANCE_MODELS, type EnhanceModel, MODEL_INFO } from '../../server/models.ts';
import {
  Button,
  EmptyState,
  Heading,
  MetadataList,
  MetadataListItem,
  SegmentedControl,
  SegmentedControlItem,
  StatusDot,
  Text,
  TextArea,
} from '../kit.ts';
import { isDecided, nextUndecided, pictureState, reviewOrder } from '../lib/progress.ts';
import { keyAction } from '../lib/reviewKeys.ts';
import { enhanceAsk } from '../lib/spend.ts';
import { altOf, jobWords, sizeWords } from '../lib/stages.ts';
import { LOCKED_MASTER } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton } from '../money.tsx';
import { CompareSlider } from '../parts/CompareSlider.tsx';
import { ContactSheet, type SheetItem } from '../parts/ContactSheet.tsx';
import { Filmstrip } from '../parts/Filmstrip.tsx';
import { FullSize, FullSizeView, type FullSizeMedia } from '../parts/FullSize.tsx';
import { Picture } from '../parts/Picture.tsx';
import { SelectionBar } from '../parts/SelectionBar.tsx';
import { useSelection } from '../parts/useSelection.ts';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Review.module.css';

const DECISION_WORDS: Record<EnhancementRun['decision'], string> = {
  pending: 'Not decided',
  approved: 'Approved',
  rejected: 'Rejected',
  revision: 'Revision asked',
};

const DECISION_DOT: Record<EnhancementRun['decision'], 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  approved: 'success',
  rejected: 'error',
  revision: 'warning',
};

type Filter = 'todo' | 'approved' | 'rejected' | 'all';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'todo', label: 'To decide' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

function inFilter(image: ProjectImage, f: Filter): boolean {
  switch (f) {
    case 'todo':
      return !isDecided(image);
    case 'approved':
      return !!approvedEnhancement(image);
    case 'rejected':
      return !approvedEnhancement(image) && latestEnhancement(image)?.decision === 'rejected';
    case 'all':
      return true;
  }
}

/** The model a version was made with, for its revision; the default when it is not one of the three. */
function modelOf(run: EnhancementRun): EnhanceModel {
  const m = (run as EnhancementRun & { model?: string }).model;
  return (ENHANCE_MODELS as readonly string[]).includes(m ?? '') ? (m as EnhanceModel) : DEFAULT_ENHANCE_MODEL;
}

/** Why a picture cannot be decided now, or null. */
function holdOf(image: ProjectImage): string | null {
  if (image.master?.locked) return LOCKED_MASTER;
  if (image.master?.state === 'queued' || image.master?.state === 'running') return "This image's master is being made.";
  return null;
}

/** The newest finished picture of an image, for the grid. */
function newestMade(image: ProjectImage) {
  return [...image.enhancements].reverse().find((r) => r.state === 'succeeded' && r.storedKey);
}

/** Judge each made picture against its render: approve, reject, or ask for a revision. Keys make it fast. */
export function Review({ project, focus }: { project: Project; focus?: string | undefined }) {
  const all = reviewOrder(project);
  const [filter, setFilter] = useState<Filter>(() => (all.some((i) => !isDecided(i)) ? 'todo' : 'all'));
  const [view, setView] = useState<'focus' | 'grid'>('focus');
  const [activeId, setActiveId] = useState<string | null>(focus ?? null);
  const shown = all.filter((i) => inFilter(i, filter) || i.id === activeId);
  const active = shown.find((i) => i.id === activeId) ?? shown[0] ?? null;
  const made = all.filter((i) => i.enhancements.some((r) => r.state === 'succeeded'));
  const decided = made.filter(isDecided).length;

  useEffect(() => {
    if (focus) {
      setActiveId(focus);
      setView('focus');
    }
  }, [focus]);

  return (
    <div className={styles.review}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <Heading level={1}>Review</Heading>
          <Text type="body" color="secondary">
            <span className="num">
              {decided} of {made.length}
            </span>{' '}
            decided
          </Text>
        </div>
        <div className={styles.tools}>
          <SegmentedControl label="Show" value={filter} onChange={(v: string) => setFilter(v as Filter)} size="sm">
            {FILTERS.map((f) => (
              <SegmentedControlItem key={f.value} value={f.value} label={`${f.label} ${all.filter((i) => inFilter(i, f.value)).length}`} />
            ))}
          </SegmentedControl>
          <SegmentedControl label="View" value={view} onChange={(v: string) => setView(v as 'focus' | 'grid')} size="sm">
            <SegmentedControlItem value="focus" label="Focus" icon={<RectangleHorizontal size={14} aria-hidden />} />
            <SegmentedControlItem value="grid" label="Grid" icon={<Grid2x2 size={14} aria-hidden />} />
          </SegmentedControl>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={screen.empty}>
          <EmptyState
            icon={<Check size={24} aria-hidden />}
            title={filter === 'todo' ? 'Everything is decided' : 'Nothing here'}
            description={filter === 'todo' ? 'Every made picture has a decision. Approved ones go on to Masters.' : 'No picture is in this group right now.'}
            actions={<Button label="Show all" variant="secondary" onClick={() => setFilter('all')} />}
          />
        </div>
      ) : view === 'grid' ? (
        <Grid
          project={project}
          images={shown}
          onOpen={(id) => {
            setActiveId(id);
            setView('focus');
          }}
          onToggleView={() => setView('focus')}
        />
      ) : (
        active && (
          <Focus
            key={active.id}
            project={project}
            image={active}
            order={shown}
            onPick={setActiveId}
            onAdvance={(p) => {
              const next = nextUndecided(p, active.id);
              if (next) setActiveId(next);
            }}
            onToggleView={() => setView('grid')}
          />
        )
      )}
    </div>
  );
}

function Focus({
  project,
  image,
  order,
  onPick,
  onAdvance,
  onToggleView,
}: {
  project: Project;
  image: ProjectImage;
  order: ProjectImage[];
  onPick: (id: string) => void;
  onAdvance: (p: Project) => void;
  onToggleView: () => void;
}) {
  const apply = useApply();
  const runs = image.enhancements;
  const [chosenId, setChosenId] = useState<string | null>(null);
  const run = runs.find((r) => r.id === chosenId) ?? runs[runs.length - 1]!;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(run.decisionNote ?? '');
  const [showRender, setShowRender] = useState(false);
  const [full, setFull] = useState<FullSizeMedia | null>(null);
  const decide = trpc.image.decide.useMutation();
  const revise = trpc.image.enhance.useMutation({ onSuccess: apply });
  const hold = holdOf(image);
  const words = jobWords(run, DECISION_WORDS[run.decision]);
  const after = outputUrl(run);
  const size = run.outputSize ?? { width: image.width, height: image.height };
  const noteText = note.trim();
  const model = modelOf(run);
  const versionBusy = runs.some((r) => r.state === 'queued' || r.state === 'running');
  const index = order.findIndex((i) => i.id === image.id);

  const canApprove = !hold && run.state === 'succeeded' && run.decision !== 'approved' && !decide.isPending;
  const canReject = !hold && run.decision !== 'rejected' && !words.busy && !decide.isPending;

  const choose = (r: EnhancementRun) => {
    setChosenId(r.id);
    setNoteOpen(false);
    setNote(r.decisionNote ?? '');
  };

  const decideNow = useCallback(
    (decision: 'approved' | 'rejected') => {
      if (decision === 'approved' ? !canApprove : !canReject) return;
      decide.mutate(
        { projectId: project.id, imageId: image.id, runId: run.id, decision },
        {
          onSuccess: (p) => {
            apply(p);
            onAdvance(p);
          },
        }
      );
    },
    [canApprove, canReject, decide, project.id, image.id, run.id, apply, onAdvance]
  );

  const makeRevision = async () => {
    try {
      await decide.mutateAsync({ projectId: project.id, imageId: image.id, runId: run.id, decision: 'revision', note: noteText });
      const p = await revise.mutateAsync({ projectId: project.id, imageIds: [image.id], model, revisionNote: noteText });
      const last = p.images.find((i) => i.id === image.id)?.enhancements.at(-1);
      if (last) setChosenId(last.id);
      setNoteOpen(false);
      setNote('');
    } catch {
      // Each refusal is shown beside its button.
    }
  };

  // Review's keys (lib/reviewKeys.ts): never while typing, none of them spends.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    const action = keyAction(e, { view: 'focus' });
    if (!action) return;
    switch (action.type) {
      case 'approve':
        decideNow('approved');
        break;
      case 'reject':
        decideNow('rejected');
        break;
      case 'note':
        if (!hold && !words.busy) setNoteOpen(true);
        break;
      case 'prev':
        if (index > 0) onPick(order[index - 1]!.id);
        break;
      case 'next':
        if (index < order.length - 1) onPick(order[index + 1]!.id);
        break;
      case 'version': {
        const r = runs[action.index];
        if (r) choose(r);
        break;
      }
      case 'showRender':
        setShowRender(true);
        break;
      case 'fullSize':
        setFull({ src: after && run.state === 'succeeded' ? after : mediaUrl(image.workKey), kind: 'still', alt: altOf(image, `version ${run.version}`), caption: `${image.code} v${run.version}` });
        break;
      case 'grid':
        onToggleView();
        break;
      case 'nextUndecided': {
        const next = nextUndecided(project, image.id);
        if (next) onPick(next);
        break;
      }
      case 'close':
        if (noteOpen) setNoteOpen(false);
        return;
      case 'shortcuts':
        // The page's own ? opens the sheet.
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') setShowRender(false);
    };
    const blur = () => setShowRender(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const s = run.settings;
  const on = ENHANCEMENT_KEYS.filter((k) => s.enhancements[k]).map((k) => ENHANCEMENT_LABELS[k]);
  const analysis = image.analysis?.state === 'succeeded' ? image.analysis.result : undefined;

  return (
    <div className={styles.focus}>
      <div className={styles.stage}>
        <div className={styles.viewer}>
          {run.state === 'succeeded' && after ? (
            <CompareSlider
              before={mediaUrl(image.workKey)}
              after={after}
              beforeAlt={altOf(image, 'the render')}
              afterAlt={altOf(image, `version ${run.version}`)}
              afterLabel={`Version ${run.version}`}
              width={size.width}
              height={size.height}
              maxHeight="calc(100dvh - 300px)"
              showBefore={showRender}
            />
          ) : (
            <div className={styles.waitFrame} style={{ ['--ar' as string]: String(image.width / image.height) }}>
              <Picture
                src={mediaUrl(image.workKey)}
                alt={altOf(image, 'the render')}
                width={image.width}
                height={image.height}
                working={words.busy ? { words: `Version ${run.version}: ${words.words}`, progress: run.progress, since: Date.parse(run.createdAt) } : null}
                error={run.state === 'failed' ? (run.error || 'This version did not finish.') : null}
                eager
              />
            </div>
          )}
        </div>
        <Filmstrip
          label="Pictures to review"
          activeId={image.id}
          onPick={onPick}
          items={order.map((i) => {
            const made = newestMade(i);
            const sz = made?.outputSize ?? i;
            return { id: i.id, src: made ? outputUrl(made) : mediaUrl(i.thumbKey), alt: altOf(i), width: sz.width, height: sz.height, code: i.code, state: pictureState(i) };
          })}
        />
      </div>

      <aside className={styles.panel} aria-label={`${image.code} decision`}>
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>
            <Heading level={2}>{image.code}</Heading>
            <Text type="supporting" color="secondary" maxLines={1}>
              {image.name}
            </Text>
          </div>
          {after && run.state === 'succeeded' && (
            <FullSize compact media={{ src: after, kind: 'still', alt: altOf(image, `version ${run.version}`), caption: `${image.code} v${run.version}` }} />
          )}
        </div>

        <div className={styles.versions} role="group" aria-label={`${image.code} versions`}>
          {runs.map((r, i) => (
            <button key={r.id} type="button" className={styles.version} aria-pressed={r.id === run.id} onClick={() => choose(r)} title={`Version ${r.version}: ${jobWords(r, DECISION_WORDS[r.decision]).words}${i < 9 ? ` (${i + 1})` : ''}`}>
              <span className="num">v{r.version}</span>
              <StatusDot
                variant={r.state === 'failed' ? 'error' : r.state === 'succeeded' ? DECISION_DOT[r.decision] : 'accent'}
                label={jobWords(r, DECISION_WORDS[r.decision]).words}
                isPulsing={r.state === 'queued' || r.state === 'running'}
              />
            </button>
          ))}
        </div>

        <Text type="supporting" color="secondary" as="p">
          <span className="num">
            {words.busy ? words.words : DECISION_WORDS[run.decision]}, {run.imageSize}
            {run.outputSize ? `, ${sizeWords(run.outputSize)}` : ''}
          </span>
        </Text>
        {run.revisionNote && (
          <Text type="supporting" color="secondary" as="p">
            Made from the note: {run.revisionNote}
          </Text>
        )}
        {run.decision === 'revision' && run.decisionNote && (
          <Text type="supporting" color="secondary" as="p">
            Note: {run.decisionNote}
          </Text>
        )}

        <div className={styles.actions}>
          <Button
            label="Approve"
            variant="primary"
            icon={<Check size={16} aria-hidden />}
            isDisabled={!canApprove}
            isLoading={decide.isPending && decide.variables?.decision === 'approved'}
            tooltip="Approve (A)"
            onClick={() => decideNow('approved')}
            width="100%"
          />
          <div className={styles.actionPair}>
            <Button
              label="Reject"
              variant="secondary"
              icon={<X size={16} aria-hidden />}
              isDisabled={!canReject}
              isLoading={decide.isPending && decide.variables?.decision === 'rejected'}
              tooltip="Reject (R)"
              onClick={() => decideNow('rejected')}
              width="100%"
            />
            <Button
              label="Ask for a revision"
              variant="ghost"
              icon={<MessageSquare size={16} aria-hidden />}
              isDisabled={!!hold || words.busy}
              tooltip="Write a revision note (V)"
              onClick={() => setNoteOpen((o) => !o)}
              width="100%"
            />
          </div>
          {hold && (
            <Text type="supporting" color="secondary" as="p">
              {hold}
            </Text>
          )}
          {decide.error && !noteOpen && (
            <p className={screen.error} role="alert">
              {errorText(decide.error)}
            </p>
          )}
        </div>

        {noteOpen && !hold && (
          <div className={styles.revision}>
            <TextArea
              label="What should change"
              description="Within the picture's rules. The new version is made from this note."
              value={note}
              onChange={(v: string) => setNote(v)}
              rows={3}
              maxLength={400}
              htmlMaxLength={400}
              hasAutoFocus
            />
            <SpendButton
              label="Make revised version"
              icon={<RotateCcw size={16} aria-hidden />}
              variant="secondary"
              asks={[enhanceAsk(image, model)]}
              loading={decide.isPending || revise.isPending}
              error={errorText(decide.error) ?? errorText(revise.error)}
              holdWhy={versionBusy ? 'A version is being made.' : noteText ? null : 'Write the note first.'}
              onPress={() => void makeRevision()}
            />
          </div>
        )}

        <hr className={screen.divider} />

        <section className={styles.block} aria-label="What the analysis saw">
          <Heading level={4} accessibilityLevel={3}>
            What the analysis saw
          </Heading>
          <Text type="supporting" color={analysis ? 'primary' : 'secondary'} as="p">
            {analysis ? analysis.summary : 'This render was not analysed.'}
          </Text>
        </section>

        <section className={styles.block} aria-label="Settings used">
          <Heading level={4} accessibilityLevel={3}>
            Settings used for v{run.version}
          </Heading>
          <MetadataList>
            <MetadataListItem label="Mode">{FIDELITY_LABELS[s.mode]}</MetadataListItem>
            <MetadataListItem label="Lighting">{s.lighting === 'custom' ? s.lightingCustom || 'Custom' : LIGHTING_LABELS[s.lighting]}</MetadataListItem>
            <MetadataListItem label="Enhancements">{on.length > 0 ? on.join(', ') : 'None'}</MetadataListItem>
            <MetadataListItem label="Output">{s.output === 'custom' ? `${s.customLongEdge} px long edge` : OUTPUT_LABELS[s.output]}</MetadataListItem>
            <MetadataListItem label="Model">{MODEL_INFO[model].words}</MetadataListItem>
          </MetadataList>
        </section>
      </aside>

      <FullSizeView media={full} onClose={() => setFull(null)} />
    </div>
  );
}

/** The grid view: the newest versions on a contact sheet, to approve several at once. */
function Grid({ project, images, onOpen, onToggleView }: { project: Project; images: ProjectImage[]; onOpen: (id: string) => void; onToggleView: () => void }) {
  const apply = useApply();
  const decide = trpc.image.decide.useMutation();
  const selection = useSelection(images.map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const a = keyAction(e, { view: 'grid' });
      if (a?.type === 'grid') {
        e.preventDefault();
        onToggleView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleView]);

  const picked = selection.ids.map((id) => images.find((i) => i.id === id)).filter((i): i is ProjectImage => !!i);
  const approvable = picked.filter((i) => {
    const last = latestEnhancement(i);
    return !holdOf(i) && last?.state === 'succeeded' && last.decision !== 'approved';
  });

  // One picture at a time, in order; the first refusal stops the rest and says which picture.
  const approveAll = async () => {
    setBusy(true);
    setResult(null);
    let done = 0;
    for (const image of approvable) {
      const run = latestEnhancement(image)!;
      try {
        const p = await decide.mutateAsync({ projectId: project.id, imageId: image.id, runId: run.id, decision: 'approved' });
        apply(p);
        done += 1;
      } catch (err) {
        setResult(`${image.code} was not approved: ${errorText(err)}${done > 0 ? ` The ${done} before it were.` : ''}`);
        setBusy(false);
        return;
      }
    }
    setResult(`Approved ${done} ${done === 1 ? 'picture' : 'pictures'}.`);
    selection.clear();
    setBusy(false);
  };

  const items: SheetItem[] = images.map((image) => {
    const last = latestEnhancement(image)!;
    const made = newestMade(image);
    const size = made?.outputSize ?? image;
    const w = jobWords(last);
    return {
      id: image.id,
      src: made ? outputUrl(made) : mediaUrl(image.thumbKey),
      alt: altOf(image, made ? `version ${made.version}` : 'the render'),
      width: size.width,
      height: size.height,
      code: image.code,
      name: image.name,
      meta: `v${last.version}, ${w.busy ? w.words : DECISION_WORDS[last.decision]}`,
      locked: !!image.master?.locked,
      state: pictureState(image),
      working: w.busy ? { words: w.words, progress: last.progress, since: Date.parse(last.createdAt) } : null,
    };
  });

  return (
    <div className={styles.grid}>
      <ContactSheet items={items} label="Newest versions" selection={selection} onOpen={onOpen} />
      <p className={`${screen.quiet} ${styles.gridHint}`}>Double-click a picture to judge it in the focus view.</p>
      {(picked.length > 0 || result) && (
        <SelectionBar
          count={picked.length}
          onClear={selection.clear}
          note={result ?? (approvable.length < picked.length ? `${picked.length - approvable.length} cannot be approved now.` : null)}
          action={
            <FreeButton
              label={`Approve ${approvable.length}`}
              note="No charge"
              variant="primary"
              icon={<Check size={16} aria-hidden />}
              loading={busy}
              disabled={approvable.length === 0}
              onPress={() => void approveAll()}
            />
          }
        />
      )}
    </div>
  );
}
