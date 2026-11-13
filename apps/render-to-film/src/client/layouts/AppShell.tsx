import type React from 'react';

import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import styles from './AppShell.module.css';

export type AppShellProps = {
  title?: React.ReactNode | undefined;
  actions?: React.ReactNode;
  /** The app's own mark, shown before the title. */
  brand?: React.ReactNode;
  /** Primary navigation (the page tabs), in the header beside the title. */
  nav?: React.ReactNode;
  /** `'none'` lets the page use the full width of the window. */
  maxWidth?: number | 'none';
  /**
   * Stretches `<main>` to fill the viewport height left below the header,
   * instead of the default document-scrolls page. For a page that owns its
   * own scrolling internally — a chat transcript, a table with a pinned
   * toolbar — rather than growing as tall as its content; a page that
   * doesn't scrolls inside `main`. Also drops `main`'s side padding and
   * `maxWidth` cap: a page like that owns its own edge treatment and often
   * wants the full width, not the default reading measure.
   */
  fillViewport?: boolean;
  /**
   * Renders no header bar — `title`/`actions` are accepted but unused. For
   * a page whose own top-level chrome (a chat sidebar, a nav rail) already
   * covers the app title and wants to own the very top of the viewport
   * instead of sitting below a second header.
   */
  hideHeader?: boolean;
  children?: React.ReactNode;
};

export function AppShell({
  title,
  actions,
  brand,
  nav,
  maxWidth = 960,
  fillViewport = false,
  hideHeader = false,
  children,
}: AppShellProps) {
  return (
    <div
      data-bay-block="app-shell"
      className={fillViewport ? styles.shellFill : styles.shell}
    >
      {!hideHeader && (
        <header data-bay-block="app-header" className={styles.header}>
          <div className={styles.brand}>
            {brand}
            <strong className={styles.title}>{title}</strong>
          </div>
          {nav && <div className={styles.nav}>{nav}</div>}
          <div className={styles.actions}>
            {actions}
          </div>
        </header>
      )}
      {fillViewport ? (
        <main className={styles.mainFill}>
          <ErrorBoundary label="page">{children}</ErrorBoundary>
        </main>
      ) : (
        <main
          className={maxWidth === 'none' ? styles.mainWide : styles.main}
          style={maxWidth === 'none' ? undefined : { maxWidth }}
        >
          <ErrorBoundary label="page">{children}</ErrorBoundary>
        </main>
      )}
    </div>
  );
}
