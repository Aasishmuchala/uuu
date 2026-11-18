import { FolderPlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from 'react-aria-components';

import type { ProjectSummary } from '../shared/project.ts';
import { errorText } from './money.tsx';
import { trpc } from './trpc.ts';
import { useApply } from './useApply.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { Select } from './ui/Select.tsx';
import styles from './Stages.module.css';

/** The project list, "New project" and "Rename". */
export function ProjectPicker({
  projects,
  currentId,
  onChoose,
}: {
  projects: ProjectSummary[] | undefined;
  currentId: string | null;
  onChoose: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const apply = useApply();
  const [asking, setAsking] = useState<'new' | 'rename' | null>(null);
  const create = trpc.project.create.useMutation({
    onSuccess: (p) => {
      // The list holds the new project before it is chosen, so the page does not fall back to another.
      utils.project.list.setData(undefined, (old) => [
        { id: p.id, name: p.name, updatedAt: p.updatedAt, imageCount: 0, masterCount: 0, thumbKeys: [] },
        ...(old ?? []).filter((x) => x.id !== p.id),
      ]);
      apply(p);
      onChoose(p.id);
      setAsking(null);
    },
  });
  const rename = trpc.project.rename.useMutation({
    onSuccess: (p) => {
      apply(p);
      setAsking(null);
    },
  });
  const current = projects?.find((p) => p.id === currentId);

  return (
    <div className={styles.picker}>
      {projects && projects.length > 0 && (
        <Select
          label="Project"
          value={currentId ?? ''}
          onChange={onChoose}
          showHint={false}
          options={projects.map((p) => ({
            id: p.id,
            name: p.name,
            hint: `${p.imageCount} ${p.imageCount === 1 ? 'render' : 'renders'}, ${p.masterCount} ${p.masterCount === 1 ? 'master' : 'masters'}`,
          }))}
        />
      )}
      {current && (
        <Button variant="ghost" icon={<Pencil size={14} aria-hidden />} onPress={() => setAsking('rename')}>
          Rename
        </Button>
      )}
      <Button variant="primary" icon={<FolderPlus size={16} aria-hidden />} onPress={() => setAsking('new')}>
        New project
      </Button>
      <NameDialog
        key={asking ?? 'closed'}
        isOpen={asking !== null}
        title={asking === 'rename' ? 'Rename the project' : 'New project'}
        confirm={asking === 'rename' ? 'Rename' : 'Make project'}
        initial={asking === 'rename' ? (current?.name ?? '') : ''}
        loading={create.isPending || rename.isPending}
        error={errorText(asking === 'rename' ? rename.error : create.error)}
        onCancel={() => {
          create.reset();
          rename.reset();
          setAsking(null);
        }}
        onConfirm={(name) => {
          if (asking === 'rename' && currentId) rename.mutate({ id: currentId, name });
          else create.mutate({ name });
        }}
      />
    </div>
  );
}

function NameDialog({
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
  return (
    <ModalOverlay className={styles.overlay} isOpen={isOpen} isDismissable onOpenChange={(open) => !open && onCancel()}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <Heading slot="title" className={styles.dialogTitle}>
            {title}
          </Heading>
          <TextField className={styles.field} value={name} onChange={setName} maxLength={80} autoFocus>
            <Label className={styles.fieldLabel}>Name</Label>
            <Input
              className={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed) onConfirm(trimmed);
              }}
            />
          </TextField>
          {error && <Alert tone="error" title={error} />}
          <div className={styles.dialogActions}>
            <Button variant="ghost" onPress={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} disabled={!trimmed} onPress={() => onConfirm(trimmed)}>
              {confirm}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
