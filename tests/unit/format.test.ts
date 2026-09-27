import { describe, expect, it } from "vitest";
import { formatMB, formatNumber, parseDbTimestamp, rateScale } from "@/lib/format";

describe("parseDbTimestamp", () => {
  it("reads zone-less Postgres timestamps as UTC", () => {
    expect(parseDbTimestamp("2026-09-22 06:52:00.123")).toBe(Date.UTC(2026, 8, 22, 6, 52, 0, 123));
    expect(parseDbTimestamp("2026-09-22T06:52:00")).toBe(Date.UTC(2026, 8, 22, 6, 52));
  });
  it("respects an explicit zone", () => {
    expect(parseDbTimestamp("2026-09-22T06:52:00Z")).toBe(Date.UTC(2026, 8, 22, 6, 52));
    expect(parseDbTimestamp("2026-09-22 14:52:00+08:00")).toBe(Date.UTC(2026, 8, 22, 6, 52));
  });
});

describe("number formatting", () => {
  it("picks one unit per axis", () => {
    expect(rateScale(900)).toEqual({ unit: "KB/s", divisor: 1 });
    expect(rateScale(2048).unit).toBe("MB/s");
    expect(rateScale(5 * 1024 * 1024).unit).toBe("GB/s");
  });
  it("formats sizes and numbers", () => {
    expect(formatMB(512)).toBe("512 MB");
    expect(formatMB(1536)).toBe("1.5 GB");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234.5)).toBe("1,235");
  });
});
