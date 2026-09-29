// Types for scripts/migrate-core.mjs (plain JS so `npm run db:migrate` needs no build).
import type { Client } from "pg";

export const MIGRATIONS_DIR: string;
export const MIGRATIONS_TABLE: string;
export const BASELINE_TABLES: string[];
export const MIGRATE_LOCK_KEY: number;

export type Migration = { idx: number; tag: string; when: number; hash: string; statements: string[] };
export function readMigrations(dir?: string): Migration[];

type Log = Partial<Pick<Console, "info" | "warn" | "error">>;
type Queryable = Pick<Client, "query">;

export type MigrationStatus = {
  tracked: boolean;
  baseline: "none" | "needed" | "partial";
  applied: { hash: string; created_at: number }[];
  pending: string[];
  edited: string[];
};
export function migrationStatus(client: Queryable, opts?: { dir?: string }): Promise<MigrationStatus>;
export function migrate(client: Queryable, opts?: { dir?: string; log?: Log }): Promise<{ baselined: boolean; applied: string[] }>;
