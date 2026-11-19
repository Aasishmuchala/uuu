import { ArrowRight, Pencil } from 'lucide-react';
import { useState } from 'react';

import {
  approvedEnhancement,
  mediaUrl,
  outputUrl,
  type Project,
  type ProjectImage,
} from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL } from '../../server/models.ts';
import { Banner, Button, Heading, Text } from '../kit.ts';
import { attentionScreen, nextStep, notEnhanced, pictureState, stageProgress, wantsClip, wantsMaster } from '../lib/progress.ts';
import { routeHash, SCREEN_LABELS } from '../lib/route.ts';
import { capForSpend } from '../lib/selection.ts';
import { enhanceAsk, masterCost, type QuoteAsk, shotAsk } from '../lib/spend.ts';
import { altOf, waitingCount } from '../lib/stages.ts';
import { errorText, PriceReading } from '../money.tsx';
import { ContactSheet, type SheetItem } from '../parts/ContactSheet.tsx';
import { CostMeter } from '../parts/CostMeter.tsx';
import { NameDialog } from '../parts/NameDialog.tsx';
import { go } from '../parts/navigate.ts';
import { StageRail } from '../parts/StageRail.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Overview.module.css';

/** The project's best picture: the newest master, else the newest approved still, else the first render. */
function heroOf(p: Project): { src: string; alt: string; width: number; height: number } | null {
  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const masters = p.images
    .filter((i) => i.master?.locked && i.master.storedKey)
    .map((i) => ({ i, m: i.master!, createdAt: i.master!.createdAt }))
    .sort(byNewest);
  const m = masters[0];
  if (m) {
    const size = m.m.outputSize ?? { width: m.i.width, height: m.i.height };
    return { src: mediaUrl(m.m.storedKey!), alt: altOf(m.i, 'master'), ...size };
  }
  const approved = p.images
    .map((i) => ({ i, r: approvedEnhancement(i) }))
    .filter((x) => x.r?.storedKey)
    .map((x) => ({ ...x, createdAt: x.r!.createdAt }))
    .sort(byNewest);
  const a = approved[0];
  if (a) {
    const size = a.r!.outputSize ?? { width: a.i.width, height: a.i.height };
    return { src: outputUrl(a.r!)!, alt: altOf(a.i, `approved version ${a.r!.version}`), ...size };
  }
  const first = p.images[0];
  return first ? { src: mediaUrl(first.workKey), alt: altOf(first, 'the render'), width: first.width, height: first.height } : null;
}

/** The newest picture of an image for the contact sheet: its master, its newest finished version, else its render. */
export function newestOf(image: ProjectImage): { src: string; width: number; height: number; what: string } {
  if (image.master?.locked && image.master.storedKey) {
    const size = image.master.outputSize ?? image;
    return { src: mediaUrl(image.master.storedKey), width: size.width, height: size.height, what: 'master' };
  }
  const made = [...image.enhancements].reverse().find((r) => r.state === 'succeeded' && r.storedKey);
  if (made) {
    const size = made.outputSize ?? image;
    return { src: outputUrl(made)!, width: size.width, height: size.height, what: `version ${made.version}` };
  }
  return { src: mediaUrl(image.thumbKey), width: image.width, height: image.height, what: 'the render' };
}

/** Every job of the project being made right now (sent, not waiting). */
function runningCount(p: Project): number {
  const running = (j: { state: string } | undefined) => j?.state === 'running';
  return (
    p.images.reduce((n, i) => n + i.enhancements.filter(running).length + (running(i.master) ? 1 : 0) + (running(i.analysis) ? 1 : 0), 0) +
    (p.storyboard?.shots ?? []).filter((s) => running(s.video)).length +
    (running(p.storyboard) ? 1 : 0) +
    (p.film?.state === 'running' ? 1 : 0)
  );
}

/** What the next step's button would buy, at most one press of it, for its price reading. */
function nextAsks(p: Project, screenName: string): { asks: QuoteAsk[]; count: number } {
  if (screenName === 'enhance') {
    const fresh = p.images.filter((i) => notEnhanced(i) && !i.master?.locked);
    const sent = capForSpend(fresh.map((i) => i.id));
    return { asks: fresh.filter((i) => sent.includes(i.id)).map((i) => enhanceAsk(i, DEFAULT_ENHANCE_MODEL)), count: fresh.length };
  }
  if (screenName === 'masters') {
    const want = p.images.filter(wantsMaster).slice(0, 20);
    return {
      asks: want.flatMap((i) => {
        const c = masterCost(i);
        return c && !c.free ? [c.ask] : [];
      }),
      count: p.images.filter(wantsMaster).length,
    };
  }
  const shots = (p.storyboard?.shots ?? []).filter((s) => wantsClip(s) && s.video?.state !== 'queued' && s.video?.state !== 'running');
  return { asks: shots.slice(0, 20).map(shotAsk), count: shots.length };
}

