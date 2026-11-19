import { ArrowDown, ArrowUp, Check, Clapperboard, PenLine, Trash2, Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  FILM_FORMAT_LABELS,
  FILM_FORMATS,
  type FilmFormat,
  mediaUrl,
  outputUrl,
  type Project,
  type Shot,
  SHOT_TYPES,
  type Transition,
  TRANSITIONS,
} from '../../shared/project.ts';
import { Section } from '../layouts/Section.tsx';
import { bulkLabel, shotAsk } from '../lib/spend.ts';
import { altOf, droppedClipsWords, jobWords, keptClips } from '../lib/stages.ts';
import { FREE_THINKING } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import { Button } from '../ui/Button.tsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx';
import { FullSize } from '../ui/FullSize.tsx';
import { RenderingStatus } from '../ui/RenderingStatus.tsx';
import { Select } from '../ui/Select.tsx';
import styles from '../Stages.module.css';

const BATCH = 20;
const busy = (s: string | undefined) => s === 'queued' || s === 'running';

/** A shot "Make all clips" takes: no clip yet, or the last one failed or was rejected. */
function wantsClip(shot: Shot): boolean {
  const v = shot.video;
  return !v || v.state === 'failed' || v.decision === 'rejected';
}

const TRANSITION_LABELS: Record<Transition, string> = { cut: 'Cut', fade: 'Fade' };

