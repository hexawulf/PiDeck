// Test double for scripts/migrate.mjs (tests/install/run.sh): records the
// call and fakes the three outcomes on the file-based "database" in
// $PIDECK_TEST_STATE: fresh (create the tables), baseline mark (tables there,
// not yet tracked), up to date. $PIDECK_TEST_STATE/migrate-fail makes it fail.
import fs from "node:fs";
import path from "node:path";

const state = process.env.PIDECK_TEST_STATE;
const f = (n) => path.join(state, n);
fs.appendFileSync(f("calls"), "migrate\n");
if (fs.existsSync(f("migrate-fail"))) {
  console.error("[migrate] migration 0002_host_history failed and was rolled back: boom");
  process.exit(1);
}
if (!fs.existsSync(f("tables"))) {
  fs.writeFileSync(f("tables"), "");
  fs.writeFileSync(f("admin"), "default");
  fs.writeFileSync(f("migrated"), "");
  console.log("[migrate] applied 0000_baseline\n[migrate] done");
} else if (!fs.existsSync(f("migrated"))) {
  fs.writeFileSync(f("migrated"), "");
  console.warn("[migrate] BASELINE: existing PiDeck tables found … Recorded 0000_baseline as applied WITHOUT running it");
} else {
  console.log("[migrate] up to date");
}
