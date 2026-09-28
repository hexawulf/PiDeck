import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { getQueryFn } from "@/lib/queryClient";
import { useRefetch } from "@/hooks/useRefetch";
import { useHost } from "@/hosts/HostProvider";
import { apiPath, LOCAL_HOST } from "@/hosts/host-path";

const fetchJson = getQueryFn<unknown>({ on401: "throw" });

/** Query key for `url` on a host: [request path, host id]. The default queryFn fetches key[0]. */
export const widgetQueryKey = (hostId: string, url: string) => [apiPath(hostId, url), hostId] as const;

/** The response arrived but did not match the widget's schema. */
export class UnexpectedDataError extends Error {
  constructor(url: string, readonly issues: z.ZodIssue[]) {
    super(
      `${url}: ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; "),
    );
    this.name = "UnexpectedDataError";
  }
}

/**
 * Poll `url` on the current host (useHost) every `baseMs` (scaled by the
 * header speed, off while paused — see useRefetch) and validate with
 * `schema`. Key is `[apiPath(host, url), host]`: every widget reading the
 * same endpoint on the same host shares one request, and hosts never share
 * a cache entry. `scope: "hub"` always asks the hub itself (history, which
 * only the hub records). The query only polls while a component using it
 * is mounted — hidden widgets cost nothing.
 */
export function useWidgetQuery<S extends z.ZodTypeAny>(
  url: string,
  baseMs: number | false,
  schema: S,
  { scope = "host" }: { scope?: "host" | "hub" } = {},
) {
  const refetchInterval = useRefetch(baseMs);
  const host = useHost();
  const hostId = scope === "hub" ? LOCAL_HOST : host.id;
  return useQuery<z.infer<S>, Error>({
    queryKey: widgetQueryKey(hostId, url),
    queryFn: async (ctx) => {
      const raw = await fetchJson(ctx);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new UnexpectedDataError(url, parsed.error.issues);
      return parsed.data;
    },
    refetchInterval,
  });
}

/** A short line for the card plus the raw text for the "details" disclosure. */
export function describeError(error: unknown): { summary: string; details: string } {
  const details = error instanceof Error ? error.message : String(error);
  if (error instanceof UnexpectedDataError) return { summary: "Unexpected data from the server", details };
  const status = Number(/^(\d{3}):/.exec(details)?.[1]);
  if (status === 401) return { summary: "Session expired — sign in again", details };
  if (status === 404) return { summary: "Not available on this host", details };
  if (status >= 500) return { summary: "The server couldn't read this metric", details };
  if (error instanceof TypeError) return { summary: "Server unreachable", details };
  return { summary: "Couldn't load data", details };
}