/** The project at a glance: its best picture, the six stages, the one next thing, its cost, every picture. */
export function Overview({ project }: { project: Project }) {
  const hero = heroOf(project);
  const stages = stageProgress(project);
  const next = nextStep(project);
  const [renaming, setRenaming] = useState(false);
  const apply = useApply();
  const rename = trpc.project.rename.useMutation({
    onSuccess: (p) => {
      apply(p);
      setRenaming(false);
    },
  });
  const hrefOf = (s: (typeof stages)[number]['screen']) => routeHash({ kind: 'project', id: project.id, screen: s });
  const items: SheetItem[] = project.images.map((image) => {
    const pic = newestOf(image);
    return {
      id: image.id,
      src: pic.src,
      alt: altOf(image, pic.what),
      width: pic.width,
      height: pic.height,
      code: image.code,
      name: image.name,
      state: pictureState(image),
    };
  });
  const priced = next.kind === 'spend' ? nextAsks(project, next.screen) : null;
  const making = runningCount(project);
  const renameButton = <Button label="Rename" variant="secondary" size="sm" icon={<Pencil size={14} aria-hidden />} onClick={() => setRenaming(true)} />;

  return (
    <div className={`${screen.screen} ${screen.narrow}`}>
      <section className={styles.hero} aria-label={project.name}>
        {hero ? (
          <div className={styles.heroFrame} style={{ ['--ar' as string]: String(hero.width / hero.height) }}>
            <img src={hero.src} alt={hero.alt} draggable={false} />
            <div className={styles.heroCaption}>
              <Heading level={1} color="inherit">
                {project.name}
              </Heading>
              {renameButton}
            </div>
          </div>
        ) : (
          <div className={styles.heroEmpty}>
            <Heading level={1}>{project.name}</Heading>
            {renameButton}
          </div>
        )}
      </section>

      <div className={styles.rail}>
        <StageRail stages={stages} hrefOf={hrefOf} />
      </div>

      {making > 0 && waitingCount(project) === 0 && (
        <div className={styles.running}>
          <Banner status="info" title={`${making} ${making === 1 ? 'thing is' : 'things are'} being made. This page updates by itself.`} />
        </div>
      )}

      <div className={styles.columns}>
        <section className={styles.next} aria-label="Next">
          <Heading level={4} accessibilityLevel={2}>
            Next
          </Heading>
          <Text type="large" as="p">
            {next.sentence}
          </Text>
          <div className={styles.nextRow}>
            {priced && priced.asks.length > 0 && (
              <span className={styles.nextPrice}>
                <PriceReading asks={priced.asks} />
                <span>
                  {' '}
                  for {priced.count > 20 ? 'the first 20' : priced.count === 1 ? 'it' : `these ${priced.count}`}
                </span>
              </span>
            )}
            {next.kind === 'spend' && priced && priced.asks.length === 0 && <span className={styles.nextPrice}>No charge</span>}
            {next.kind === 'free' && next.screen === 'film' && <span className={styles.nextPrice}>No charge</span>}
            <Button
              label={`Open ${SCREEN_LABELS[next.screen]}`}
              variant="primary"
              icon={<ArrowRight size={16} aria-hidden />}
              href={hrefOf(next.screen)}
            />
          </div>
          {next.kind === 'spend' && (
            <Text type="supporting" color="secondary" as="p">
              Nothing is spent here. You see the price again beside the button on {SCREEN_LABELS[next.screen]}.
            </Text>
          )}
        </section>
        <div className={styles.cost}>
          <CostMeter project={project} />
        </div>
      </div>

      {items.length > 0 && (
        <section className={screen.section} aria-label="Every picture">
          <div className={screen.sectionHead}>
            <Heading level={4} accessibilityLevel={2}>
              Every picture
            </Heading>
            <Text type="supporting" color="secondary">
              {items.length} {items.length === 1 ? 'picture' : 'pictures'}. Click one to open it where it needs you.
            </Text>
          </div>
          <ContactSheet
            items={items}
            label="Every picture"
            size="sm"
            clickMode="open"
            onOpen={(id) => {
              const image = project.images.find((i) => i.id === id);
              if (image) go({ kind: 'project', id: project.id, screen: attentionScreen(image), focus: id });
            }}
          />
        </section>
      )}

      <NameDialog
        key={renaming ? 'open' : 'closed'}
        isOpen={renaming}
        title="Rename the project"
        confirm="Rename"
        initial={project.name}
        loading={rename.isPending}
        error={errorText(rename.error)}
        onCancel={() => {
          rename.reset();
          setRenaming(false);
        }}
        onConfirm={(name) => rename.mutate({ id: project.id, name })}
      />
    </div>
  );
}
