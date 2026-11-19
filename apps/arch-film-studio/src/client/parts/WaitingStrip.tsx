import type { Project } from '../../shared/project.ts';
import { Banner, Button } from '../kit.ts';
import { waitingCount, waitingWords } from '../lib/stages.ts';
import { errorText } from '../money.tsx';
import { trpc } from '../trpc.ts';
import { useApply } from '../useApply.ts';

/**
 * The jobs still waiting to be sent, with the one way to stop them before
 * they go (REVIEW-AFS finding 2). Shown above every screen of a project.
 */
export function WaitingStrip({ project }: { project: Project }) {
  const apply = useApply();
  const cancel = trpc.project.cancelWaiting.useMutation({ onSuccess: apply });
  const n = waitingCount(project);
  if (n === 0) return null;
  return (
    <div role="status">
      <Banner
        status="info"
        title={waitingWords(n)}
        description={cancel.error ? errorText(cancel.error) : undefined}
        endContent={
          <Button
            label="Cancel waiting"
            size="sm"
            variant="secondary"
            isLoading={cancel.isPending}
            onClick={() => {
              if (!cancel.isPending) cancel.mutate({ id: project.id });
            }}
          />
        }
      />
    </div>
  );
}
