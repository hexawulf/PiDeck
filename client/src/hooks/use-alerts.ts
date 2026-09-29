import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getQueryFn } from "@/lib/queryClient";

// Alerts are raised by the hub's 60s sampler for every host
// (server/services/sampler.ts). This poll only picks them up for the toast,
// so it keeps a fixed 7s and deliberately ignores the refresh speed and
// Pause (E1) — don't use useRefetch here.
export const ALERTS_INTERVAL_MS = 7000;
export const ALERTS_URL = "/api/alerts?host=all";

export const alertSchema = z.object({
  id: z.number(),
  hostId: z.string(),
  hostLabel: z.string(),
  type: z.string(),
  severity: z.string(),
  message: z.string(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type AlertView = z.infer<typeof alertSchema>;
const fetchJson = getQueryFn<unknown>({ on401: "throw" });

/** Open alerts on every host, plus those resolved in the last hour. */
export function useAlerts() {
  return useQuery<AlertView[]>({
    queryKey: [ALERTS_URL],
    queryFn: async (ctx) => z.array(alertSchema).parse(await fetchJson(ctx)),
    refetchInterval: ALERTS_INTERVAL_MS,
  });
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "?" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "piapps2: offline since 08:12", "piapps2: temperature above 70 °C (75.0 °C)". */
export function alertText(a: AlertView): string {
  if (a.type === "offline") return `${a.hostLabel}: offline since ${hhmm(a.startedAt)}`;
  return `${a.hostLabel}: ${lowerFirst(a.message)}`;
}

/** "piapps2: back online", "piapps2: temperature back to normal". */
export function resolvedText(a: AlertView): string {
  if (a.type === "offline") return `${a.hostLabel}: back online`;
  if (a.type === "temperature") return `${a.hostLabel}: temperature back to normal`;
  return `${a.hostLabel}: resolved`;
}
