import { useState } from 'react';

import { Banner, Button, Dialog, DialogHeader, TextInput } from '../kit.ts';
import styles from './Dialogs.module.css';

/** Naming a new project, or renaming this one. Enter makes it. */
export function NameDialog({
  isOpen,
  title,
  confirm,
  initial,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  confirm: string;
  initial: string;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const go = () => {
    if (trimmed && !loading) onConfirm(trimmed);
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onCancel()} purpose="form" width={440}>
      <DialogHeader title={title} onOpenChange={(open: boolean) => !open && onCancel()} />
      <div className={styles.body}>
        <TextInput label="Name" value={name} onChange={(v: string) => setName(v)} onEnter={go} hasAutoFocus placeholder="The building or the client" />
        {error && <Banner status="error" title={error} />}
        <div className={styles.actions}>
          <Button label="Cancel" variant="ghost" onClick={onCancel} />
          <Button label={confirm} variant="primary" isLoading={loading} isDisabled={!trimmed} onClick={go} />
        </div>
      </div>
    </Dialog>
  );
}
