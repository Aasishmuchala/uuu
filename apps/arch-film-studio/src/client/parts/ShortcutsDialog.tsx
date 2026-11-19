import { Dialog, DialogHeader, Heading, Kbd } from '../kit.ts';
import styles from './Dialogs.module.css';

type Row = { keys: string[]; words: string };

/** Every key the app answers, in one place. */
export const SHORTCUTS: Array<{ title: string; rows: Row[] }> = [
  {
    title: 'Everywhere',
    rows: [
      { keys: ['mod+k'], words: 'Go to a screen or a picture' },
      { keys: ['?'], words: 'Show these shortcuts' },
      { keys: ['esc'], words: 'Close, or let go of the selection' },
    ],
  },
  {
    title: 'Contact sheets',
    rows: [
      { keys: ['shift'], words: 'Hold while clicking to pick a run of pictures' },
      { keys: ['mod'], words: 'Hold while clicking to add or take away one' },
      { keys: ['mod+a'], words: 'Pick every picture in view' },
    ],
  },
  {
    title: 'Review',
    rows: [
      { keys: ['a'], words: 'Approve' },
      { keys: ['r'], words: 'Reject' },
      { keys: ['v'], words: 'Write a revision note' },
      { keys: ['left', 'right'], words: 'Previous and next picture' },
      { keys: ['j', 'k'], words: 'Previous and next picture' },
      { keys: ['1', '9'], words: 'Pick a version, 1 to 9' },
      { keys: ['space'], words: 'Hold to see the render' },
      { keys: ['f'], words: 'Full size' },
      { keys: ['u'], words: 'Next picture to decide' },
      { keys: ['g'], words: 'Grid or focus view' },
    ],
  },
  {
    title: 'Storyboard',
    rows: [
      { keys: ['alt+left', 'alt+right'], words: 'Move the shot in front earlier or later' },
      { keys: ['left', 'right'], words: 'Previous and next shot' },
    ],
  },
];

/** The Shortcuts sheet, opened with ? or the top bar's button. */
export function ShortcutsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} width={720} maxHeight="85dvh">
      <DialogHeader title="Keyboard shortcuts" onOpenChange={(open: boolean) => !open && onClose()} />
      <div className={styles.keys}>
        {SHORTCUTS.map((group) => (
          <section key={group.title} className={styles.group} aria-label={group.title}>
            <Heading level={4} accessibilityLevel={3}>
              {group.title}
            </Heading>
            <ul className={styles.list}>
              {group.rows.map((row) => (
                <li key={row.words + row.keys.join()} className={styles.row}>
                  <span>{row.words}</span>
                  <span className={styles.combo}>
                    {row.keys.map((k, i) => (
                      <span key={k} className={styles.combo}>
                        {i > 0 && (row.keys[0] === '1' ? 'to' : 'or')}
                        <Kbd keys={k} />
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.foot}>Keys do nothing while you type in a field. No key spends money: a button that costs something always needs a click.</p>
    </Dialog>
  );
}
