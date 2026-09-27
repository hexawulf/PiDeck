export function KeyValueList({ rows }: { rows: [string, string | number | null | undefined][] }) {
  return (
    <dl className="space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="text-pi-text-muted">{k}</dt>
          <dd className="truncate text-right tabular-nums">{v ?? "N/A"}</dd>
        </div>
      ))}
    </dl>
  );
}
