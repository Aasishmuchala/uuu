import { Check, Clapperboard, PenLine, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  FILM_FORMAT_LABELS,
  FILM_FORMATS,
  type FilmFormat,
  mediaUrl,
  outputUrl,
  type Project,
  type Shot,
  type Transition,
  TRANSITIONS,
} from '../../shared/project.ts';
import {
  AlertDialog,
  Banner,
  Button,
  Heading,
  MetadataList,
  MetadataListItem,
  NumberInput,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TextArea,
  TextInput,
} from '../kit.ts';
import { wantsClip } from '../lib/progress.ts';
import { capForSpend } from '../lib/selection.ts';
import { lengthHold, SAVING_LENGTH, shotAsk } from '../lib/spend.ts';
import { altOf, droppedClipsWords, jobWords, keptClips } from '../lib/stages.ts';
import { clock, totalSeconds } from '../lib/timeline.ts';
import { FREE_THINKING } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton } from '../money.tsx';
import { FilmPlayer } from '../parts/FilmPlayer.tsx';
import { FullSize } from '../parts/FullSize.tsx';
import { Picture } from '../parts/Picture.tsx';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { SelectionBar } from '../parts/SelectionBar.tsx';
import { ShotTimeline, type TimelineShot } from '../parts/ShotTimeline.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Storyboard.module.css';

const busy = (s: string | undefined) => s === 'queued' || s === 'running';
const TRANSITION_LABELS: Record<Transition, string> = { cut: 'Cut', fade: 'Fade' };
const FORMAT_RATIO: Record<FilmFormat, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

function shotState(shot: Shot): TimelineShot['state'] {
  const v = shot.video;
  if (!v) return { words: 'No clip yet', dot: 'neutral', working: false };
  if (busy(v.state)) return { words: v.state === 'queued' ? 'Clip waiting to be sent' : 'Clip being made', dot: 'accent', working: true };
  if (v.state === 'failed') return { words: 'Clip failed', dot: 'error', working: false };
  if (v.decision === 'approved') return { words: 'Clip approved', dot: 'success', working: false };
  if (v.decision === 'rejected') return { words: 'Clip rejected', dot: 'error', working: false };
  return { words: 'Clip to decide', dot: 'warning', working: false };
}

