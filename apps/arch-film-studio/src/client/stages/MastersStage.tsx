import { Lock, Maximize } from 'lucide-react';

import { approvedEnhancement, outputUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import { masterNote } from '../../server/models.ts';
import { Section } from '../layouts/Section.tsx';
import { bulkLabel, masterCost } from '../lib/spend.ts';
import { altOf, jobWords, sizeWords } from '../lib/stages.ts';
import { NO_COST_AT_SIZE, UPSCALE_CAPPED } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import { FullSize } from '../ui/FullSize.tsx';
import { DownloadLink } from './DownloadLink.tsx';
import styles from '../Stages.module.css';

const BATCH = 20;

/** A master can be asked for when there is none yet, or the last one failed. */
function wantsMaster(image: ProjectImage): boolean {
  return !!approvedEnhancement(image) && (!image.master || image.master.state === 'failed');
}

export function MastersStage({ project }: { project: Project }) {
  const apply = useApply();
  const all = trpc.image.master.useMutation({ onSuccess: apply });
  const images = project.images.filter((i) => approvedEnhancement(i));
  const batch = images.filter(wantsMaster).slice(0, BATCH);
  const paid = batch.flatMap((i) => {
    const c = masterCost(i);
    return c && !c.free ? [c.ask] : [];
  });
  const press = () => all.mutate({ projectId: project.id, imageIds: batch.map((i) => i.id) });

  return (
    <Section
      title="4K masters"
      description="Each approved version becomes a locked master at its final size. A locked master is never made again."
    >
      {batch.length > 0 && (
        <div className={styles.toolbar}>
          {paid.length > 0 ? (
            <SpendButton
              label={bulkLabel('Make all masters', batch.length)}
              icon={<Maximize size={16} aria-hidden />}
              asks={paid}
              loading={all.isPending}
              error={errorText(all.error)}
              onPress={press}
            />
          ) : (
            <FreeButton
              label={bulkLabel('Make all masters', batch.length)}
              note={NO_COST_AT_SIZE}
              variant="primary"
              loading={all.isPending}
              error={errorText(all.error)}
              onPress={press}
            />
          )}
        </div>
      )}
      <ul className={styles.cards}>
        {images.map((image) => (
          <MasterCard key={image.id} project={project} image={image} />
        ))}
      </ul>
    </Section>
  );
}

function MasterCard({ project, image }: { project: Project; image: ProjectImage }) {
  const apply = useApply();
  const make = trpc.image.master.useMutation({ onSuccess: apply });
  const run = approvedEnhancement(image)!;
  const master = image.master;
  const cost = masterCost(image);
  const words = jobWords(master, 'Locked');
  const file = master ? outputUrl(master) : undefined;
  const note = masterNote(master) ?? (cost?.free && cost.capped && !master?.locked ? UPSCALE_CAPPED : undefined);
  const press = () => make.mutate({ projectId: project.id, imageIds: [image.id] });
  const target = master?.targetLongEdge ?? cost?.target;

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        {file && master?.locked ? (
          <img className={styles.cardThumb} src={file} alt={altOf(image, 'master')} loading="lazy" />
        ) : (
          run.storedKey && <img className={styles.cardThumb} src={outputUrl(run)} alt={altOf(image, `approved version ${run.version}`)} loading="lazy" />
        )}
        <div className={styles.cardTitle}>
          <span className={styles.code}>
            {image.code}
            {master?.locked && <Lock size={14} aria-label="locked master" className={styles.lock} />}
          </span>
          <span className={styles.name}>{image.name}</span>
          <span className={styles.meta}>
            From v{run.version}
            {run.outputSize ? ` (${sizeWords(run.outputSize)})` : ''} · target long edge {target ?? '…'} px
          </span>
          {master && (
            <span className={styles.status} data-busy={words.busy || undefined}>
              {master.locked
                ? `Locked master${master.outputSize ? `, ${sizeWords(master.outputSize)}` : ''}${master.reusedEnhancement ? ', the approved version as it was' : ''}`
                : words.words}
            </span>
          )}
          {words.error && (
            <span className={styles.error} role="alert">
              {words.error}
            </span>
          )}
          {note && <span className={styles.why}>{note}</span>}
        </div>
        <div className={styles.actions}>
          {master?.locked && file ? (
            <>
              <FullSize src={file} kind="still" title={`${image.code} master`} alt={altOf(image, 'master')} />
              <DownloadLink href={outputUrl(master, true)!} name={`${image.code} master`} />
            </>
          ) : words.busy ? null : cost?.free ? (
            <FreeButton label="Make master" note={NO_COST_AT_SIZE} variant="primary" loading={make.isPending} error={errorText(make.error)} onPress={press} />
          ) : cost ? (
            <SpendButton
              label="Make master"
              icon={<Maximize size={16} aria-hidden />}
              asks={[cost.ask]}
              loading={make.isPending}
              error={errorText(make.error)}
              onPress={press}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}
