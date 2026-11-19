import { Film, Music } from 'lucide-react';
import { useState } from 'react';

import { mediaUrl, outputUrl, type Project, type Transition, TRANSITIONS } from '../../shared/project.ts';
import { Section } from '../layouts/Section.tsx';
import { FREE_ON_MAC, MUSIC_SENTENCE } from '../lib/words.ts';
import { errorText, FreeButton } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import { FullSize } from '../ui/FullSize.tsx';
import { RenderingStatus } from '../ui/RenderingStatus.tsx';
import { Select } from '../ui/Select.tsx';
import { DownloadLink } from './DownloadLink.tsx';
import styles from '../Stages.module.css';

const TRANSITION_LABELS: Record<Transition, string> = { cut: 'Cut', fade: 'Fade (half a second)' };

export function FilmStage({ project }: { project: Project }) {
  const apply = useApply();
  const film = project.film;
  const [transition, setTransition] = useState<Transition>(film?.transition ?? 'cut');
  const assemble = trpc.film.assemble.useMutation({ onSuccess: apply });
  const clips = (project.storyboard?.shots ?? []).filter(
    (s) => s.video?.decision === 'approved' && s.video.state === 'succeeded' && s.video.storedKey
  );
  const making = film?.state === 'running';
  const finished = film?.state === 'succeeded' && film.finalStoredKey ? film.finalStoredKey : null;
  const seconds = film?.stitch.durationSeconds;

  return (
    <>
      <Section title="Film" description="The approved clips, joined in storyboard order.">
        {clips.length === 0 ? (
          <p className={styles.meta}>Approve at least one clip in Storyboard first.</p>
        ) : (
          <ol className={styles.clipList} aria-label="Approved clips in order">
            {clips.map((s) => (
              <li key={s.id} className={styles.clipItem}>
                <video
                  className={styles.clipSmall}
                  src={outputUrl(s.video!)}
                  preload="metadata"
                  muted
                  playsInline
                  aria-label={`Shot ${s.number} clip`}
                />
                <span className={styles.code}>Shot {s.number}</span>
                <span className={styles.meta}>
                  {s.shotType} · {s.video!.durationSeconds ?? s.durationSeconds}s
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.toolbar}>
          <div className={styles.modelPicker}>
            <Select
              label="Transition"
              value={transition}
              showHint={false}
              options={TRANSITIONS.map((t) => ({ id: t, name: TRANSITION_LABELS[t] }))}
              onChange={(v) => setTransition(v as Transition)}
            />
          </div>
          <FreeButton
            label={film ? 'Assemble film again' : 'Assemble film'}
            note={FREE_ON_MAC}
            variant="primary"
            icon={<Film size={16} aria-hidden />}
            loading={assemble.isPending || making}
            disabled={clips.length === 0}
            error={errorText(assemble.error)}
            onPress={() => assemble.mutate({ projectId: project.id, transition })}
          />
        </div>
        <p className={styles.music}>
          <Music size={14} aria-hidden />
          {MUSIC_SENTENCE}
        </p>
      </Section>

      {(film || making) && (
        <Section title={project.storyboard?.title || 'The film'}>
          {making ? (
            <div className={styles.renderFrame} style={{ aspectRatio: '16 / 9' }}>
              <RenderingStatus label="Joining the clips on this Mac…" runKey={film?.createdAt} since={film ? Date.parse(film.createdAt) : undefined} />
            </div>
          ) : finished ? (
            <>
              <video className={styles.player} src={mediaUrl(finished)} controls playsInline preload="metadata" aria-label="The film" />
              <div className={styles.actions}>
                {seconds !== undefined && <span className={styles.meta}>{Math.round(seconds)} seconds, silent</span>}
                <FullSize src={mediaUrl(finished)} kind="clip" title="The film" alt="The film" />
                <DownloadLink href={`${mediaUrl(finished)}?download`} name="the film" />
              </div>
            </>
          ) : film?.state === 'failed' ? (
            <p className={styles.error} role="alert">
              {film.error || 'The film was not made. Try again.'}
            </p>
          ) : null}
        </Section>
      )}
    </>
  );
}
