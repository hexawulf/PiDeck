import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// System data types
export type SystemInfo = {
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
};

export type LogFile = {
  name: string;
  path: string;
  size: string;
  content?: string;
};

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type LoginData = z.infer<typeof loginSchema>;
