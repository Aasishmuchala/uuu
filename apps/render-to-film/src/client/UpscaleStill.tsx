import { Download, ImageUpscale, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  STILL_UPSCALERS,
  UPSCALE_FACTORS,
  upscalerName,
  type StillUpscalerId,
  type UpscaleFactor,
} from '../models.ts';
import { Banner, Button, Heading, Text } from './kit.ts';
import { libraryUrl, stillThumbUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { OptionSelect } from './parts/OptionSelect.tsx';
import { StageWorking } from './parts/Stage.tsx';
import { trpc } from './trpc.ts';
import { FullSize } from './ui/FullSize.tsx';
import { Buy, SpendNote, useSpend } from './ui/Price.tsx';
import styles from './parts/SidePanel.module.css';

export type UpscaleStillProps = {
  stillId: string;
  /** CSS aspect-ratio of the still, so the result frame doesn't jump. */
  aspectRatio: string;
  /** Filename stem for the download. */
  name: string;
  /** The upscale for this still; kept by the parent so it survives a new take. */
  job: UpscaleJob | null;
  onJob: (job: UpscaleJob | null) => void;
  /** This is the upscale of a take a newer one replaced: say so, and allow dismissing it. */
  earlier?: boolean | undefined;
};

export type UpscaleJob = {
  id: string;
  upscaler: StillUpscalerId;
  factor: UpscaleFactor;
  /** The still's frame and download name, for when its own panel is gone. */
  aspectRatio: string;
  name: string;
};

/** Upscale a finished still; the copy lands in the library as its own take. */
export function UpscaleStill({ stillId, aspectRatio, name, job, onJob, earlier = false }: UpscaleStillProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const [upscaler, setUpscaler] = useState<StillUpscalerId>('precision');
  const [factor, setFactor] = useState<UpscaleFactor>(2);

  const upscale = trpc.upscaleStill.useMutation();
  const status = trpc.shotStatus.useQuery(
    { id: job?.id ?? '' },
    {
      enabled: job !== null,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const doneId = status.data?.done ? job?.id : undefined;
  useEffect(() => {
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);

  const rendering = job !== null && !status.data?.done && !status.error;
  const busy = upscale.isPending || rendering;
  const url = status.data?.done ? status.data.url : undefined;
  const taskError =
    status.data?.done && !status.data.url
      ? status.data.error ?? 'The upscale did not return an image. Try again.'
      : undefined;
  const shownError = upscale.error ?? status.error;
  const { planBlocked, unavailable } = classifyRunwayError(shownError);
  const priceItems = [{ preset: upscaler, scale: factor }];
  const spend = useSpend(priceItems);

  async function run() {
    try {
      const { id } = await upscale.mutateAsync({ stillId, upscaler, factor });
      onJob({ id, upscaler, factor, aspectRatio, name });
    } catch {
      // Shown by ErrorNote from upscale.error.
    }
  }

  return (
    <section className={styles.panel} aria-label={earlier ? 'Upscale of an earlier take' : 'Upscale'}>
      <Heading level={3}>{earlier ? 'Upscale of an earlier take' : 'Upscale'}</Heading>
      <Text type="supporting" as="p">
        {earlier
          ? 'This upscale belongs to the take before your newest one. It is saved in the Library either way.'
          : 'Makes a larger copy for print or close crops. It is saved next to the original, so you can animate either one.'}
      </Text>
      <div className={styles.row}>
        <OptionSelect
          label="Upscaler"
          options={STILL_UPSCALERS}
          value={upscaler}
          onChange={(id) => {
            setUpscaler(id as StillUpscalerId);
            upscale.reset();
          }}
          disabled={busy}
          showHint={false}
        />
        <OptionSelect
          label="Scale"
          options={UPSCALE_FACTORS}
          value={String(factor)}
          onChange={(id) => setFactor(id === '4' ? 4 : 2)}
          disabled={busy}
          showHint={false}
        />
      </div>
      <Text type="supporting" as="p">
        {STILL_UPSCALERS.find((u) => u.id === upscaler)?.hint}. Each picture shows its price before you make it.
      </Text>
      <Buy items={priceItems} note={false}>
        <Button
          label={upscale.isPending ? 'Starting' : rendering ? 'Upscaling' : 'Upscale'}
          icon={<ImageUpscale size={16} />}
          isLoading={busy}
          isDisabled={busy || spend.blocked || planBlocked || unavailable}
          onClick={() => void run()}
        />
      </Buy>
      <SpendNote items={priceItems} />

      <ErrorNote error={shownError} />

      {(rendering || url || taskError) && (
        <>
          <div className={styles.frame} style={{ aspectRatio }}>
            {url ? (
              <img
                src={job ? stillThumbUrl(job.id) : url}
                alt="Upscaled film still (preview; open full size for every pixel)"
              />
            ) : rendering ? (
              <StageWorking label="Upscaling the still" progress={status.data?.progress} runKey={job?.id} />
            ) : null}
          </div>
          {taskError && <Banner status="error" title="The upscale didn't finish" description={taskError} />}
          {url && job && (
            <div className={styles.actions}>
              <Button
                label={saver.label('Download upscaled')}
                icon={<Download size={16} />}
                isLoading={saver.pending}
                onClick={() => saver.start(libraryUrl('still', job.id), `${name}-${job.factor}x.png`)}
              />
              <FullSize
                src={libraryUrl('still', job.id)}
                kind="still"
                title={`${upscalerName(job.upscaler)}, ${job.factor}×`}
                alt="Upscaled still"
                iconOnly
              />
              {earlier && (
                <Button label="Dismiss" variant="ghost" size="sm" icon={<X size={14} />} onClick={() => onJob(null)} />
              )}
              <Text type="supporting">
                {upscalerName(job.upscaler)}, {job.factor}×
              </Text>
            </div>
          )}
          {saver.error && <Banner status="error" title="Download failed" description={saver.error} />}
        </>
      )}
    </section>
  );
}
