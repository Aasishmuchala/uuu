import { CircleCheck, RotateCcw, ScanEye, TriangleAlert, WandSparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { PEOPLE_CHECKS } from '../checks.ts';
import { Badge, Banner, Button, Heading, Skeleton, Text } from './kit.ts';
import { errorMessage } from './lib/runwayErrors.ts';
import { ErrorNote } from './parts/ErrorNote.tsx';
import { trpc } from './trpc.ts';
import { Buy, type PriceItem, useSpend } from './ui/Price.tsx';
import styles from './PeopleCheck.module.css';

export type PeopleCheckProps = {
  stillId: string;
  /** Start the check by itself when this still has never been checked. */
  autoRun: boolean;
  /** Re-take the still with the reviewer's corrections. */
  onFix: (fixes: string) => void;
  fixing?: boolean | undefined;
  /** What a re-take costs (the still's own model and size), for the price and the gate beside "Fix and re-take". */
  retake?: PriceItem[] | undefined;
};

/**
 * The automatic review of a still with people in it: height against the
 * scene, grounding and physics, light, faces, blend, and that nothing else
 * changed, with a re-take that carries the reviewer's fixes.
 */
export function PeopleCheck({ stillId, autoRun, onFix, fixing = false, retake = [] }: PeopleCheckProps) {
  const spend = useSpend(retake);
  const utils = trpc.useUtils();
  const checkShot = trpc.checkShot.useMutation({
    onSuccess: () => utils.checkStatus.invalidate({ stillId }),
  });
  const status = trpc.checkStatus.useQuery(
    { stillId },
    {
      refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
      retry: 2,
    }
  );
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!autoRun || started.current === stillId) return;
    if (status.isSuccess && status.data === null && !checkShot.isPending) {
      started.current = stillId;
      checkShot.mutate({ stillId });
    }
  }, [autoRun, stillId, status.isSuccess, status.data, checkShot]);

  const check = status.data;
  const running = checkShot.isPending || check?.status === 'running';
  const run = () => {
    if (running || fixing) return;
    checkShot.mutate({ stillId });
  };

  return (
    <section className={styles.panel} aria-labelledby={`check-${stillId}`}>
      <div className={styles.head}>
        <span id={`check-${stillId}`} className={styles.title}>
          <ScanEye size={16} aria-hidden />
          <Heading level={3}>People check</Heading>
        </span>
        {check?.status === 'done' && (
          <Badge
            variant={check.report.verdict === 'pass' ? 'success' : 'warning'}
            label={`${check.report.verdict === 'pass' ? 'Looks real' : 'Needs fixes'}, ${check.report.score} of 10`}
          />
        )}
      </div>

      {running ? (
        <div role="status" aria-live="polite" className={styles.stack}>
          <Text type="supporting" as="p">
            Measuring each person against the curbs, lamps and trees, and checking feet, shadows, faces and blend.
          </Text>
          <Skeleton height={12} width="92%" index={0} />
          <Skeleton height={12} width="80%" index={1} />
          <Skeleton height={12} width="86%" index={2} />
          <Skeleton height={12} width="64%" index={3} />
        </div>
      ) : checkShot.error ? (
        <div className={styles.stack}>
          <ErrorNote error={checkShot.error} />
          <div>
            <Button label="Try the check again" size="sm" icon={<RotateCcw size={14} />} onClick={run} />
          </div>
        </div>
      ) : status.error ? (
        <div className={styles.stack}>
          <Banner status="error" title="The people check could not be loaded" description={errorMessage(status.error)} />
          <div>
            <Button
              label="Try again"
              size="sm"
              icon={<RotateCcw size={14} />}
              isLoading={status.isFetching}
              onClick={() => void status.refetch()}
            />
          </div>
        </div>
      ) : check?.status === 'failed' ? (
        <div className={styles.stack}>
          <Text as="p">{check.error}</Text>
          <div>
            <Button label="Run the check again" size="sm" icon={<RotateCcw size={14} />} onClick={run} />
          </div>
        </div>
      ) : check?.status === 'done' ? (
        <div className={styles.stack}>
          <Text as="p">{check.report.summary}</Text>
          <ul className={styles.list}>
            {PEOPLE_CHECKS.map((c) => {
              const item = check.report.checks.find((x) => x.id === c.id);
              if (!item) return null;
              return (
                <li key={c.id} className={styles.item}>
                  {item.ok ? (
                    <CircleCheck size={14} className={styles.okIcon} role="img" aria-label="Passed" />
                  ) : (
                    <TriangleAlert size={14} className={styles.badIcon} role="img" aria-label="Issue" />
                  )}
                  <Text>
                    <Text weight="medium">{c.name}.</Text> {item.note}
                  </Text>
                </li>
              );
            })}
          </ul>
          {check.report.verdict === 'issues' && check.report.fixes.trim() && (
            <Text type="supporting" as="p">
              The re-take will ask for: {check.report.fixes}
            </Text>
          )}
          <div className={styles.actions}>
            {check.report.verdict === 'issues' && check.report.fixes.trim() && (
              <Buy items={retake}>
                <Button
                  label="Fix and re-take"
                  icon={<WandSparkles size={16} />}
                  isLoading={fixing}
                  isDisabled={fixing || running || spend.blocked}
                  onClick={() => onFix(check.report.fixes)}
                />
              </Buy>
            )}
            <Button
              label="Check again"
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={14} />}
              onClick={run}
              isDisabled={fixing || running}
            />
          </div>
        </div>
      ) : status.isLoading ? (
        <div className={styles.stack}>
          <Skeleton height={12} width="90%" />
          <Skeleton height={12} width="70%" index={1} />
        </div>
      ) : (
        <div className={styles.stack}>
          <Text as="p">Checks height, footing, shadows, faces and blend for every person in this still.</Text>
          <div>
            <Button label="Check the people" size="sm" icon={<ScanEye size={14} />} onClick={run} />
          </div>
        </div>
      )}
      <Text type="supporting" as="p">
        Reviewed by Claude Opus 5.5 through the model provider in Settings.
      </Text>
    </section>
  );
}
