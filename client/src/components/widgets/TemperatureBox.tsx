import { useSystemInfo } from "@/hooks/use-system-info";
import { QueryState } from "@/widgets/WidgetFrame";
import { Meter } from "./Meter";

// 70 °C matches the server's alert threshold (server/services/system.ts).
export function temperatureLevel(c: number) {
  if (c >= 70) return { label: "Hot", text: "text-pi-error", dot: "bg-pi-error" };
  if (c >= 60) return { label: "Warm", text: "text-pi-warning", dot: "bg-pi-warning" };
  return { label: "Normal", text: "text-pi-success", dot: "bg-pi-success" };
}

export function TemperatureBox() {
  const query = useSystemInfo();
  return (
    <QueryState query={query}>
      {({ temperature }) => {
        const level = temperatureLevel(temperature);
        return (
          <Meter
            label="CPU temperature"
            value={`${temperature.toFixed(1)}°C`}
            valueClassName={level.text}
            caption={
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${level.dot}`} aria-hidden />
                {level.label}
              </span>
            }
          />
        );
      }}
    </QueryState>
  );
}
