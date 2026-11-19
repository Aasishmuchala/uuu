import { ScanSearch, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { latestEnhancement, mediaUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL, ENHANCE_MODELS, type EnhanceModel, enhanceSize } from '../../server/models.ts';
import { Section } from '../layouts/Section.tsx';
import { bulkLabel, enhanceAsk } from '../lib/spend.ts';
import { altOf, jobWords, sizeWords } from '../lib/stages.ts';
import { FREE_THINKING, LOCKED_MASTER } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton, useMoney } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import { Select } from '../ui/Select.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import styles from '../Stages.module.css';

/** The most images one press sends (the procedure's own bound). */
const BATCH = 20;

const busy = (s: string | undefined) => s === 'queued' || s === 'running';

/** An image takes a new enhancement unless its master is locked or a version is being made. */
export function canEnhance(image: ProjectImage): boolean {
  return !image.master?.locked && !busy(latestEnhancement(image)?.state);
}

export function EnhanceStage({ project }: { project: Project }) {
  const apply = useApply();
  const { models } = useMoney();
  const [model, setModel] = useState<EnhanceModel>(DEFAULT_ENHANCE_MODEL);
  const ready = project.images.filter(canEnhance);
  const batch = ready.slice(0, BATCH);
  const all = trpc.image.enhance.useMutation({ onSuccess: apply });

  return (
    <>
      <Section
        title="Enhance"
        description="Each render becomes a photograph of itself. Strict image-only changes nothing but photographic quality."
      >
        <div className={styles.toolbar}>
          <div className={styles.modelPicker}>
            <Select
              label="Model"
              value={model}
              onChange={(v) => setModel(v as EnhanceModel)}
              options={ENHANCE_MODELS.map((id) => {
                const row = models?.find((m) => m.id === id);
                return { id, name: row?.words ?? id, hint: row && !row.ready ? (row.why ?? undefined) : undefined };
              })}
            />
          </div>
          <SpendButton
            label={bulkLabel('Enhance all', batch.length)}
            icon={<Sparkles size={16} aria-hidden />}
            asks={batch.map((i) => enhanceAsk(i, model))}
            loading={all.isPending}
            error={errorText(all.error)}
            onPress={() => all.mutate({ projectId: project.id, imageIds: batch.map((i) => i.id), model })}
          />
        </div>
        {ready.length > BATCH && (
          <p className={styles.meta}>Enhance all takes {BATCH} images at a time; press it again for the rest.</p>
        )}
      </Section>

      <ul className={styles.cards}>
        {project.images.map((image) => (
          <EnhanceCard key={image.id} project={project} image={image} model={model} />
        ))}
      </ul>
    </>
  );
}

function EnhanceCard({ project, image, model }: { project: Project; image: ProjectImage; model: EnhanceModel }) {
  const apply = useApply();
  const save = trpc.image.setSettings.useMutation({ onSuccess: apply });
  const analyse = trpc.image.analyse.useMutation({ onSuccess: apply });
  const enhance = trpc.image.enhance.useMutation({ onSuccess: apply });
  const locked = !!image.master?.locked;
  const last = latestEnhancement(image);
  const lastWords = jobWords(last, 'Made: see Review');
  const analysis = image.analysis;
  const analysing = analysis?.state === 'running';

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <img className={styles.cardThumb} src={mediaUrl(image.thumbKey)} alt={altOf(image)} loading="lazy" />
        <div className={styles.cardTitle}>
          <span className={styles.code}>{image.code}</span>
          <span className={styles.name}>{image.name}</span>
          <span className={styles.meta}>
            {sizeWords(image)} · asks for {enhanceSize(image.settings, image)}
          </span>
          {last && (
            <span className={styles.status} data-busy={lastWords.busy || undefined}>
              v{last.version}: {lastWords.words}
            </span>
          )}
          {lastWords.error && (
            <span className={styles.error} role="alert">
              {lastWords.error}
            </span>
          )}
        </div>
      </div>

      <div className={styles.cardBody}>
        <SettingsPanel
          idPrefix={image.id}
          settings={image.settings}
          disabled={locked}
          saving={save.isPending}
          error={errorText(save.error)}
          onSave={(settings) => save.mutate({ projectId: project.id, imageId: image.id, settings })}
        />

        <div className={styles.side}>
          <div className={styles.analysis}>
            <h3 className={styles.subhead}>Analysis</h3>
            {analysis?.state === 'succeeded' && analysis.result ? (
              <>
                <p className={styles.para}>{analysis.result.summary}</p>
                <dl className={styles.facts}>
                  <dt>Space</dt>
                  <dd>{analysis.result.spaceType}</dd>
                  <dt>Camera</dt>
                  <dd>{analysis.result.camera}</dd>
                  <dt>Lighting</dt>
                  <dd>{analysis.result.lighting}</dd>
                  {analysis.result.materials.length > 0 && (
                    <>
                      <dt>Materials</dt>
                      <dd>{analysis.result.materials.join(', ')}</dd>
                    </>
                  )}
                </dl>
              </>
            ) : analysing ? (
              <p className={styles.status} data-busy>
                Looking at the render…
              </p>
            ) : (
              <p className={styles.meta}>Not analysed yet. An analysis helps the storyboard later.</p>
            )}
            {analysis?.state === 'failed' && (
              <p className={styles.error} role="alert">
                {analysis.error}
              </p>
            )}
            <FreeButton
              label={analysis?.state === 'succeeded' ? 'Analyse again' : 'Analyse'}
              note={FREE_THINKING}
              icon={<ScanSearch size={16} aria-hidden />}
              loading={analyse.isPending || analysing}
              error={errorText(analyse.error)}
              onPress={() => analyse.mutate({ projectId: project.id, imageIds: [image.id] })}
            />
          </div>

          <SpendButton
            label={image.enhancements.length > 0 ? 'Enhance again' : 'Enhance'}
            icon={<Sparkles size={16} aria-hidden />}
            asks={[enhanceAsk(image, model)]}
            loading={enhance.isPending}
            error={errorText(enhance.error)}
            holdWhy={locked ? LOCKED_MASTER : busy(last?.state) ? 'A version is being made.' : null}
            onPress={() => enhance.mutate({ projectId: project.id, imageIds: [image.id], model })}
          />
        </div>
      </div>
    </li>
  );
}
