import { Download } from 'lucide-react';

import styles from './DownloadLink.module.css';

/**
 * "Download": the stored file's own address with `?download`, which the
 * server answers as an attachment. It stays in this window; nothing opens.
 */
export function DownloadLink({ href, label = 'Download', name, compact }: { href: string; label?: string; name: string; compact?: boolean }) {
  return (
    <a className={styles.link} data-compact={compact || undefined} href={href} download aria-label={`${label} ${name}`} title={`${label} ${name}`}>
      <Download size={compact ? 14 : 16} aria-hidden />
      {!compact && label}
    </a>
  );
}
