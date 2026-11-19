import {
  Clapperboard,
  Film,
  Images,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  Search,
  Sparkles,
  Stamp,
  SquareStack,
} from 'lucide-react';
import { type ComponentType, useCallback, useEffect, useState } from 'react';

import type { Project } from '../shared/project.ts';
import {
  AppShell,
  Banner,
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  Kbd,
  SideNav,
  SideNavItem,
  SideNavSection,
  Skeleton,
} from './kit.ts';
import { progressWords, stageProgress, type WorkScreen } from './lib/progress.ts';
import { parseRoute, type Route, routeHash, type Screen, SCREEN_LABELS, SCREEN_STAGE, SCREENS } from './lib/route.ts';
import { isTyping } from './lib/reviewKeys.ts';
import { pollEvery, stageLock } from './lib/stages.ts';
import { useDocumentTitle } from './lib/useDocumentTitle.ts';
import { AllowanceChip, MoneyProvider } from './money.tsx';
import { CommandMenu } from './parts/CommandMenu.tsx';
import { CostMeter } from './parts/CostMeter.tsx';
import { ErrorBoundary } from './parts/ErrorBoundary.tsx';
import { Locked } from './parts/Locked.tsx';
import { go } from './parts/navigate.ts';
import { ShortcutsDialog } from './parts/ShortcutsDialog.tsx';
import { WaitingStrip } from './parts/WaitingStrip.tsx';
import { Enhance } from './screens/Enhance.tsx';
import { FilmScreen } from './screens/Film.tsx';
import { Masters } from './screens/Masters.tsx';
import { Overview } from './screens/Overview.tsx';
import { Projects } from './screens/Projects.tsx';
import { Renders } from './screens/Renders.tsx';
import { Review } from './screens/Review.tsx';
import { Storyboard } from './screens/Storyboard.tsx';
import { trpc } from './trpc.ts';
import styles from './App.module.css';

const ICONS: Record<Screen, ComponentType> = {
  overview: LayoutDashboard,
  renders: Images,
  enhance: Sparkles,
  review: Stamp,
  masters: SquareStack,
  storyboard: Clapperboard,
  film: Film,
};

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
      <Studio />
    </MoneyProvider>
  );
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function Studio() {
  const hash = useHash();
  const route = parseRoute(hash, remembered());
  const list = trpc.project.list.useQuery();
  const projectId = route.kind === 'project' ? route.id : null;
  const known = !!projectId && !!list.data?.some((p) => p.id === projectId);
  const project = trpc.project.get.useQuery(
    { id: projectId ?? '' },
    {
      enabled: known,
      refetchInterval: (q) => pollEvery(q.state.data),
      refetchOnWindowFocus: true,
    }
  );
  const p = known ? project.data : undefined;
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);

  // The address always says where the page is: a remembered project shows in it.
  const want = routeHash(route);
  useEffect(() => {
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  }, [want, hash]);

  // A project that is gone falls back to all projects.
  useEffect(() => {
    if (!projectId || !list.data) return;
    if (list.data.some((x) => x.id === projectId)) remember(projectId);
    else {
      remember(null);
      go({ kind: 'projects' });
    }
  }, [projectId, list.data]);

  useDocumentTitle(route.kind === 'project' && p ? `${SCREEN_LABELS[route.screen]}, ${p.name}` : 'Projects', 'Arch Film Studio');

  // Cmd+K and ?: never while a field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette(true);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openShortcuts = useCallback(() => setShortcuts(true), []);

  return (
    <AppShell
      height="fill"
      variant="elevated"
      contentPadding={0}
      sideNav={<Nav route={route} project={p} projects={list.data} />}
      topNav={
        <header className={styles.top}>
          <a className={styles.brand} href="#/">
            Arch Film Studio
          </a>
          <div className={styles.topStart}>
            <Trail route={route} project={p} />
          </div>
          <div className={styles.topEnd}>
              <Button
                label="Go to"
                variant="ghost"
                size="sm"
                icon={<Search size={15} aria-hidden />}
                endContent={<Kbd keys="mod+k" />}
                onClick={() => setPalette(true)}
              />
              <Button label="Shortcuts" variant="ghost" size="sm" icon={<Keyboard size={15} aria-hidden />} endContent={<Kbd keys="?" />} onClick={openShortcuts} />
              <AllowanceChip />
          </div>
        </header>
      }
    >
      <div className={styles.page}>
        {list.isError && (
          <div className={styles.pad}>
            <Banner status="error" title="The projects could not be read." description={`${list.error.message} The page tries again by itself.`} />
          </div>
        )}
        {route.kind === 'projects' ? (
          <ErrorBoundary label="Projects">
            <Projects projects={list.data} loading={list.isLoading} />
          </ErrorBoundary>
        ) : (
          <ProjectPage route={route} project={p} loading={!p && (list.isLoading || project.isLoading)} error={project.isError ? project.error.message : null} />
        )}
      </div>
      <CommandMenu isOpen={palette} onClose={() => setPalette(false)} project={p} projects={list.data} />
      <ShortcutsDialog isOpen={shortcuts} onClose={() => setShortcuts(false)} />
    </AppShell>
  );
}

