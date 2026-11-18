import { Check, MessageSquare, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';

import {
  type EnhancementRun,
  mediaUrl,
  outputUrl,
  type Project,
  type ProjectImage,
} from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL, ENHANCE_MODELS, type EnhanceModel } from '../../server/models.ts';
import { Section } from '../layouts/Section.tsx';
import { enhanceAsk } from '../lib/spend.ts';
import { altOf, jobWords, sizeWords } from '../lib/stages.ts';
import { LOCKED_MASTER } from '../lib/words.ts';
import { errorText, SpendButton } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import { Button } from '../ui/Button.tsx';
import { CompareSlider } from '../ui/CompareSlider.tsx';
import { FullSize } from '../ui/FullSize.tsx';
import { RenderingStatus } from '../ui/RenderingStatus.tsx';
import styles from '../Stages.module.css';

const DECISION_WORDS: Record<EnhancementRun['decision'], string> = {
  pending: 'Not decided',
  approved: 'Approved',
  rejected: 'Rejected',
  revision: 'Revision asked',
};

/** The model a version was made with, for its revision; the default when it is not one of the three. */
function modelOf(run: EnhancementRun): EnhanceModel {
  const m = (run as EnhancementRun & { model?: string }).model;
  return (ENHANCE_MODELS as readonly string[]).includes(m ?? '') ? (m as EnhanceModel) : DEFAULT_ENHANCE_MODEL;
}

export function ReviewStage({ project }: { project: Project }) {
  const images = project.images.filter((i) => i.enhancements.length > 0);
  return (
    <Section
      title="Review"
      description="Compare each version with its render. Approve one per image; it becomes the source of its 4K master."
    >
      <ul className={styles.cards}>
        {images.map((image) => (
          <ReviewCard key={image.id} project={project} image={image} />
        ))}
      </ul>
    </Section>
  );
}

function ReviewCard({ project, image }: { project: Project; image: ProjectImage }) {
  const apply = useApply();
  const runs = image.enhancements;
  const [chosenId, setChosenId] = useState<string | null>(null);
  const run = runs.find((r) => r.id === chosenId) ?? runs[runs.length - 1]!;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(run.decisionNote ?? '');
  const decide = trpc.image.decide.useMutation({ onSuccess: apply });
  const revise = trpc.image.enhance.useMutation({ onSuccess: apply });
  const locked = !!image.master?.locked;
  const masterBusy = image.master?.state === 'queued' || image.master?.state === 'running';
  const words = jobWords(run, DECISION_WORDS[run.decision]);
  const after = outputUrl(run);
  const ratio = run.outputSize ? `${run.outputSize.width} / ${run.outputSize.height}` : `${image.width} / ${image.height}`;
  const hold = locked ? LOCKED_MASTER : masterBusy ? "This image's master is being made." : null;
  const noteText = note.trim();
  const model = modelOf(run);

  const choose = (r: EnhancementRun) => {
    setChosenId(r.id);
    setNoteOpen(false);
    setNote(r.decisionNote ?? '');
  };

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

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <span className={styles.code}>{image.code}</span>
          <span className={styles.name}>{image.name}</span>
        </div>
        <div className={styles.versions} role="group" aria-label={`${image.code} versions`}>
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className={styles.version}
              aria-pressed={r.id === run.id}
              data-decision={r.decision}
              onClick={() => choose(r)}
            >
              v{r.version}
              {r.decision === 'approved' && <Check size={12} aria-label="approved" />}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.compare}>
        {run.state === 'succeeded' && after ? (
          <CompareSlider
            before={mediaUrl(image.workKey)}
            after={after}
            beforeAlt={altOf(image, 'the render')}
            afterAlt={altOf(image, `version ${run.version}`)}
            aspectRatio={ratio}
          />
        ) : run.state === 'failed' ? (
          <div className={styles.failedFrame}>
            <p className={styles.error} role="alert">
              {run.error || 'This version did not finish.'}
            </p>
          </div>
        ) : (
          <div className={styles.renderFrame} style={{ aspectRatio: ratio }}>
            <RenderingStatus label={`v${run.version}: ${words.words}`} progress={run.progress} runKey={run.id} since={Date.parse(run.createdAt)} />
          </div>
        )}
      </div>

      <div className={styles.reviewBar}>
        <div className={styles.cardTitle}>
          <span className={styles.status}>
            v{run.version} · {run.imageSize} · {words.busy ? words.words : DECISION_WORDS[run.decision]}
            {run.outputSize ? ` · ${sizeWords(run.outputSize)}` : ''}
          </span>
          {run.revisionNote && <span className={styles.meta}>Made from the note: {run.revisionNote}</span>}
          {run.decision === 'revision' && run.decisionNote && <span className={styles.meta}>Note: {run.decisionNote}</span>}
          {hold && <span className={styles.why}>{hold}</span>}
        </div>
        <div className={styles.actions}>
          {after && run.state === 'succeeded' && (
            <FullSize src={after} kind="still" title={`${image.code} v${run.version}`} alt={altOf(image, `version ${run.version}`)} />
          )}
          <Button
            variant="primary"
            icon={<Check size={16} aria-hidden />}
            disabled={!!hold || run.state !== 'succeeded' || run.decision === 'approved'}
            loading={decide.isPending && decide.variables?.decision === 'approved'}
            onPress={() => decide.mutate({ projectId: project.id, imageId: image.id, runId: run.id, decision: 'approved' })}
          >
            Approve
          </Button>
          <Button
            icon={<X size={16} aria-hidden />}
            disabled={!!hold || run.decision === 'rejected' || words.busy}
            loading={decide.isPending && decide.variables?.decision === 'rejected'}
            onPress={() => decide.mutate({ projectId: project.id, imageId: image.id, runId: run.id, decision: 'rejected' })}
          >
            Reject
          </Button>
          <Button
            variant="ghost"
            icon={<MessageSquare size={16} aria-hidden />}
            disabled={!!hold || words.busy}
            onPress={() => setNoteOpen((o) => !o)}
          >
            Ask for a revision
          </Button>
        </div>
      </div>
      {decide.error && !noteOpen && (
        <p className={styles.error} role="alert">
          {errorText(decide.error)}
        </p>
      )}

      {noteOpen && !hold && (
        <div className={styles.revision}>
          <label className={styles.textBox}>
            <span className={styles.fieldLabel}>What should change, within the image's rules?</span>
            <textarea
              className={styles.textarea}
              rows={3}
              maxLength={400}
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <SpendButton
            label="Make revised version"
            icon={<RotateCcw size={16} aria-hidden />}
            asks={[enhanceAsk(image, model)]}
            loading={decide.isPending || revise.isPending}
            error={errorText(decide.error) ?? errorText(revise.error)}
            holdWhy={noteText ? null : 'Write the note first.'}
            onPress={() => void makeRevision()}
          />
        </div>
      )}
    </li>
  );
}
