import { useWidgetQuery } from "@/widgets/useWidgetQuery";
import { cpuFreqSchema } from "@/widgets/schemas";
import { QueryState } from "@/widgets/WidgetFrame";

export function CpuFreqBox() {
  const query = useWidgetQuery("/api/metrics/cpu-freq", 5000, cpuFreqSchema);
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No CPU frequency data available">
      {(cores) => (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {cores.map((c) => (
            <li key={c.core} className="flex justify-between gap-2">
              <span className="text-pi-text-muted">{c.core.toUpperCase()}</span>
              <span className="tabular-nums">{c.freq}</span>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}