export function StoryboardStage({ project }: { project: Project }) {
  const apply = useApply();
  const sb = project.storyboard;
  const [brief, setBrief] = useState(sb?.brief ?? '');
  const [format, setFormat] = useState<FilmFormat>(sb?.format ?? '16:9');
  const write = trpc.storyboard.create.useMutation({ onSuccess: apply });
  const clips = trpc.shot.generate.useMutation({ onSuccess: apply });
  const writing = sb?.state === 'running';
  const shots = sb?.shots ?? [];
  const clipBusy = shots.some((s) => busy(s.video?.state));
  const batch = writing ? [] : shots.filter(wantsClip).slice(0, BATCH);
  const kept = keptClips(shots);
  const [asking, setAsking] = useState(false);
  const writeAgain = () => write.mutate({ projectId: project.id, brief, format }, { onSuccess: () => setAsking(false) });

  return (
    <>
      <Section
        title="Storyboard"
        description="Built from your approved 4K masters: shot order, camera direction and a video prompt per shot."
      >
        <div className={styles.briefRow}>
          <label className={styles.textBox}>
            <span className={styles.fieldLabel}>Brief</span>
            <textarea
              className={styles.textarea}
              rows={3}
              maxLength={2000}
              value={brief}
              placeholder="What the film is for, its mood, who it is for."
              onChange={(e) => setBrief(e.target.value)}
            />
          </label>
          <Select
            label="Format"
            value={format}
            showHint={false}
            options={FILM_FORMATS.map((f) => ({ id: f, name: FILM_FORMAT_LABELS[f] }))}
            onChange={(v) => setFormat(v as FilmFormat)}
          />
        </div>
        <FreeButton
          label={sb ? 'Write storyboard again' : 'Write storyboard'}
          note={FREE_THINKING}
          variant="primary"
          icon={<PenLine size={16} aria-hidden />}
          loading={write.isPending || writing}
          disabled={clipBusy}
          why={clipBusy ? 'A clip is still being made. Wait for it to finish first.' : null}
          error={errorText(write.error)}
          onPress={() => (kept > 0 ? setAsking(true) : writeAgain())}
        />
        <ConfirmDialog
          isOpen={asking}
          title="Write the storyboard again?"
          confirmLabel={kept === 1 ? 'Write it, drop 1 clip' : `Write it, drop ${kept} clips`}
          loading={write.isPending}
          error={errorText(write.error) ?? undefined}
          onConfirm={writeAgain}
          onCancel={() => setAsking(false)}
        >
          {droppedClipsWords(kept)}
        </ConfirmDialog>
        {writing && (
          <div className={styles.renderFrame} style={{ aspectRatio: '16 / 3' }}>
            <RenderingStatus label="Writing the storyboard…" runKey={sb?.claimId} since={sb?.claimedAt ? Date.parse(sb.claimedAt) : undefined} />
          </div>
        )}
        {sb?.state === 'failed' && (
          <p className={styles.error} role="alert">
            {sb.error || 'The storyboard was not written. Try again.'}
          </p>
        )}
      </Section>

      {sb && shots.length > 0 && (
        <Section title={sb.title || 'Untitled film'} description={`${FILM_FORMAT_LABELS[sb.format]} · ${shots.length} shots`}>
          <dl className={styles.facts}>
            <dt>Narrative</dt>
            <dd>{sb.narrative}</dd>
            <dt>Grade</dt>
            <dd>{sb.grade}</dd>
            <dt>Music direction</dt>
            <dd>{sb.musicDirection}</dd>
          </dl>
          {batch.length > 0 && (
            <div className={styles.toolbar}>
              <SpendButton
                label={bulkLabel('Make all clips', batch.length)}
                icon={<Video size={16} aria-hidden />}
                asks={batch.map(shotAsk)}
                loading={clips.isPending}
                error={errorText(clips.error)}
                onPress={() => clips.mutate({ projectId: project.id, shotIds: batch.map((s) => s.id) })}
              />
            </div>
          )}
          <ol className={styles.cards}>
            {shots.map((shot, i) => (
              <ShotCard key={shot.id} project={project} shot={shot} index={i} count={shots.length} frozen={writing} />
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}

type EditableText = 'shotType' | 'creativeDirection' | 'cameraMovement' | 'speed' | 'lighting' | 'humanActivity' | 'purpose' | 'videoPrompt';

const FIELDS: Array<{ key: EditableText; label: string; max: number; long?: boolean }> = [
  { key: 'creativeDirection', label: 'Creative direction', max: 1000, long: true },
  { key: 'cameraMovement', label: 'Camera movement', max: 1000 },
  { key: 'speed', label: 'Speed', max: 80 },
  { key: 'lighting', label: 'Lighting', max: 1000 },
  { key: 'humanActivity', label: 'Human activity', max: 1000 },
  { key: 'purpose', label: 'Purpose', max: 1000 },
  { key: 'videoPrompt', label: 'Video prompt', max: 2000, long: true },
];

function ShotCard({ project, shot, index, count, frozen }: { project: Project; shot: Shot; index: number; count: number; frozen: boolean }) {
  const apply = useApply();
  const update = trpc.storyboard.updateShot.useMutation({ onSuccess: apply });
  const move = trpc.storyboard.moveShot.useMutation({ onSuccess: apply });
  const remove = trpc.storyboard.removeShot.useMutation({ onSuccess: apply });
  const make = trpc.shot.generate.useMutation({ onSuccess: apply });
  const decide = trpc.shot.decide.useMutation({ onSuccess: apply });
  const image = project.images.find((i) => i.id === shot.imageId);
  const video = shot.video;
  const words = jobWords(video, video?.decision === 'approved' ? 'Approved' : video?.decision === 'rejected' ? 'Rejected' : 'Made');
  // A kept clip put back after making it again failed carries why.
  const againError = video?.state === 'succeeded' && video.error ? `Making the clip again did not finish: ${video.error} The earlier clip is kept.` : null;
  const clip = video ? outputUrl(video) : undefined;
  const ids = { projectId: project.id, shotId: shot.id };
  const disabled = frozen || words.busy;

  const [draft, setDraft] = useState(shot);
  const saved = JSON.stringify(shot);
  useEffect(() => setDraft(JSON.parse(saved) as Shot), [saved]);
  const save = (edit: Partial<Shot>) => update.mutate({ ...ids, ...edit });
  const blurText = (k: EditableText) => {
    if (draft[k] !== shot[k]) save({ [k]: draft[k] });
  };

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        {image?.master?.storedKey && (
          <img className={styles.cardThumb} src={mediaUrl(image.master.storedKey)} alt={altOf(image, 'master')} loading="lazy" />
        )}
        <div className={styles.cardTitle}>
          <span className={styles.code}>
            Shot {shot.number} · {image?.code ?? 'image gone'}
          </span>
          <label className={styles.inline}>
            <span className={styles.fieldLabel}>Shot type</span>
            <input
              className={styles.input}
              list={`shot-types-${shot.id}`}
              value={draft.shotType}
              maxLength={80}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, shotType: e.target.value })}
              onBlur={() => blurText('shotType')}
            />
            <datalist id={`shot-types-${shot.id}`}>
              {SHOT_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
        </div>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowUp size={14} aria-hidden />}
            aria-label={`Move shot ${shot.number} earlier`}
            disabled={frozen || index === 0}
            onPress={() => move.mutate({ ...ids, to: index - 1 })}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowDown size={14} aria-hidden />}
            aria-label={`Move shot ${shot.number} later`}
            disabled={frozen || index === count - 1}
            onPress={() => move.mutate({ ...ids, to: index + 1 })}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} aria-hidden />}
            aria-label={`Remove shot ${shot.number}`}
            disabled={disabled}
            loading={remove.isPending}
            onPress={() => remove.mutate(ids)}
          />
        </div>
      </div>

      <div className={styles.shotGrid}>
        {FIELDS.map((f) => (
          <label key={f.key} className={f.long ? `${styles.textBox} ${styles.wide}` : styles.textBox}>
            <span className={styles.fieldLabel}>{f.label}</span>
            {f.long ? (
              <textarea
                className={styles.textarea}
                rows={3}
                maxLength={f.max}
                value={draft[f.key]}
                disabled={disabled}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                onBlur={() => blurText(f.key)}
              />
            ) : (
              <input
                className={styles.input}
                maxLength={f.max}
                value={draft[f.key]}
                disabled={disabled}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                onBlur={() => blurText(f.key)}
              />
            )}
          </label>
        ))}
        <label className={styles.textBox}>
          <span className={styles.fieldLabel}>Seconds (2 to 10)</span>
          <input
            className={styles.input}
            type="number"
            min={2}
            max={10}
            step={1}
            value={draft.durationSeconds}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, durationSeconds: Math.round(Number(e.target.value)) })}
            onBlur={() => {
              const s = Math.min(10, Math.max(2, Number.isFinite(draft.durationSeconds) ? draft.durationSeconds : shot.durationSeconds));
              setDraft({ ...draft, durationSeconds: s });
              if (s !== shot.durationSeconds) save({ durationSeconds: s });
            }}
          />
        </label>
        <Select
          label="Transition"
          value={draft.transition}
          disabled={disabled}
          showHint={false}
          options={TRANSITIONS.map((t) => ({ id: t, name: TRANSITION_LABELS[t] }))}
          onChange={(v) => save({ transition: v as Transition })}
        />
      </div>
      {(update.error || move.error || remove.error) && (
        <p className={styles.error} role="alert">
          {errorText(update.error ?? move.error ?? remove.error)}
        </p>
      )}

      <div className={styles.clipRow}>
        {video && video.state === 'succeeded' && clip ? (
          <video className={styles.clip} src={clip} controls playsInline preload="metadata" aria-label={`Shot ${shot.number} clip`} />
        ) : video && words.busy ? (
          <div className={styles.renderFrame} style={{ aspectRatio: '16 / 9', maxWidth: 320 }}>
            <RenderingStatus label={`Shot ${shot.number}: ${words.words}`} progress={video.progress} runKey={video.createdAt} since={Date.parse(video.createdAt)} />
          </div>
        ) : null}
        <div className={styles.cardTitle}>
          {video && <span className={styles.status}>Clip: {words.words}</span>}
          {(words.error ?? againError) && (
            <span className={styles.error} role="alert">
              {words.error ?? againError}
            </span>
          )}
          <div className={styles.actions}>
            {clip && video?.state === 'succeeded' && (
              <>
                <FullSize src={clip} kind="clip" title={`Shot ${shot.number}`} alt={`Shot ${shot.number} clip`} />
                <Button
                  variant="primary"
                  icon={<Check size={16} aria-hidden />}
                  disabled={video.decision === 'approved'}
                  loading={decide.isPending && decide.variables?.decision === 'approved'}
                  onPress={() => decide.mutate({ ...ids, decision: 'approved' })}
                >
                  Approve
                </Button>
                <Button
                  icon={<X size={16} aria-hidden />}
                  disabled={video.decision === 'rejected'}
                  loading={decide.isPending && decide.variables?.decision === 'rejected'}
                  onPress={() => decide.mutate({ ...ids, decision: 'rejected' })}
                >
                  Reject
                </Button>
              </>
            )}
          </div>
          {decide.error && (
            <span className={styles.error} role="alert">
              {errorText(decide.error)}
            </span>
          )}
          {!words.busy && (
            <SpendButton
              label={video ? 'Make clip again' : 'Make clip'}
              icon={<Clapperboard size={16} aria-hidden />}
              variant={video ? 'default' : 'primary'}
              asks={[shotAsk(shot)]}
              loading={make.isPending}
              error={errorText(make.error)}
              holdWhy={frozen ? 'The storyboard is still being written.' : null}
              onPress={() => make.mutate({ projectId: project.id, shotIds: [shot.id] })}
            />
          )}
        </div>
      </div>
    </li>
  );
}
