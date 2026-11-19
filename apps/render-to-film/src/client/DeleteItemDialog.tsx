import { AlertDialog } from './kit.ts';
import { trpc } from './trpc.ts';

export type DeleteTarget = { kind: 'still' | 'clip'; id: string; title: string };

export type DeleteItemDialogProps = {
  target: DeleteTarget | null;
  onClose: () => void;
  /** After the item is gone (the library is already refreshed). */
  onDeleted?: ((target: DeleteTarget) => void) | undefined;
};

/** Confirms and deletes one still or clip from the visitor's library. */
export function DeleteItemDialog({ target, onClose, onDeleted }: DeleteItemDialogProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, { enabled: target !== null });
  const remove = trpc.deleteItem.useMutation();

  const copies =
    target?.kind === 'still'
      ? (library.data?.stills ?? []).filter((s) => s.upscaleOf === target.id).length
      : (library.data?.clips ?? []).filter((c) => c.upscaleOf === target?.id).length;
  const clips =
    target?.kind === 'still'
      ? (library.data?.clips ?? []).filter((c) => c.stillId === target.id).length
      : 0;
  const noun = target?.kind === 'clip' ? 'video' : 'film still';

  const close = () => {
    remove.reset();
    onClose();
  };
  const confirm = async () => {
    if (!target || remove.isPending) return;
    try {
      await remove.mutateAsync({ kind: target.kind, id: target.id });
      await utils.library.invalidate();
      onDeleted?.(target);
      close();
    } catch {
      // Shown in the dialog; it stays open so the visitor can retry.
    }
  };

  const description = [
    `${target?.title ?? 'It'} will be removed from your library. This can't be undone.`,
    copies > 0 ? `Its ${copies === 1 ? 'upscaled copy goes' : `${copies} upscaled copies go`} with it.` : '',
    clips > 0 ? `The ${clips === 1 ? 'video' : `${clips} videos`} you made from it stay in your library.` : '',
    remove.error ? `Couldn't delete it: ${remove.error.message}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AlertDialog
      isOpen={target !== null}
      onOpenChange={(open: boolean) => !open && close()}
      title={`Delete this ${noun}?`}
      description={description}
      actionLabel="Delete"
      onAction={() => void confirm()}
      isActionLoading={remove.isPending}
    />
  );
}
