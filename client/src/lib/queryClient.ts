import { MutationCache, QueryCache, QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Centralized API client with credentials support
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const AUTH_QUERY_KEY = ["/api/auth/me"] as const;

/** Errors from throwIfResNotOk start with the status: "401: {…}". */
export const isUnauthorized = (error: unknown) => error instanceof Error && /^401\b/.test(error.message);

/**
 * The session ended while the app was open (expired in a background tab, or
 * signed out elsewhere). One 401 from any request re-checks /api/auth/me:
 * it answers `authenticated: false`, ProtectedRoute redirects to /login and
 * every poll stops. Without this the dashboard stayed up with every card
 * saying "Session expired" and kept polling. Many 401s at once share one
 * refetch (react-query dedupes it).
 */
export function createSessionWatch(client: () => QueryClient) {
  return (error: unknown, key?: readonly unknown[]) => {
    if (!isUnauthorized(error)) return;
    if (key?.[0] === AUTH_QUERY_KEY[0]) return; // the check itself (never 401s) — don't loop
    const qc = client();
    const me = qc.getQueryData<{ authenticated?: boolean }>(AUTH_QUERY_KEY);
    if (me && me.authenticated !== true) return; // already known to be signed out (e.g. a wrong password on /login)
    void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  };
}

const onUnauthorized = createSessionWatch(() => queryClient);

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => onUnauthorized(error, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (error) => onUnauthorized(error) }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Polling queries (systemInfo, history, alerts, docker, pm2) set their own
      // refetchInterval which drives data freshness. Non-polling queries (auth/me,
      // cron/jobs) are manually invalidated on mutations. Infinity prevents
      // unnecessary background refetches on re-mount while the dashboard is active.
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
