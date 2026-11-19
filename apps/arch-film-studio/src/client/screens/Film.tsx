import { Film } from 'lucide-react';
import { useState } from 'react';

import { downloadUrl, type FilmFormat, filmFileName, mediaUrl, outputUrl, type Project, type Transition, TRANSITIONS } from '../../shared/project.ts';
import { Banner, Heading, SegmentedControl, SegmentedControlItem, StatusDot, Text } from '../kit.ts';
import { clock } from '../lib/timeline.ts';
import { MUSIC_SENTENCE, NO_CHARGE_ON_MAC } from '../lib/words.ts';
import { errorText, FreeButton } from '../money.tsx';
import { DownloadLink } from '../parts/DownloadLink.tsx';
import { FilmPlayer, type PlayerClip } from '../parts/FilmPlayer.tsx';
import { FullSize } from '../parts/FullSize.tsx';
import { Picture } from '../parts/Picture.tsx';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Film.module.css';

const TRANSITION_LABELS: Record<Transition, string> = { cut: 'Cut', fade: 'Fade, half a second' };
const FORMAT_RATIO: Record<FilmFormat, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

/** The approved clips, in storyboard order: previewed as one, then assembled on this Mac. */
export function FilmScreen({ project }: { project: Project }) {
  const apply = useApply();
  const film = project.film;
  const [transition, setTransition] = useState<Transition>(film?.transition ?? 'cut');
  const assemble = trpc.film.assemble.useMutation({ onSuccess: apply });
  const shots = project.storyboard?.shots ?? [];
  const approved = shots.filter((s) => s.video?.decision === 'approved' && s.video.state === 'succeeded' && s.video.storedKey);
  const making = film?.state === 'running';
  const finished = film?.state === 'succeeded' && film.finalStoredKey ? film.finalStoredKey : null;
  const ratio = FORMAT_RATIO[project.storyboard?.format ?? '16:9'];
  const preview: PlayerClip[] = approved.map((s) => ({ src: outputUrl(s.video!)!, seconds: s.video!.durationSeconds ?? s.durationSeconds, label: `Shot ${s.number}` }));
  const total = preview.reduce((a, c) => a + c.seconds, 0);
  const title = project.storyboard?.title || 'The film';
  const [showing, setShowing] = useState<'film' | 'preview'>('film');
  const onFilm = finished && showing === 'film';

  return (
    <div className={`${screen.screen} ${screen.wide}`}>
      <ScreenHeader title="Film" sentence="The approved clips, joined in storyboard order on this Mac." />

      <div className={styles.layout}>
        <div className={styles.viewer}>
          {making ? (
            <Picture alt="" width={ratio * 9} height={9} working={{ words: 'Joining the clips on this Mac…', since: film ? Date.parse(film.createdAt) : undefined }} />
          ) : onFilm ? (
            <FilmPlayer clips={[{ src: mediaUrl(finished), seconds: film?.stitch.durationSeconds ?? total, label: title }]} ratio={ratio} label={title} />
          ) : preview.length > 0 ? (
            <FilmPlayer clips={preview} ratio={ratio} label="Preview of the approved clips" />
          ) : (
            <div className={styles.none} style={{ ['--ar' as string]: String(ratio) }}>
              <Text type="body" color="secondary">
                Approve at least one clip in Storyboard first.
              </Text>
            </div>
          )}
          <div className={styles.under}>
            {finished && !making && (
              <SegmentedControl label="Play" value={showing} onChange={(v: string) => setShowing(v as 'film' | 'preview')} size="sm">
                <SegmentedControlItem value="film" label="Finished film" />
                <SegmentedControlItem value="preview" label="Approved clips" />
              </SegmentedControl>
            )}
            {!finished && preview.length > 0 && !making && (
              <Text type="supporting" color="secondary">
                A preview straight from the clips. Nothing is made until you assemble.
              </Text>
            )}
            {onFilm && (
              <div className={styles.filmTools}>
                <Text type="supporting" color="secondary">
                  <span className="num">{clock(film?.stitch.durationSeconds ?? total)}</span>, silent
                </Text>
                <FullSize compact media={{ src: mediaUrl(finished), kind: 'clip', alt: title, caption: title }} />
                <DownloadLink href={downloadUrl(mediaUrl(finished), filmFileName(project.name, project.storyboard?.title))} name="the film" />
              </div>
            )}
          </div>
          {film?.state === 'failed' && !making && <Banner status="error" title={film.error || 'The film was not made.'} description="Check the clips, then assemble again." />}
        </div>

        <aside className={styles.side} aria-label="Shots in the film">
          <div className={styles.sideHead}>
            <Heading level={2}>{title}</Heading>
            <Text type="supporting" color="secondary">
              <span className="num">
                {approved.length} of {shots.length} shots approved, {clock(total)}
              </span>
            </Text>
          </div>
          <ol className={styles.shots}>
            {shots.map((s) => {
              const ok = approved.includes(s);
              return (
                <li key={s.id} className={styles.shot} data-out={!ok || undefined}>
                  <StatusDot variant={ok ? 'success' : 'neutral'} label={ok ? 'In the film' : 'Not approved, left out'} tooltip={ok ? 'In the film' : 'Not approved, left out'} />
                  <span className={styles.shotName}>
                    Shot {s.number}
                    <span className={styles.shotType}>{s.shotType}</span>
                  </span>
                  <span className={`${styles.shotTime} num`}>{ok ? `${s.video!.durationSeconds ?? s.durationSeconds} s` : 'Left out'}</span>
                </li>
              );
            })}
          </ol>
          <div className={styles.transition}>
            <Text type="label">Between shots</Text>
            <SegmentedControl label="Between shots" value={transition} onChange={(v: string) => setTransition(v as Transition)} size="sm" layout="fill">
              {TRANSITIONS.map((t) => (
                <SegmentedControlItem key={t} value={t} label={TRANSITION_LABELS[t]} />
              ))}
            </SegmentedControl>
          </div>
          <FreeButton
            label={film ? 'Assemble film again' : 'Assemble film'}
            note={NO_CHARGE_ON_MAC}
            variant="primary"
            icon={<Film size={16} aria-hidden />}
            loading={assemble.isPending || making}
            disabled={approved.length === 0}
            why={approved.length === 0 ? 'Approve at least one clip in Storyboard first.' : null}
            error={errorText(assemble.error)}
            onPress={() => assemble.mutate({ projectId: project.id, transition })}
          />
          <Text type="supporting" color="secondary" as="p">
            {MUSIC_SENTENCE}
          </Text>
        </aside>
      </div>
    </div>
  );
}
