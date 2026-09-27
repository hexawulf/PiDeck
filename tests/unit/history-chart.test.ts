import { describe, expect, it } from "vitest";
import { toChartPoints, type Series } from "@/components/widgets/HistoryChart";

const SERIES: Series[] = [{ key: "read", name: "Read", field: "diskReadSpeed", color: "var(--pi-chart-1)" }];
const NOW = Date.UTC(2026, 8, 27, 12, 0);
const row = (minutesAgo: number, v: number) => {
  const iso = new Date(NOW - minutesAgo * 60_000).toISOString(); // 2026-09-27T11:45:00.000Z
  return {
    timestamp: iso.replace("T", " ").replace("Z", ""), // as Postgres returns it
    cpuUsage: null, memoryUsage: null, temperature: null,
    diskReadSpeed: v, diskWriteSpeed: null, networkRx: null, networkTx: null,
  };
};

describe("toChartPoints", () => {
  it("keeps only rows inside the range, reading timestamps as UTC", () => {
    const rows = [row(120, 1), row(30, 2), row(10, 3), row(1, 4)];
    expect(toChartPoints(rows, SERIES, 15 * 60_000, NOW).map((p) => p.read)).toEqual([3, 4]);
    expect(toChartPoints(rows, SERIES, 60 * 60_000, NOW).map((p) => p.read)).toEqual([2, 3, 4]);
  });
  it("caps the output at 300 points", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(i * 0.25, i));
    expect(toChartPoints(rows, SERIES, 24 * 60 * 60_000, NOW).length).toBeLessThanOrEqual(300);
  });
});