/** The film planned shot by shot: the brief, the shot timeline, each shot's details beside its clip. */
export function Storyboard({ project, focus }: { project: Project; focus?: string | undefined }) {
  const apply = useApply();
  const sb = project.storyboard;
  const shots = sb?.shots ?? [];
  const [brief, setBrief] = useState(sb?.brief ?? '');
  const [format, setFormat] = useState<FilmFormat>(sb?.format ?? '16:9');
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null);
  // The open shot's length is being saved: every clip button waits (REVIEW-APPS-ASTRYX 2).
  const [savingLength, setSavingLength] = useState(false);
  const write = trpc.storyboard.create.useMutation({ onSuccess: apply });
  const clips = trpc.shot.generate.useMutation({ onSuccess: apply });
  const move = trpc.storyboard.moveShot.useMutation({ onSuccess: apply });
  const writing = sb?.state === 'running';
  const clipBusy = shots.some((s) => busy(s.video?.state));
  const batch = writing ? [] : shots.filter((s) => wantsClip(s) && !busy(s.video?.state));
  const sentIds = capForSpend(batch.map((s) => s.id));
  const sent = batch.filter((s) => sentIds.includes(s.id));
  const kept = keptClips(shots);
  const writeAgain = () =>
    write.mutate(
      { projectId: project.id, brief, format },
      {
        onSuccess: () => {
          setAsking(false);
          setEditing(false);
        },
      }
    );
  const selected = shots.find((s) => s.id === selectedId) ?? shots[0] ?? null;
  const folded = !!sb && shots.length > 0 && !editing;

  useEffect(() => {
    if (focus) setSelectedId(focus);
  }, [focus]);

  const writeButton = (
    <FreeButton
      label={sb ? 'Write storyboard again' : 'Write storyboard'}
      note={FREE_THINKING}
      variant={sb ? 'secondary' : 'primary'}
      icon={<PenLine size={16} aria-hidden />}
      loading={write.isPending || writing}
      disabled={clipBusy}
      why={clipBusy ? 'A clip is still being made. Wait for it to finish first.' : null}
      error={errorText(write.error)}
      onPress={() => (kept > 0 ? setAsking(true) : writeAgain())}
    />
  );

  return (
    <div className={`${screen.screen} ${screen.wide}`}>
      <ScreenHeader title="Storyboard" sentence="Written from your locked masters: shot order, camera direction and a clip prompt for each shot." />

      {folded ? (
        <div className={styles.folded}>
          <div className={styles.foldedText}>
            <Text type="label">Brief</Text>
            <Text type="body" color="secondary" maxLines={1}>
              {sb!.brief || 'No brief given.'}
            </Text>
            <Text type="supporting" color="secondary">
              {FILM_FORMAT_LABELS[sb!.format]}
            </Text>
          </div>
          <Button label="Change brief" variant="ghost" size="sm" onClick={() => setEditing(true)} />
          {writeButton}
        </div>
      ) : (
        <section className={styles.brief} aria-label="Brief">
          <TextArea
            label="Brief"
            description="What the film is for, its mood, who it is for."
            value={brief}
            onChange={(v: string) => setBrief(v)}
            rows={3}
            maxLength={2000}
            htmlMaxLength={2000}
            isDisabled={writing}
          />
          <div className={styles.briefRow}>
            <div className={styles.format}>
              <Text type="label">Format</Text>
              <SegmentedControl label="Format" value={format} onChange={(v: string) => setFormat(v as FilmFormat)} size="sm">
                {FILM_FORMATS.map((f) => (
                  <SegmentedControlItem key={f} value={f} label={FILM_FORMAT_LABELS[f]} />
                ))}
              </SegmentedControl>
            </div>
            <div className={styles.briefEnd}>
              {sb && shots.length > 0 && <Button label="Keep the storyboard" variant="ghost" onClick={() => setEditing(false)} />}
              {writeButton}
            </div>
          </div>
        </section>
      )}

      <AlertDialog
        isOpen={asking}
        onOpenChange={(open: boolean) => !open && setAsking(false)}
        title="Write the storyboard again?"
        description={write.error ? `${droppedClipsWords(kept)} ${errorText(write.error)}` : droppedClipsWords(kept)}
        actionLabel={kept === 1 ? 'Write it, drop 1 clip' : `Write it, drop ${kept} clips`}
        isActionLoading={write.isPending}
        onAction={writeAgain}
      />

      {writing && (
        <div className={styles.writing}>
          <Picture alt="" width={16} height={3} working={{ words: 'Writing the storyboard…', since: sb?.claimedAt ? Date.parse(sb.claimedAt) : undefined }} />
        </div>
      )}
      {sb?.state === 'failed' && (
        <div className={styles.writing}>
          <Banner status="error" title={sb.error || 'The storyboard was not written.'} description="Change the brief if you like, then write it again." />
        </div>
      )}

      {sb && shots.length > 0 && (
        <>
          <section className={styles.film} aria-label="The film">
            <div className={styles.filmHead}>
              <Heading level={2}>{sb.title || 'Untitled film'}</Heading>
              <Text type="supporting" color="secondary">
                <span className="num">
                  {shots.length} shots, {clock(totalSeconds(shots))}
                </span>
              </Text>
            </div>
            {sb.narrative && (
              <Text type="body" color="secondary" as="p" maxLines={2}>
                {sb.narrative}
              </Text>
            )}
            <MetadataList orientation="horizontal">
              <MetadataListItem label="Grade">{sb.grade || 'Not set'}</MetadataListItem>
              <MetadataListItem label="Music direction">{sb.musicDirection || 'Not set'}</MetadataListItem>
            </MetadataList>
          </section>

          <ShotTimeline
            shots={shots.map((s) => {
              const image = project.images.find((i) => i.id === s.imageId);
              const m = image?.master;
              return {
                id: s.id,
                number: s.number,
                durationSeconds: s.durationSeconds,
                shotType: s.shotType,
                thumb: m?.storedKey ? mediaUrl(m.storedKey) : image ? mediaUrl(image.thumbKey) : undefined,
                thumbRatio: m?.outputSize ? m.outputSize.width / m.outputSize.height : image ? image.width / image.height : 16 / 9,
                alt: image ? altOf(image, 'master') : `Shot ${s.number}`,
                state: shotState(s),
              };
            })}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onMove={(id, to) => {
              if (!move.isPending) move.mutate({ projectId: project.id, shotId: id, to });
            }}
            lockedWhy={writing ? 'The storyboard is still being written.' : clipBusy ? 'A clip is being made. Shots can be moved again once it is done.' : null}
          />
          <p className={screen.quiet} style={{ marginTop: 'var(--spacing-2)' }}>
            {writing
              ? 'The storyboard is still being written.'
              : clipBusy
                ? 'A clip is being made. Shots can be moved again once it is done.'
                : 'Drag a shot to move it, or press Alt and an arrow key on a shot.'}
          </p>
          {move.error && (
            <p className={screen.error} role="alert">
              {errorText(move.error)}
            </p>
          )}

          {sent.length > 0 && (
            <SelectionBar
              sticky={false}
              count={batch.length}
              noun={['shot needs a clip', 'shots need a clip']}
              note={null}
              action={
                <SpendButton
                  label={`Make ${sent.length} ${sent.length === 1 ? 'clip' : 'clips'}`}
                  icon={<Clapperboard size={16} aria-hidden />}
                  asks={sent.map(shotAsk)}
                  loading={clips.isPending}
                  error={errorText(clips.error)}
                  holdWhy={savingLength ? SAVING_LENGTH : null}
                  onPress={() => clips.mutate({ projectId: project.id, shotIds: sent.map((s) => s.id) })}
                />
              }
            />
          )}
          {selected && <ShotDetail key={selected.id} project={project} shot={selected} format={sb.format} frozen={writing} onSavingLength={setSavingLength} />}
        </>
      )}
    </div>
  );
}

