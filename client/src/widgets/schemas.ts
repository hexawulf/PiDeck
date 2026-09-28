// Response shapes for every endpoint a dashboard widget polls. useWidgetQuery
// validates against these, so a backend shape change shows "Unexpected data"
// on that one card instead of a TypeError. The live contract spec
// (tests/e2e/contract.spec.ts) checks them against a real server.
import { z } from "zod";

const num = z.number();
const numOrNull = z.number().nullable();
const strOrNull = z.string().nullable();

/**
 * "This host can't provide it" (server/services/unavailable.ts): a 200 answer
 * that QueryState renders calmly instead of an error card. Strict: nothing
 * else may ride along.
 */
export const unavailableSchema = z
  .object({
    available: z.literal(false),
    reason: z.enum(["not-installed", "no-device", "needs-sudoers", "not-supported"]),
    message: z.string(),
  })
  .strict();
export type Unavailable = z.infer<typeof unavailableSchema>;
export const isUnavailable = (d: unknown): d is Unavailable =>
  typeof d === "object" && d !== null && (d as { available?: unknown }).available === false;
const orUnavailable = <S extends z.ZodTypeAny>(s: S) => z.union([s, unavailableSchema]);

export const processSchema = z.object({
  pid: num,
  name: z.string(),
  cpuUsage: num,
  memUsage: num,
});

export const systemInfoSchema = z.object({
  hostname: z.string(),
  os: z.string(),
  kernel: z.string(),
  architecture: z.string(),
  uptime: z.string(),
  cpu: num,
  memory: z.object({ used: num, total: num, percentage: num }),
  temperature: numOrNull, // null = no sensor on this host
  network: z.object({ ip: z.string(), status: z.string() }),
  diskIO: z.object({ readSpeed: num, writeSpeed: num, utilization: num }),
  networkBandwidth: z.object({ rx: num, tx: num }),
  processes: z.array(processSchema).optional(),
});

export const historySchema = z.array(
  z.object({
    timestamp: z.string(),
    cpuUsage: numOrNull,
    memoryUsage: numOrNull,
    temperature: numOrNull,
    diskReadSpeed: numOrNull,
    diskWriteSpeed: numOrNull,
    networkRx: numOrNull,
    networkTx: numOrNull,
  }),
);

export const cpuFreqSchema = z.array(z.object({ core: z.string(), freq: z.string() }));

export const filesystemsSchema = z.array(
  z.object({
    device: z.string().optional(),
    mount: z.string(),
    type: z.string().optional(),
    size: num,
    used: num,
    avail: num,
    pcent: num,
  }),
);

export const mountsSchema = z.array(
  z.object({ device: z.string(), mountpoint: z.string(), fstype: z.string(), options: z.string() }),
);

export const ramSchema = z.object({ total: num, used: num, free: num, usage: num });

export const swapSchema = z.object({ total: num, used: num, free: num });

export const nvmeSchema = orUnavailable(
  z.object({
    temperature: strOrNull,
    power_on_hours: strOrNull,
    wear_leveling_count: strOrNull,
    media_errors: strOrNull,
  }),
);

export const thermalZonesSchema = orUnavailable(
  z.array(
    z.object({ zone: z.string(), label: z.string(), temp: z.string() }),
  ),
);

export const powerStatusSchema = orUnavailable(
  z.object({
    voltage: numOrNull,
    current: numOrNull,
    status: z.string(),
  }),
);

export const ipConfigSchema = z.object({
  interfaces: z.array(
    z.object({
      ifname: z.string(),
      addr: z.array(z.string()),
      ipv6: z.array(z.string()),
      mac: z.string().optional(),
    }),
  ),
});

export const listeningPortsSchema = z.object({
  listening: z.array(
    z.object({ proto: z.string(), port: num, ip: z.string(), desc: z.string().optional() }),
  ),
});

export const firewallStatusSchema = orUnavailable(
  z.object({
    engine: z.string(),
    enabled: z.boolean(),
    note: z.string().optional(),
    rules: z.array(
      z.object({
        to: z.string().optional(),
        port: z.string().optional(),
        proto: z.string().optional(),
        action: z.string(),
        from: z.string().optional(),
        comment: z.string().optional(),
      }),
    ),
  }),
);

/** url → schema, for the contract spec. */
export const ENDPOINT_SCHEMAS = {
  "/api/system/info": systemInfoSchema,
  "/api/system/history": historySchema,
  "/api/metrics/cpu-freq": cpuFreqSchema,
  "/api/metrics/filesystems": filesystemsSchema,
  "/api/metrics/mounts": mountsSchema,
  "/api/metrics/ram": ramSchema,
  "/api/metrics/swap": swapSchema,
  "/api/metrics/nvme": nvmeSchema,
  "/api/metrics/thermal-zones": thermalZonesSchema,
  "/api/metrics/power-status": powerStatusSchema,
  "/api/metrics/ip-config": ipConfigSchema,
  "/api/metrics/listening-ports": listeningPortsSchema,
  "/api/metrics/firewall-status": firewallStatusSchema,
} as const;

/**
 * Endpoints that depend on hardware or tools a host may lack (NVMe + sudo
 * smartctl, /sys/class/thermal). The contract spec accepts a 5xx
 * from these; any 2xx must still match the schema.
 */
export const HARDWARE_OPTIONAL = new Set<string>([
  "/api/metrics/nvme",
  "/api/metrics/thermal-zones",
]);
