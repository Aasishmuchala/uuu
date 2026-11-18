import { Download } from 'lucide-react';

import styles from '../Stages.module.css';

/**
 * "Download": the stored file's own address with `?download`, which the
 * server answers as an attachment. It stays in this window; nothing opens.
 */
export function DownloadLink({ href, label = 'Download', name }: { href: string; label?: string; name: string }) {
  return (
    <a className={styles.download} href={href} download aria-label={`${label} ${name}`}>
      <Download size={16} aria-hidden />
      {label}
    </a>
  );
}
