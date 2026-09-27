/** Placeholder while the grid chunk loads or its width is being measured. */
export function GridSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-4" aria-busy="true" aria-label="Loading dashboard" data-testid="grid-skeleton">
      {[3, 3, 3, 3, 6, 6].map((w, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg border border-pi-border bg-pi-card" style={{ gridColumn: `span ${w}` }} />
      ))}
    </div>
  );
}
