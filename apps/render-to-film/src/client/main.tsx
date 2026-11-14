import './styles/bay-tokens.css';
import './styles/tokens.css';
import './styles/global.css';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { trpcFetch } from './lib/trpcFetch.ts';
import { bayTrpcLink } from './trpcLink.ts';
import { trpc } from './trpc.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';

// A restart leaves the server unreachable for a few seconds: reads retry over
// about half a minute before showing an error. Refusals (permission, missing)
// are final and show at once. Mutations never retry here, so a generation is
// never paid for twice.
const FINAL = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE']);
const queryClient: QueryClient = new QueryClient({
  // Anything sent may have spent from the allowance: the header's chip asks
  // again at once instead of at its next 15-second look.
  mutationCache: new MutationCache({
    onSettled: () => void queryClient.invalidateQueries({ queryKey: [['engine', 'allowance']] }),
  }),
  defaultOptions: {
    queries: {
      retry: (failures, error) =>
        failures < 5 && !FINAL.has((error as { data?: { code?: string } } | null)?.data?.code ?? ''),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
  },
});
const trpcClient = trpc.createClient({
  // Queries as GET. trpcFetch turns a gate or edge reply into a readable tRPC error.
  links: [bayTrpcLink({ url: '/trpc', fetch: trpcFetch })],
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <ErrorBoundary>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </ErrorBoundary>
);
