import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import { latestEnhancement, mediaUrl, outputUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import { DEFAULT_ENHANCE_MODEL, ENHANCE_MODELS, type EnhanceModel, enhanceSize } from '../../server/models.ts';
import { Button, EmptyState, SegmentedControl, SegmentedControlItem, Selector } from '../kit.ts';
import { notEnhanced, pictureState } from '../lib/progress.ts';
import { capForSpend } from '../lib/selection.ts';
import { enhanceAsk } from '../lib/spend.ts';
import { altOf, jobWords } from '../lib/stages.ts';
import { LOCKED_MASTER } from '../lib/words.ts';
import { errorText, SpendButton, useMoney } from '../money.tsx';
import { ContactSheet, type SheetItem } from '../parts/ContactSheet.tsx';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { SelectionBar } from '../parts/SelectionBar.tsx';
import { useSelection } from '../parts/useSelection.ts';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';

const busy = (s: string | undefined) => s === 'queued' || s === 'running';

type Filter = 'all' | 'fresh' | 'making' | 'done' | 'failed';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'fresh', label: 'Not enhanced' },
  { value: 'making', label: 'Being made' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

function inFilter(image: ProjectImage, f: Filter): boolean {
  const last = latestEnhancement(image);
  switch (f) {
    case 'all':
      return true;
    case 'fresh':
      return notEnhanced(image);
    case 'making':
      return busy(last?.state);
    case 'done':
      return image.enhancements.some((r) => r.state === 'succeeded');
    case 'failed':
      return last?.state === 'failed';
  }
}

/** The picture to show for an image here: its newest finished version, else its render. */
function shownOf(image: ProjectImage) {
  const made = [...image.enhancements].reverse().find((r) => r.state === 'succeeded' && r.storedKey);
  if (made) return { src: outputUrl(made)!, size: made.outputSize ?? image, what: `version ${made.version}` };
  return { src: mediaUrl(image.thumbKey), size: { width: image.width, height: image.height }, what: 'the render' };
}

/** Each render becomes a photograph of itself: pick pictures, choose the model, see the price, enhance. */
export function Enhance({ project, focus }: { project: Project; focus?: string | undefined }) {
  const apply = useApply();
  const { models } = useMoney();
  const [filter, setFilter] = useState<Filter>('all');
  const [model, setModel] = useState<EnhanceModel>(DEFAULT_ENHANCE_MODEL);
  const shown = project.images.filter((i) => inFilter(i, filter));
  const selection = useSelection(shown.map((i) => i.id));
  const enhance = trpc.image.enhance.useMutation({
    onSuccess: (p) => {
      apply(p);
      selection.clear();
    },
  });

  const { set } = selection;
  useEffect(() => {
    if (focus) set([focus]);
  }, [focus, set]);

  const picked = selection.ids.map((id) => project.images.find((i) => i.id === id)).filter((i): i is ProjectImage => !!i);
  const sentIds = capForSpend(picked.map((i) => i.id));
  const sent = picked.filter((i) => sentIds.includes(i.id));
  const making = sent.filter((i) => busy(latestEnhancement(i)?.state) || busy(i.master?.state));
  const locked = sent.filter((i) => i.master?.locked);
  const codes = (list: ProjectImage[]) => list.map((i) => i.code).join(', ');
  const holdWhy =
    locked.length === 1 && sent.length === 1
      ? LOCKED_MASTER
      : locked.length > 0
        ? `${codes(locked)} ${locked.length === 1 ? 'has a locked master' : 'have locked masters'}. Take ${locked.length === 1 ? 'it' : 'them'} out of the selection first.`
        : making.length > 0
          ? `${codes(making)} ${making.length === 1 ? 'is' : 'are'} being made. Take ${making.length === 1 ? 'it' : 'them'} out of the selection first.`
          : null;
  const fresh = project.images.filter((i) => notEnhanced(i) && !i.master?.locked);

  const items: SheetItem[] = shown.map((image) => {
    const pic = shownOf(image);
    const last = latestEnhancement(image);
    const words = jobWords(last);
    return {
      id: image.id,
      src: pic.src,
      alt: altOf(image, pic.what),
      width: pic.size.width,
      height: pic.size.height,
      code: image.code,
      name: image.name,
      meta: last ? `v${last.version}, asks for ${enhanceSize(image.settings, image)}` : `Asks for ${enhanceSize(image.settings, image)}`,
      locked: !!image.master?.locked,
      state: pictureState(image),
      working: words.busy ? { words: words.words, progress: last?.progress, since: last ? Date.parse(last.createdAt) : undefined } : null,
      error: last?.state === 'failed' ? (last.error ?? 'This version did not finish.') : null,
    };
  });

  return (
    <div className={`${screen.screen} ${screen.wide}`}>
      <ScreenHeader title="Enhance" sentence="Each render becomes a photograph of itself. Strict mode changes nothing but photographic quality.">
        {fresh.length > 0 && (
          <Button
            label={`Select all not enhanced (${fresh.length})`}
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilter('all');
              set(fresh.map((i) => i.id));
            }}
          />
        )}
      </ScreenHeader>

      <div className={screen.toolbar}>
        <SegmentedControl label="Show" value={filter} onChange={(v: string) => setFilter(v as Filter)} size="sm">
          {FILTERS.map((f) => (
            <SegmentedControlItem key={f.value} value={f.value} label={`${f.label} ${project.images.filter((i) => inFilter(i, f.value)).length}`} />
          ))}
        </SegmentedControl>
      </div>

      {items.length === 0 ? (
        <div className={screen.empty}>
          <EmptyState title="Nothing here" description="No picture is in this group right now." actions={<Button label="Show all" variant="secondary" onClick={() => setFilter('all')} />} />
        </div>
      ) : (
        <ContactSheet items={items} label="Pictures to enhance" selection={selection} />
      )}

      {picked.length > 0 && (
        <SelectionBar
          count={picked.length}
          onClear={selection.clear}
          action={
            <SpendButton
              label={picked.length === 1 && picked[0]!.enhancements.length > 0 ? 'Enhance again' : `Enhance ${sent.length}`}
              icon={<Sparkles size={16} aria-hidden />}
              asks={sent.map((i) => enhanceAsk(i, model))}
              loading={enhance.isPending}
              error={errorText(enhance.error)}
              holdWhy={holdWhy}
              onPress={() => enhance.mutate({ projectId: project.id, imageIds: sent.map((i) => i.id), model })}
            />
          }
        >
          <Selector
            label="Model"
            isLabelHidden
            variant="secondary"
            size="md"
            value={model}
            onChange={(v: string) => setModel(v as EnhanceModel)}
            options={ENHANCE_MODELS.map((id) => {
              const row = models?.find((m) => m.id === id);
              return { value: id, label: row?.words ?? id, description: row && !row.ready ? (row.why ?? undefined) : undefined };
            })}
          />
        </SelectionBar>
      )}
    </div>
  );
}
