import { Download, ImageUpscale, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  STILL_UPSCALERS,
  UPSCALE_FACTORS,
  upscalerName,
  type StillUpscalerId,
  type UpscaleFactor,
} from '../models.ts';
import { libraryUrl, stillThumbUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { FullSize } from './ui/FullSize.tsx';
import { Buy, SpendNote, useSpend } from './ui/Price.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

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
      // Shown by RunwayErrorNotice from upscale.error.
    }
  }

  return (
    <div className={styles.upscale}>
      <h3 className={styles.upscaleTitle}>{earlier ? 'Upscale of an earlier take' : 'Upscale'}</h3>
      <Text tone="muted" size="sm" as="p">
        {earlier
          ? 'This upscale belongs to the take before your newest one. It is saved in the Library either way.'
          : 'Makes a larger copy for print or close crops. It is saved next to the original, so you can animate either one.'}
      </Text>
      <div className={styles.upscaleRow}>
        <Select
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
        <Select
          label="Scale"
          options={UPSCALE_FACTORS}
          value={String(factor)}
          onChange={(id) => setFactor(id === '4' ? 4 : 2)}
          disabled={busy}
        />
        <Buy items={priceItems} note={false}>
          <Button
            icon={<ImageUpscale size={16} />}
            loading={busy}
            disabled={busy || spend.blocked || planBlocked || unavailable}
            onPress={() => void run()}
          >
            {upscale.isPending ? 'Starting…' : rendering ? 'Upscaling…' : 'Upscale'}
          </Button>
        </Buy>
      </div>
      <SpendNote items={priceItems} />
      <Text tone="muted" size="sm" as="p" className={styles.meta}>
        {STILL_UPSCALERS.find((u) => u.id === upscaler)?.hint}. Each picture shows its price before you make it.
      </Text>

      <RunwayErrorNotice
        error={shownError}
        modelName={upscalerName(status.error && job ? job.upscaler : upscaler)}
        onRetry={() => void (shownError === status.error ? status.refetch() : run())}
      />

      {(rendering || url || taskError) && (
        <div className={styles.upscaleResult}>
          <div className={styles.resultFrame} style={{ aspectRatio, ['--ar' as string]: aspectRatio }}>
            {url ? (
              <img
                className={styles.image}
                src={job ? stillThumbUrl(job.id) : url}
                alt="Upscaled film still (preview; open full size for every pixel)"
              />
            ) : rendering ? (
              <RenderingStatus
                label="Upscaling the still…"
                progress={status.data?.progress}
                runKey={job?.id}
              />
            ) : (
              <div className={styles.frameAlert}>
                <Alert tone="error" title="The upscale didn't finish">
                  {taskError}
                </Alert>
              </div>
            )}
          </div>
          {url && job && (
            <div className={styles.resultActions}>
              <Button
                icon={<Download size={16} />}
                loading={saver.pending}
                onPress={() => saver.start(libraryUrl('still', job.id), `${name}-${job.factor}x.png`)}
              >
                {saver.label('Download upscaled')}
              </Button>
              <FullSize
                src={libraryUrl('still', job.id)}
                kind="still"
                title={`${upscalerName(job.upscaler)}, ${job.factor}×`}
                alt="Upscaled still"
              />
              {earlier && (
                <Button variant="ghost" size="sm" icon={<X size={14} />} onPress={() => onJob(null)}>
                  Dismiss
                </Button>
              )}
              <Text tone="muted" size="sm" className={styles.resultNote}>
                {upscalerName(job.upscaler)}, {job.factor}×
              </Text>
            </div>
          )}
          {saver.error && (
            <Alert tone="error" title="Download failed">
              {saver.error}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
