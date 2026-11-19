import { trpc } from '../trpc.ts';

/**
 * Saving an item's tags through the existing `setTags`, shown at once and put back if the
 * server refuses (as the old Library card did). The star and the tag editor both use it.
 */
export function useTagSaver() {
  const utils = trpc.useUtils();
  return trpc.setTags.useMutation({
    onMutate: async ({ kind, id, tags }) => {
      await utils.library.cancel();
      const before = utils.library.getData();
      utils.library.setData(undefined, (lib) =>
        lib &&
        (kind === 'still'
          ? { ...lib, stills: lib.stills.map((s) => (s.id === id ? { ...s, tags } : s)) }
          : { ...lib, clips: lib.clips.map((c) => (c.id === id ? { ...c, tags } : c)) })
      );
      return { before };
    },
    onError: (_err, _input, context) => {
      if (context?.before) utils.library.setData(undefined, context.before);
    },
    onSettled: () => void utils.library.invalidate(),
  });
}
