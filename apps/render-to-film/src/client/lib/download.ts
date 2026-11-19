import { useCallback, useState } from 'react';

import { withDownload } from '../../attachment.ts';

/**
 * Save a file under `filename`. The page asks first (a HEAD, so nothing is
 * read twice) and then follows a link to the file's own address with
 * `?download=<filename>`, which the server answers as an attachment
 * (src/attachment.ts). Never a `blob:` copy: the Mac app's web view loads a
 * `blob:` link in the frame, which the home page refuses, instead of saving
 * it. Throws a readable error when the file can't be had; a popup opened
 * after an await would be blocked, so there is no open-in-a-tab fallback.
 * The bytes arrive in the browser's own download, so `onProgress` only hears
 * the start and the end.
 */
export async function download(url: string, filename: string, onProgress?: (fraction: number) => void) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'HEAD' });
  } catch {
    throw new Error('The download was cut off. Check your connection and try again.');
  }
  if (res.status === 404) throw new Error('This file is no longer in your library.');
  if (!res.ok) throw new Error(`The download failed (${res.status}). Try again.`);
  saveLink(withDownload(url, filename), filename);
  onProgress?.(1);
}

/** Follow a same-origin attachment link from this page; it stays in this window. */
export function saveLink(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * A download button's state: `start` fetches and saves, `pending` is true
 * until the file is saved, `label` reads "Downloading 42%" while it runs.
 */
export function useDownload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback((url: string, filename: string) => {
    setProgress(0);
    setError(null);
    // A file arrives in many small chunks; re-render once per percent, not per chunk.
    let shown = 0;
    const onProgress = (f: number) => {
      const pct = Math.floor(f * 100) / 100;
      if (pct !== shown) setProgress((shown = pct));
    };
    download(url, filename, onProgress)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'The download failed. Try again.'))
      .finally(() => setProgress(null));
  }, []);
  const pending = progress !== null;
  const label = (idle: string) =>
    pending ? (progress > 0 ? `Downloading ${Math.round(progress * 100)}%` : 'Starting download…') : idle;
  return { start, pending, label, error };
}

// The app's own addresses of library media live in urls.ts (no React there, so the pure modules
// and their tests can use them); they are re-exported here for the pages that import them from here.
export { libraryUrl, stillThumbUrl, stillViewUrl } from './urls.ts';
