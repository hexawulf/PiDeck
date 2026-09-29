import { pgTable, text, serial, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(), // Renamed from password to password_hash
  last_password_change: timestamp("last_password_change").defaultNow(),
  failed_login_attempts: integer("failed_login_attempts").default(0),
  account_locked_until: timestamp("account_locked_until"), // Nullable
  // No separate username index: the unique constraint indexes it.
  // migrations/0000 (baseline) still creates idx_users_username because prod
  // has it (old hand-written migration); migrations/0001 drops it.
});

// Unused (auth sessions live in connect-pg-simple's user_sessions, which is
// deliberately *not* declared here and never touched by migrations). Kept
// declared, FK included, so the baseline matches existing databases.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password_hash: true,
});

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LogFile = {
  name: string;
  path: string;
  size: string;
  content?: string;
};

export const logIndexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  path: z.string(),
  size: z.number(),
  mtime: z.string(),
  pathExists: z.boolean(),
  tooLarge: z.boolean(),
});

export type LogIndexEntry = z.infer<typeof logIndexEntrySchema>;

// Keep legacy types for now to avoid breaking changes during migration
export type HostLog = {
  id: string;
  label: string;
  pathExists: boolean;
};

export type RpiLog = {
  id: string;
  label: string;
  path: string;
  relPath: string;
  size: number;
  mtime: string;
  pathExists: boolean;
  tooLarge: boolean;
};

export type DockerContainerPort = {
  private: number;
  public?: number;
  ip?: string;
  type: string;
};

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: DockerContainerPort[];
  createdAt: number;
  labels: Record<string, string>;
};

export type DockerContainersResponse = {
  containers: DockerContainer[];
  warning?: string;
};

export type PM2Process = {
  id: number;
  name: string;
  status: string;
  cpu: string;
  memory: string;
  uptime: string;
};

export type CronJob = {
  schedule: string;
  command: string;
  description: string;
  lastRun?: string;
  status: string;
};

// New data types for additional metrics
export type DiskIO = {
  readSpeed: number; // KB/s
  writeSpeed: number; // KB/s
  utilization: number; // Percentage
};

export const diskIOSchema = z.object({
  readSpeed: z.number().int().nonnegative().max(100000),
  writeSpeed: z.number().int().nonnegative().max(100000),
  utilization: z.number().int().min(0).max(100),
});

export type DiskIOData = z.infer<typeof diskIOSchema>;

export type NetworkBandwidth = {
  rx: number; // KB/s
  tx: number; // KB/s
};

export const networkBandwidthSchema = z.object({
  rx: z.number().int().nonnegative().max(1000000),
  tx: z.number().int().nonnegative().max(1000000),
});

export type NetworkBandwidthData = z.infer<typeof networkBandwidthSchema>;

export type ProcessInfo = {
  pid: number;
  name: string;
  cpuUsage: number; // Percentage
  memUsage: number; // Percentage
};

// Historical data table: one row per host per minute (the hub's sampler).
// TIMEZONE: `timestamp` is `timestamp without time zone` holding UTC wall
// time, while prod's database TimeZone is Asia/Taipei. Always write it from
// JS as a UTC ISO string and compute cutoffs in JS (or `now() AT TIME ZONE
// 'UTC'`); never compare it with now()/localtimestamp. No DEFAULT (dropped in
// migrations/0002): a default of now() would store Taipei local time.
export const historicalMetrics = pgTable("historical_metrics", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { mode: 'string' }).notNull(),
  cpuUsage: integer("cpu_usage"),
  memoryUsage: integer("memory_usage"), // Percentage
  temperature: integer("temperature"),
  diskReadSpeed: integer("disk_read_speed"), // KB/s
  diskWriteSpeed: integer("disk_write_speed"), // KB/s
  networkRx: integer("network_rx"), // KB/s
  networkTx: integer("network_tx"), // KB/s
  /** "local" = the hub itself, else a PIDECK_HOSTS id. */
  hostId: text("host_id").notNull().default("local"),
}, (t) => [
  // Range reads and the prune, per host.
  index("historical_metrics_host_ts_idx").on(t.hostId, t.timestamp.desc()),
]);

// Alerts per host (temperature, offline). One open alert per (host, type) at
// most, enforced by a partial unique index. timestamptz (absolute instants);
// always written explicitly from JS, never by a database default.
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  hostId: text("host_id").notNull(),
  type: text("type").notNull(), // "temperature" | "offline"
  severity: text("severity").notNull(), // "warning" | "critical"
  message: text("message").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("alerts_one_open_per_host_type").on(t.hostId, t.type).where(sql`${t.resolvedAt} IS NULL`),
  index("alerts_resolved_at_idx").on(t.resolvedAt),
]);

export type AlertRow = typeof alerts.$inferSelect;

export type HistoricalMetric = typeof historicalMetrics.$inferSelect;
export type InsertHistoricalMetric = typeof historicalMetrics.$inferInsert;

export type SystemInfoExtended = {
  hostname: string;
  os: string;
  kernel: string;
  architecture: string;
  uptime: string;
  cpu: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  temperature: number | null; // null = no sensor on this host
  network: {
    ip: string;
    status: string;
  };
  diskIO?: DiskIO;
  networkBandwidth?: NetworkBandwidth;
  processes?: ProcessInfo[];
};

export interface SystemInfo extends Omit<SystemInfoExtended, 'diskIO' | 'networkBandwidth'> {
  diskIO: DiskIO;
  networkBandwidth: NetworkBandwidth;
}

export interface ActiveAlert {
  id: string;
  message: string;
  timestamp: string;
  type: 'temperature';
}

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type LoginData = z.infer<typeof loginSchema>;
