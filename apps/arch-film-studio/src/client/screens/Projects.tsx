import { FolderPlus } from 'lucide-react';
import { useState } from 'react';

import { mediaUrl, type ProjectSummary } from '../../shared/project.ts';
import { Badge, Button, EmptyState, Heading, Skeleton } from '../kit.ts';
import { routeHash } from '../lib/route.ts';
import { sentWords } from '../lib/words.ts';
import { errorText } from '../money.tsx';
import { NameDialog } from '../parts/NameDialog.tsx';
import { go } from '../parts/navigate.ts';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';
import styles from './Projects.module.css';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** All projects as large cards, and "New project". */
export function Projects({ projects, loading }: { projects: ProjectSummary[] | undefined; loading: boolean }) {
  const utils = trpc.useUtils();
  const apply = useApply();
  const [asking, setAsking] = useState(false);
  const create = trpc.project.create.useMutation({
    onSuccess: (p) => {
      // The list holds the new project before it opens, so the page does not fall back.
      utils.project.list.setData(undefined, (old) => [
        { id: p.id, name: p.name, updatedAt: p.updatedAt, imageCount: 0, masterCount: 0, thumbKeys: [], spentCents: 0, filmReady: false },
        ...(old ?? []).filter((x) => x.id !== p.id),
      ]);
      apply(p);
      setAsking(false);
      go({ kind: 'project', id: p.id, screen: 'renders' });
    },
  });
  const newButton = <Button label="New project" variant="primary" icon={<FolderPlus size={16} aria-hidden />} onClick={() => setAsking(true)} />;

  return (
    <div className={`${screen.screen} ${screen.wide}`}>
      <ScreenHeader title="Projects" sentence="Each project is one building: its renders, the stills you approve, and the film made from them.">
        {projects && projects.length > 0 && newButton}
      </ScreenHeader>

      {loading && !projects ? (
        <ul className={styles.grid} aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.card}>
              <div className={styles.mosaic}>
                <Skeleton index={i} radius={2} />
              </div>
              <div className={styles.body}>
                <Skeleton index={i} height={18} width="50%" />
                <Skeleton index={i} height={12} width="70%" />
              </div>
            </li>
          ))}
        </ul>
      ) : projects && projects.length === 0 ? (
        <div className={screen.empty}>
          <EmptyState
            icon={<FolderPlus size={24} aria-hidden />}
            title="No projects yet"
            description="Make a project for a building, then add its whole set of renders at once."
            actions={newButton}
          />
        </div>
      ) : (
        <ul className={styles.grid}>
          {(projects ?? []).map((p) => (
            <li key={p.id}>
              <a className={styles.card} href={routeHash({ kind: 'project', id: p.id, screen: 'overview' })}>
                <div className={styles.mosaic} data-count={Math.min(4, p.thumbKeys.length)}>
                  {p.thumbKeys.slice(0, 4).map((k, i) => (
                    <img key={k} src={mediaUrl(k)} alt={i === 0 ? `${p.name}, first render` : ''} loading="lazy" draggable={false} />
                  ))}
                  {p.thumbKeys.length === 0 && <span className={styles.noPictures}>No renders yet</span>}
                </div>
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    <Heading level={2} maxLines={1}>
                      {p.name}
                    </Heading>
                    {p.filmReady && <Badge variant="success" label="Film ready" />}
                  </div>
                  <div className={styles.facts}>
                    <span className="num">
                      {count(p.imageCount, 'render', 'renders')}, {count(p.masterCount, 'master', 'masters')}
                    </span>
                    <span className="num">{sentWords(p.spentCents)} sent to be made</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <NameDialog
        key={asking ? 'open' : 'closed'}
        isOpen={asking}
        title="New project"
        confirm="Make project"
        initial=""
        loading={create.isPending}
        error={errorText(create.error)}
        onCancel={() => {
          create.reset();
          setAsking(false);
        }}
        onConfirm={(name) => create.mutate({ name })}
      />
    </div>
  );
}