function Trail({ route, project }: { route: Route; project: Project | undefined }) {
  if (route.kind === 'projects') {
    return (
      <Breadcrumbs label="Where you are">
        <BreadcrumbItem isCurrent>Projects</BreadcrumbItem>
      </Breadcrumbs>
    );
  }
  return (
    <Breadcrumbs label="Where you are">
      <BreadcrumbItem href="#/">Projects</BreadcrumbItem>
      <BreadcrumbItem href={routeHash({ kind: 'project', id: route.id, screen: 'overview' })}>{project?.name ?? 'Project'}</BreadcrumbItem>
      {route.screen !== 'overview' && <BreadcrumbItem isCurrent>{SCREEN_LABELS[route.screen]}</BreadcrumbItem>}
    </Breadcrumbs>
  );
}

function Nav({ route, project, projects }: { route: Route; project: Project | undefined; projects: Array<{ id: string; name: string }> | undefined }) {
  const stages = project ? Object.fromEntries(stageProgress(project).map((s) => [s.screen, s])) : {};
  return (
    <SideNav
      collapsible
      footer={project ? <CostMeter project={project} variant="compact" /> : undefined}
    >
      <SideNavSection title="Studio" isHeaderHidden>
        <SideNavItem label="All projects" icon={LayoutGrid} href="#/" isSelected={route.kind === 'projects'} />
      </SideNavSection>
      {route.kind === 'project' ? (
        <SideNavSection title={project?.name ?? 'Project'}>
          {SCREENS.map((screen) => {
            const s = screen === 'overview' ? null : stages[screen];
            const words = s ? progressWords(s) : '';
            return (
              <SideNavItem
                key={screen}
                label={SCREEN_LABELS[screen]}
                icon={ICONS[screen]}
                href={routeHash({ kind: 'project', id: route.id, screen })}
                isSelected={route.screen === screen}
                endContent={
                  s?.locked ? (
                    <span className={styles.navLock} title={s.lockWhy ?? undefined} aria-label={`Locked: ${s.lockWhy}`}>
                      <Lock size={13} aria-hidden />
                    </span>
                  ) : words ? (
                    <span className={`${styles.navCount} num`}>{words}</span>
                  ) : undefined
                }
              />
            );
          })}
        </SideNavSection>
      ) : (
        projects &&
        projects.length > 0 && (
          <SideNavSection title="Recent">
            {projects.slice(0, 8).map((x) => (
              <SideNavItem key={x.id} label={x.name} href={routeHash({ kind: 'project', id: x.id, screen: 'overview' })} />
            ))}
          </SideNavSection>
        )
      )}
    </SideNav>
  );
}

/** The screen before a locked one: where the thing it waits for is made. */
function unlockScreen(p: Project, screen: WorkScreen): WorkScreen {
  if (p.images.length === 0) return 'renders';
  const order: WorkScreen[] = ['renders', 'enhance', 'review', 'masters', 'storyboard', 'film'];
  for (let i = order.indexOf(screen) - 1; i >= 0; i--) {
    if (!stageLock(p, SCREEN_STAGE[order[i]!])) return order[i]!;
  }
  return 'renders';
}

function ProjectPage({
  route,
  project,
  loading,
  error,
}: {
  route: Extract<Route, { kind: 'project' }>;
  project: Project | undefined;
  loading: boolean;
  error: string | null;
}) {
  if (error && !project) {
    return (
      <div className={styles.pad}>
        <Banner status="error" title="This project could not be read." description={`${error} The page tries again by itself.`} />
      </div>
    );
  }
  if (!project) {
    return loading ? (
      <div className={styles.pad} aria-busy>
        <Skeleton width={280} height={32} />
        <div className={styles.skeletonHero}>
          <Skeleton height="100%" />
        </div>
      </div>
    ) : null;
  }
  const screen = route.screen;
  const lock = screen === 'overview' ? null : stageLock(project, SCREEN_STAGE[screen]);
  let body;
  if (lock && screen !== 'overview') {
    const to = unlockScreen(project, screen);
    body = <Locked screen={SCREEN_LABELS[screen]} why={lock} goLabel={`Go to ${SCREEN_LABELS[to]}`} goHref={routeHash({ kind: 'project', id: project.id, screen: to })} />;
  } else {
    switch (screen) {
      case 'overview':
        body = <Overview project={project} />;
        break;
      case 'renders':
        body = <Renders project={project} focus={route.focus} />;
        break;
      case 'enhance':
        body = <Enhance project={project} focus={route.focus} />;
        break;
      case 'review':
        body = <Review project={project} focus={route.focus} />;
        break;
      case 'masters':
        body = <Masters project={project} focus={route.focus} />;
        break;
      case 'storyboard':
        body = <Storyboard project={project} focus={route.focus} />;
        break;
      case 'film':
        body = <FilmScreen project={project} />;
        break;
    }
  }
  return (
    <>
      <div className={styles.strip}>
        <WaitingStrip project={project} />
      </div>
      <ErrorBoundary key={screen} label={SCREEN_LABELS[screen]}>
        {body}
      </ErrorBoundary>
    </>
  );
}
