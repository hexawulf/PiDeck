import { useSystemInfo } from "@/hooks/use-system-info";
import { QueryState } from "@/widgets/WidgetFrame";

export function SystemInfoBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query}>
      {(d) => (
        <dl className="divide-y divide-pi-border">
          {(
            [
              ["Hostname", d.hostname],
              ["OS", d.os],
              ["Kernel", d.kernel],
              ["Architecture", d.architecture],
              ["Uptime", d.uptime],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-1.5">
              <dt className="text-pi-text-muted">{k}</dt>
              <dd className="truncate font-mono text-xs" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </QueryState>
  );
}
