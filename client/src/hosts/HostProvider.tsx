import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getQueryFn } from "@/lib/queryClient";
import { useRefetch } from "@/hooks/useRefetch";
import { isLocalHost, LOCAL_HOST } from "./host-path";

// Which host the current page shows, from the URL (App.tsx): /dashboard …
// is the hub itself ("local"), /h/:hostId/<tab> a remote agent. Every
// per-host query builds its path with apiPath(host.id, …) and puts the host
// id in its query key, so caches never mix hosts.

export const hostSummarySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    local: z.boolean(),
    status: z.enum(["online", "offline", "auth-error", "version-mismatch"]),
    version: z.string().nullable(),
    lastSeen: z.string().nullable(),
    /** "unsupported" = agent < 2.5: no history until it's updated (amber). Optional: a 2.4 hub doesn't send it. */
    history: z.enum(["ok", "unsupported", "unknown"]).optional(),
    /** The agent serves remote logs (2.6+, PIDECK_AGENT_LOGS=on): the Logs tab shows for it. Optional: older hubs don't send it. */
    logs: z.boolean().optional(),
  })
  .strict();
export const hostsSchema = z.array(hostSummarySchema);
export type HostSummary = z.infer<typeof hostSummarySchema>;

export type HostCtx = { id: string; isLocal: boolean };
const LOCAL: HostCtx = { id: LOCAL_HOST, isLocal: true };
const Ctx = createContext<HostCtx>(LOCAL);

export function HostProvider({ hostId, children }: { hostId: string; children: ReactNode }) {
  const value = useMemo(() => ({ id: hostId, isLocal: isLocalHost(hostId) }), [hostId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useHost = () => useContext(Ctx);

export const HOSTS_KEY = ["/api/hosts"] as const;
const fetchJson = getQueryFn<unknown>({ on401: "throw" });

/** The hub's host list (local first), polled every 30 s (plan › UI). */
export function useHosts() {
  const refetchInterval = useRefetch(30_000);
  return useQuery<HostSummary[], Error>({
    queryKey: HOSTS_KEY,
    queryFn: async (ctx) => hostsSchema.parse(await fetchJson(ctx)),
    refetchInterval,
    staleTime: 10_000,
  });
}

/** The summary for one host id (undefined while loading or when unknown). */
export function useHostSummary(hostId: string): HostSummary | undefined {
  const { data } = useHosts();
  return data?.find((h) => h.id === hostId);
}