type EditableText = 'shotType' | 'creativeDirection' | 'cameraMovement' | 'speed' | 'lighting' | 'humanActivity' | 'purpose' | 'videoPrompt';

const SHORT: Array<{ key: EditableText; label: string; max: number }> = [
  { key: 'shotType', label: 'Shot type', max: 80 },
  { key: 'cameraMovement', label: 'Camera movement', max: 1000 },
  { key: 'speed', label: 'Speed', max: 80 },
  { key: 'lighting', label: 'Lighting', max: 1000 },
  { key: 'humanActivity', label: 'Human activity', max: 1000 },
  { key: 'purpose', label: 'Purpose', max: 1000 },
];

function ShotDetail({
  project,
  shot,
  format,
  frozen,
  onSavingLength,
}: {
  project: Project;
  shot: Shot;
  format: FilmFormat;
  frozen: boolean;
  onSavingLength: (saving: boolean) => void;
}) {
  const apply = useApply();
  // A refused edit puts the field back to the saved shot, so the clip button is not held for good.
  const update = trpc.storyboard.updateShot.useMutation({ onSuccess: apply, onError: () => setDraft(shot) });
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
  const [asking, setAsking] = useState(false);

  const [draft, setDraft] = useState(shot);
  const saved = JSON.stringify(shot);
  useEffect(() => setDraft(JSON.parse(saved) as Shot), [saved]);
  const save = (edit: Partial<Shot>) => update.mutate({ ...ids, ...edit });
  const lengthWhy = lengthHold(update.isPending, draft.durationSeconds, shot.durationSeconds);
  const savingLength = lengthWhy !== null;
  useEffect(() => {
    onSavingLength(savingLength);
    return () => onSavingLength(false);
  }, [savingLength, onSavingLength]);
  const blurText = (k: EditableText) => {
    if (draft[k] !== shot[k]) save({ [k]: draft[k] });
  };
  const ratio = FORMAT_RATIO[format];
  const master = image?.master;

  return (
    <section className={styles.detail} aria-label={`Shot ${shot.number}`}>
      <div className={styles.fields}>
        <div className={styles.detailHead}>
          <Heading level={3}>
            Shot {shot.number}
            <Text type="body" color="secondary">
              {' '}
              from {image?.code ?? 'a picture no longer here'}
            </Text>
          </Heading>
          <Button label={`Remove shot ${shot.number}`} variant="ghost" size="sm" isIconOnly icon={<Trash2 size={15} aria-hidden />} tooltip="Remove this shot" isDisabled={disabled} onClick={() => setAsking(true)} />
        </div>
        <div onBlur={() => blurText('creativeDirection')}>
          <TextArea label="Creative direction" value={draft.creativeDirection} onChange={(v: string) => setDraft({ ...draft, creativeDirection: v })} rows={3} maxLength={1000} htmlMaxLength={1000} isDisabled={disabled} />
        </div>
        <div className={styles.shortFields}>
          {SHORT.map((f) => (
            <div key={f.key} onBlur={() => blurText(f.key)}>
              <TextInput label={f.label} value={draft[f.key]} onChange={(v: string) => setDraft({ ...draft, [f.key]: v.slice(0, f.max) })} isDisabled={disabled} size="sm" />
            </div>
          ))}
          <NumberInput
            label="Seconds"
            description="2 to 10"
            value={draft.durationSeconds}
            min={2}
            max={10}
            step={1}
            isIntegerOnly
            hasNumberSteppers
            isDisabled={disabled}
            size="sm"
            onChange={(v: number | null) => {
              const s = Math.min(10, Math.max(2, typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : shot.durationSeconds));
              setDraft({ ...draft, durationSeconds: s });
              if (s !== shot.durationSeconds) save({ durationSeconds: s });
            }}
          />
          <div className={styles.transition}>
            <Text type="label">Transition after</Text>
            <SegmentedControl label="Transition after" value={draft.transition} onChange={(v: string) => save({ transition: v as Transition })} size="sm" isDisabled={disabled} layout="fill">
              {TRANSITIONS.map((t) => (
                <SegmentedControlItem key={t} value={t} label={TRANSITION_LABELS[t]} />
              ))}
            </SegmentedControl>
          </div>
        </div>
        <div onBlur={() => blurText('videoPrompt')}>
          <TextArea label="Clip prompt" description="Exactly what is sent to make the clip." value={draft.videoPrompt} onChange={(v: string) => setDraft({ ...draft, videoPrompt: v })} rows={4} maxLength={2000} htmlMaxLength={2000} isDisabled={disabled} />
        </div>
        {(update.error || remove.error) && (
          <p className={screen.error} role="alert">
            {errorText(update.error ?? remove.error)}
          </p>
        )}
      </div>

      <div className={styles.clip}>
        {video && video.state === 'succeeded' && clip ? (
          // The app's own player, as on Film: the clip's first frame and a play button, never the
          // browser's controls (they showed a loading spinner over an approved clip).
          <FilmPlayer
            clips={[{ src: clip, seconds: shot.durationSeconds, label: `Shot ${shot.number} clip` }]}
            ratio={video.width && video.height ? video.width / video.height : ratio}
            label={`Shot ${shot.number} clip`}
            maxHeight="48vh"
          />
        ) : (
          <Picture
            src={master?.storedKey ? mediaUrl(master.storedKey) : image ? mediaUrl(image.thumbKey) : undefined}
            alt={image ? altOf(image, 'master') : `Shot ${shot.number}`}
            width={master?.outputSize?.width ?? image?.width ?? 16}
            height={master?.outputSize?.height ?? image?.height ?? 9}
            working={video && words.busy ? { words: `Clip: ${words.words}`, progress: video.progress, since: Date.parse(video.createdAt) } : null}
            error={words.error}
          />
        )}
        <div className={styles.clipBar}>
          <Text type="supporting" color="secondary">
            {video ? `Clip: ${words.words}` : 'No clip yet. The clip starts from this master.'}
          </Text>
          {clip && video?.state === 'succeeded' && (
            <FullSize compact media={{ src: clip, kind: 'clip', alt: `Shot ${shot.number} clip`, caption: `Shot ${shot.number}` }} />
          )}
        </div>
        {againError && (
          <p className={screen.error} role="alert">
            {againError}
          </p>
        )}
        {clip && video?.state === 'succeeded' && (
          <div className={styles.clipActions}>
            <Button
              label="Approve"
              variant="secondary"
              icon={<Check size={16} aria-hidden />}
              isDisabled={video.decision === 'approved'}
              isLoading={decide.isPending && decide.variables?.decision === 'approved'}
              onClick={() => decide.mutate({ ...ids, decision: 'approved' })}
            />
            <Button
              label="Reject"
              variant="ghost"
              icon={<X size={16} aria-hidden />}
              isDisabled={video.decision === 'rejected'}
              isLoading={decide.isPending && decide.variables?.decision === 'rejected'}
              onClick={() => decide.mutate({ ...ids, decision: 'rejected' })}
            />
          </div>
        )}
        {decide.error && (
          <p className={screen.error} role="alert">
            {errorText(decide.error)}
          </p>
        )}
        {!words.busy && (
          <SpendButton
            label={video ? 'Make clip again' : 'Make clip'}
            icon={<Clapperboard size={16} aria-hidden />}
            variant="secondary"
            size="sm"
            asks={[shotAsk(shot)]}
            loading={make.isPending}
            error={errorText(make.error)}
            holdWhy={frozen ? 'The storyboard is still being written.' : lengthWhy}
            onPress={() => make.mutate({ projectId: project.id, shotIds: [shot.id] })}
          />
        )}
      </div>

      <AlertDialog
        isOpen={asking}
        onOpenChange={(open: boolean) => !open && setAsking(false)}
        title={`Remove shot ${shot.number}?`}
        description={video?.state === 'succeeded' ? 'Its clip leaves the storyboard too, and the film can no longer use it.' : 'The other shots close up behind it.'}
        actionLabel={`Remove shot ${shot.number}`}
        isActionLoading={remove.isPending}
        onAction={() => {
          if (!remove.isPending) remove.mutate(ids, { onSuccess: () => setAsking(false) });
        }}
      />
    </section>
  );
}
