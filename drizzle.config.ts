import { defineConfig } from "drizzle-kit";

// Migrations (docs/plans/multi-host-h2.md › M0):
//   npm run db:generate   → a new numbered file in migrations/ from shared/schema.ts
//   npm run db:migrate    → scripts/migrate.mjs applies pending ones (advisory lock,
//                           one transaction each, baseline mark for pre-2.5 databases)
// Only the tables declared in schema.ts are ever managed. user_sessions
// (connect-pg-simple) is not, so no generated migration can touch it.
export const MANAGED_TABLES = ["users", "sessions", "historical_metrics", "alerts"];

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  tablesFilter: MANAGED_TABLES,
  schemaFilter: ["public"],
  migrations: { table: "__drizzle_migrations", schema: "public" },
  // generate needs no connection; push/pull/studio do.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://unused@localhost/unused" },
});
