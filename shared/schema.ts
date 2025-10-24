import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(), // Renamed from password to password_hash
  last_password_change: timestamp("last_password_change").defaultNow(),
  failed_login_attempts: integer("failed_login_attempts").default(0),
  account_locked_until: timestamp("account_locked_until"), // Nullable
});

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

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
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

// Historical data table
export const historicalMetrics = pgTable("historical_metrics", {
  id: serial("id").primaryKey(),
  // store timestamp as ISO string for postgres.js compatibility
  timestamp: timestamp("timestamp", { mode: 'string' }).notNull().defaultNow(),
  cpuUsage: integer("cpu_usage"),
  memoryUsage: integer("memory_usage"), // Percentage
  temperature: integer("temperature"),
  diskReadSpeed: integer("disk_read_speed"), // KB/s
  diskWriteSpeed: integer("disk_write_speed"), // KB/s
  networkRx: integer("network_rx"), // KB/s
  networkTx: integer("network_tx"), // KB/s
});

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
  temperature: number;
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
