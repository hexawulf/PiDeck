// Is the database schema up to date? Checked at hub start and again every
// minute while it isn't (docs/plans/multi-host-h2.md › M0 "Wiring"). With
// pending migrations the hub keeps serving — no crash loop — logs an error,
// shows a banner, and the sampler skips its database writes.
import type pg from "pg";
import { migrationStatus } from "../scripts/migrate-core.mjs";

export type SchemaState = { checked: boolean; pending: string[]; baseline: string; error: string | null };

const state: SchemaState = { checked: false, pending: [], baseline: "none", error: null };

export const schemaState = (): Readonly<SchemaState> => state;

/** True once a check found no pending work (baseline mark included). */
export const schemaReady = () => state.checked && state.error === null && state.pending.length === 0 && state.baseline === "none";

type Log = Pick<Console, "info" | "error">;

export async function checkSchema(pool: Pick<pg.Pool, "connect">, log: Log = console): Promise<SchemaState> {
  const wasReady = schemaReady();
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    const s = await migrationStatus(client);
    Object.assign(state, { checked: true, pending: s.pending, baseline: s.baseline, error: null });
  } catch (e) {
    Object.assign(state, { checked: true, error: e instanceof Error ? e.message : String(e) });
  } finally {
    client?.release();
  }
  if (schemaReady()) {
    if (!wasReady && state.checked) log.info("[db] schema up to date");
  } else {
    const what = state.error
      ? `could not check (${state.error})`
      : `${state.baseline === "needed" ? "baseline mark needed; " : state.baseline === "partial" ? "PARTIAL schema (needs a person); " : ""}pending: ${state.pending.join(", ") || "none"}`;
    log.error(`[db] DATABASE NEEDS MIGRATING — ${what}. Run: scripts/install.sh --update (or npm run db:migrate). Serving anyway; history and alerts are not written until then.`);
  }
  return state;
}

/** For tests. */
export function resetSchemaState() {
  Object.assign(state, { checked: false, pending: [], baseline: "none", error: null });
}
