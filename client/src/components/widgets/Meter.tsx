import { cn } from "@/lib/utils";

/** Big number + optional bar + caption, shared by the stat widgets. */
export function Meter({
  value,
  valueClassName,
  percent,
  barClassName = "bg-pi-accent",
  label,
  caption,
}: {
  value: string;
  valueClassName?: string;
  percent?: number;
  barClassName?: string;
  label: string;
  caption?: React.ReactNode;
}) {
  const pct = percent === undefined ? undefined : Math.max(0, Math.min(100, percent));
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <p className={cn("text-2xl font-bold tabular-nums", valueClassName)}>{value}</p>
      {pct !== undefined && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="h-2 w-full rounded-full bg-pi-darker"
        >
          <div className={cn("h-2 rounded-full transition-all duration-500", barClassName)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {caption && <div className="text-xs text-pi-text-muted">{caption}</div>}
    </div>
  );
}
