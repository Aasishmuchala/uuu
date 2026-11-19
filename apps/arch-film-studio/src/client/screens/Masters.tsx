import { Maximize } from 'lucide-react';
import { useEffect, useState } from 'react';

import { approvedEnhancement, mediaUrl, outputUrl, type Project, type ProjectImage } from '../../shared/project.ts';
import { masterNote } from '../../server/models.ts';
import { Button } from '../kit.ts';
import { pictureState, wantsMaster } from '../lib/progress.ts';
import { capForSpend } from '../lib/selection.ts';
import { masterCost } from '../lib/spend.ts';
import { altOf, jobWords, sizeWords } from '../lib/stages.ts';
import { NO_COST_AT_SIZE, UPSCALE_CAPPED } from '../lib/words.ts';
import { errorText, FreeButton, SpendButton } from '../money.tsx';
import { ContactSheet, type SheetItem } from '../parts/ContactSheet.tsx';
import { DownloadLink } from '../parts/DownloadLink.tsx';
import { FullSizeView, type FullSizeMedia } from '../parts/FullSize.tsx';
import { ScreenHeader } from '../parts/ScreenHeader.tsx';
import { SelectionBar } from '../parts/SelectionBar.tsx';
import { useSelection } from '../parts/useSelection.ts';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';
import screen from './Screen.module.css';

const busy = (s: string | undefined) => s === 'queued' || s === 'running';

/** The picture a tile shows: the locked master, else the approved version. */
function shownOf(image: ProjectImage) {
  const m = image.master;
  if (m?.locked && m.storedKey) return { src: mediaUrl(m.storedKey), size: m.outputSize ?? image, what: 'master' };
  const run = approvedEnhancement(image)!;
  return { src: outputUrl(run) ?? mediaUrl(image.thumbKey), size: run.outputSize ?? image, what: `approved version ${run.version}` };
}

/** "3840 × 2160 px" for a made master; what it will be made to, for one still to make. */
function sizeLine(image: ProjectImage): string {
  const m = image.master;
  if (m?.locked) return m.outputSize ? sizeWords(m.outputSize) : 'Locked master';
  const run = approvedEnhancement(image)!;
  const cost = masterCost(image);
  const target = m?.targetLongEdge ?? cost?.target;
  const from = run.outputSize ? sizeWords(run.outputSize) : `v${run.version}`;
  return target ? `${from}, to ${target} px` : from;
}

/** Each approved picture becomes a locked master at its final size; a locked master is never made again. */
export function Masters({ project, focus }: { project: Project; focus?: string | undefined }) {
  const apply = useApply();
  const images = project.images.filter((i) => approvedEnhancement(i));
  const selection = useSelection(images.map((i) => i.id));
  const [full, setFull] = useState<FullSizeMedia | null>(null);
  const make = trpc.image.master.useMutation({
    onSuccess: (p) => {
      apply(p);
      selection.clear();
    },
  });

  const { set } = selection;
  useEffect(() => {
    if (focus) set([focus]);
  }, [focus, set]);

  const picked = selection.ids.map((id) => images.find((i) => i.id === id)).filter((i): i is ProjectImage => !!i);
  const batch = picked.filter(wantsMaster);
  const sentIds = capForSpend(batch.map((i) => i.id));
  const sent = batch.filter((i) => sentIds.includes(i.id));
  const paid = sent.flatMap((i) => {
    const c = masterCost(i);
    return c && !c.free ? [c.ask] : [];
  });
  const working = picked.filter((i) => busy(i.master?.state) || i.enhancements.some((r) => busy(r.state)));
  const made = picked.filter((i) => i.master?.locked).length;
  const holdWhy =
    working.length > 0
      ? `${working.map((i) => i.code).join(', ')} ${working.length === 1 ? 'is' : 'are'} being made. Take ${working.length === 1 ? 'it' : 'them'} out of the selection first.`
      : null;
  const open = images.filter(wantsMaster);
  const press = () => make.mutate({ projectId: project.id, imageIds: sent.map((i) => i.id) });
  const label = `Make ${sent.length} ${sent.length === 1 ? 'master' : 'masters'}`;

  const items: SheetItem[] = images.map((image) => {
    const pic = shownOf(image);
    const m = image.master;
    const w = jobWords(m, 'Locked');
    const cost = masterCost(image);
    const capped = masterNote(m) ?? (cost?.free && cost.capped && !m?.locked ? UPSCALE_CAPPED : undefined);
    return {
      id: image.id,
      src: pic.src,
      alt: altOf(image, pic.what),
      width: pic.size.width,
      height: pic.size.height,
      code: image.code,
      name: image.name,
      meta: capped ? `${sizeLine(image)}. ${capped}` : sizeLine(image),
      locked: !!m?.locked,
      state: pictureState(image),
      working: w.busy ? { words: `Master: ${w.words}`, progress: m?.progress, since: m ? Date.parse(m.createdAt) : undefined } : null,
      error: w.error,
      end: m?.locked && m.storedKey ? <DownloadLink compact href={outputUrl(m, true)!} name={`${image.code} master`} /> : undefined,
    };
  });

  return (
    <div className={`${screen.screen} ${screen.wide}`}>
      <ScreenHeader title="Masters" sentence="Each approved picture becomes a locked master at its final size. A locked master is never made again.">
        {open.length > 0 && <Button label={`Select all without a master (${open.length})`} variant="ghost" size="sm" onClick={() => set(open.map((i) => i.id))} />}
      </ScreenHeader>

      <ContactSheet
        items={items}
        label="Approved pictures"
        selection={selection}
        clickMode="open"
        onOpen={(id) => {
          const image = images.find((i) => i.id === id);
          if (!image) return;
          const pic = shownOf(image);
          setFull({ src: pic.src, kind: 'still', alt: altOf(image, pic.what), caption: `${image.code}, ${sizeLine(image)}` });
        }}
      />
      <p className={screen.quiet} style={{ marginTop: 'var(--spacing-5)' }}>
        Click a picture to see it full size and zoom to 100%. Tick pictures to make their masters.
      </p>

      {picked.length > 0 && (
        <SelectionBar
          count={picked.length}
          onClear={selection.clear}
          note={made > 0 ? `${made} already ${made === 1 ? 'has a locked master' : 'have locked masters'}.` : null}
          action={
            sent.length === 0 ? (
              <FreeButton label="Make masters" note="Nothing to make" variant="primary" disabled onPress={() => {}} />
            ) : paid.length > 0 ? (
              <SpendButton label={label} icon={<Maximize size={16} aria-hidden />} asks={paid} loading={make.isPending} error={errorText(make.error)} holdWhy={holdWhy} onPress={press} />
            ) : (
              <FreeButton label={label} note={NO_COST_AT_SIZE} variant="primary" icon={<Maximize size={16} aria-hidden />} loading={make.isPending} disabled={!!holdWhy} why={holdWhy} error={errorText(make.error)} onPress={press} />
            )
          }
        />
      )}

      <FullSizeView media={full} onClose={() => setFull(null)} />
    </div>
  );
}
