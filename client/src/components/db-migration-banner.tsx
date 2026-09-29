/** The hub started with schema migrations pending (M0): it serves, but writes no history or alerts. */
export function DbMigrationBanner() {
  return (
    <div role="status" className="mx-4 mt-4 rounded-xl border border-pi-error px-4 py-2 text-center text-sm text-pi-text" data-testid="db-migration-banner">
      <strong>Database needs migrating:</strong> run <code>scripts/install.sh --update</code> (or <code>npm run db:migrate</code>) on the
      hub. Until then no history or alerts are recorded.
    </div>
  );
}
