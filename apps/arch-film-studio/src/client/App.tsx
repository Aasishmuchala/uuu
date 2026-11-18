import { CircleX, Clapperboard, Film, ImageUp, Lock, Sparkles, Stamp } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Project } from '../shared/project.ts';
import { AppShell } from './layouts/AppShell.tsx';
import { pollEvery, stageCount, stageLock, STAGES, type StageKey, waitingCount, waitingWords } from './lib/stages.ts';
import { useDocumentTitle } from './lib/useDocumentTitle.ts';
import { AllowanceChip, errorText, MoneyProvider } from './money.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { EnhanceStage } from './stages/EnhanceStage.tsx';
import { FilmStage } from './stages/FilmStage.tsx';
import { MastersStage } from './stages/MastersStage.tsx';
import { ReviewStage } from './stages/ReviewStage.tsx';
import { StoryboardStage } from './stages/StoryboardStage.tsx';
import { UploadStage } from './stages/UploadStage.tsx';
import { trpc } from './trpc.ts';
import { useApply } from './useApply.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { SkeletonText } from './ui/Skeleton.tsx';
import styles from './App.module.css';

const ICONS = {
  upload: ImageUp,
  enhance: Sparkles,
  review: Stamp,
  masters: Lock,
  storyboard: Clapperboard,
  film: Film,
} as const;

const PROJECT_KEY = 'arch-film-studio.project';

function remembered(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    // A framed page may have no storage: the choice lasts until reload.
  }
}

export function App() {
  return (
    <MoneyProvider>
      <AppShell title="Arch Film Studio" maxWidth={1200} actions={<AllowanceChip />}>
        <Studio />
      </AppShell>
    </MoneyProvider>
  );
}

function Studio() {
  const list = trpc.project.list.useQuery();
  const [projectId, setProjectId] = useState<string | null>(remembered);
  const [stage, setStage] = useState<StageKey>('upload');

  // A remembered project that is gone falls back to the newest one.
  useEffect(() => {
    if (!list.data) return;
    if (projectId && list.data.some((p) => p.id === projectId)) return;
    const first = list.data[0]?.id ?? null;
    setProjectId(first);
    remember(first);
  }, [list.data, projectId]);

  const project = trpc.project.get.useQuery(
    { id: projectId ?? '' },
    {
      enabled: !!projectId && !!list.data?.some((p) => p.id === projectId),
      refetchInterval: (q) => pollEvery(q.state.data),
      refetchOnWindowFocus: true,
    }
  );
  const p = project.data;
  useDocumentTitle(p?.name, 'Arch Film Studio');

  const choose = (id: string) => {
    setProjectId(id);
    remember(id);
    setStage('upload');
  };

  return (
    <>
      <PageHeader
        title={p?.name ?? 'Arch Film Studio'}
        description="Turn architectural renders into photographic stills, then a cinematic film."
        actions={<ProjectPicker projects={list.data} currentId={projectId} onChoose={choose} />}
      />

      {list.isError && <Alert tone="error" title="The projects could not be read.">{list.error.message}</Alert>}

      {list.data && list.data.length === 0 && (
        <EmptyState
          title="No projects yet"
          hint="Make a project, then upload the whole set of renders at once."
        />
      )}

      {projectId && list.data && list.data.length > 0 && (
        <>
          <nav aria-label="Production stages">
            <ol className={styles.pipeline}>
              {STAGES.map((s, i) => {
                const Icon = ICONS[s.key];
                const locked = stageLock(p, s.key) !== null;
                const count = stageCount(p, s.key);
                return (
                  <li key={s.key} className={styles.stageItem}>
                    <button
                      type="button"
                      className={styles.stage}
                      data-active={stage === s.key || undefined}
                      data-locked={locked || undefined}
                      aria-current={stage === s.key ? 'step' : undefined}
                      onClick={() => setStage(s.key)}
                    >
                      <span className={styles.stageIndex}>{String(i + 1).padStart(2, '0')}</span>
                      {locked ? <Lock size={14} aria-label="locked" /> : <Icon size={16} aria-hidden />}
                      <span className={styles.stageLabel}>{s.label}</span>
                      {count !== null && <span className={styles.stageCount}>{count}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {project.isError && <Alert tone="error" title="This project could not be read.">{project.error.message}</Alert>}
          {!p && project.isLoading && <SkeletonText rows={4} />}
          {p && <Waiting project={p} />}
          {p && <StagePage stage={stage} project={p} onGo={setStage} />}
        </>
      )}
    </>
  );
}

/** The jobs still waiting to be sent, with the one way to stop them before they go. */
function Waiting({ project }: { project: Project }) {
  const apply = useApply();
  const cancel = trpc.project.cancelWaiting.useMutation({ onSuccess: apply });
  const n = waitingCount(project);
  if (n === 0) return null;
  return (
    <div className={styles.waiting} role="status">
      <span>{waitingWords(n)}</span>
      <Button
        size="sm"
        icon={<CircleX size={14} aria-hidden />}
        loading={cancel.isPending}
        onPress={() => cancel.mutate({ id: project.id })}
      >
        Cancel waiting
      </Button>
      {cancel.error && (
        <span className={styles.waitingError} role="alert">
          {errorText(cancel.error)}
        </span>
      )}
    </div>
  );
}

function StagePage({
  stage,
  project,
  onGo,
}: {
  stage: StageKey;
  project: Project;
  onGo: (s: StageKey) => void;
}) {
  const lock = stageLock(project, stage);
  if (lock) {
    return (
      <div className={styles.locked}>
        <Lock size={16} aria-hidden />
        <span>{lock}</span>
      </div>
    );
  }
  switch (stage) {
    case 'upload':
      return <UploadStage project={project} onNext={() => onGo('enhance')} />;
    case 'enhance':
      return <EnhanceStage project={project} />;
    case 'review':
      return <ReviewStage project={project} />;
    case 'masters':
      return <MastersStage project={project} />;
    case 'storyboard':
      return <StoryboardStage project={project} />;
    case 'film':
      return <FilmStage project={project} />;
  }
}
