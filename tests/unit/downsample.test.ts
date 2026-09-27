import { describe, expect, it } from "vitest";
import { downsample, type Point } from "@/lib/downsample";

const MIN = 60_000;
const series = (n: number, stepMs = 5000, t0 = 0): Point[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + i * stepMs, a: i, b: 2 * i }) as Point);
const gaps = (pts: Point[]) => pts.filter((p) => p.a === null && p.b === null);

describe("downsample", () => {
  it("handles empty and single inputs", () => {
    expect(downsample([])).toEqual([]);
    const one = series(1);
    expect(downsample(one)).toEqual(one);
  });

  it.each([299, 300])("returns %i evenly spaced points unchanged", (n) => {
    const pts = series(n);
    expect(downsample(pts)).toEqual(pts);
  });

  it("reduces a full day of 5s samples to ≤300 and keeps both endpoints", () => {
    const pts = series(17280);
    const out = downsample(pts);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.length).toBeGreaterThan(250);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(gaps(out)).toHaveLength(0);
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
  });

  it("averages buckets", () => {
    const out = downsample(series(1000), 10);
    // interior points are bucket means, so b stays exactly 2a
    for (const p of out) expect(p.b).toBeCloseTo(2 * (p.a as number));
  });

  it("sorts unsorted input", () => {
    const pts = series(5).reverse();
    expect(downsample(pts).map((p) => p.t)).toEqual([0, 5000, 10000, 15000, 20000]);
  });

  it("inserts a null row for a 2h hole", () => {
    const before = series(100, MIN / 12); // ~8 min at 5s
    const after = series(100, MIN / 12, before[99].t + 2 * 60 * MIN);
    const out = downsample([...before, ...after]);
    expect(gaps(out)).toHaveLength(1);
    const g = out.findIndex((p) => p.a === null);
    expect(out[g - 1].t).toBe(before[99].t);
    expect(out[g + 1].t).toBe(after[0].t);
  });

  it("keeps gaps when downsampling", () => {
    const before = series(10000, 5000);
    const after = series(5000, 5000, before[9999].t + 3 * 60 * MIN);
    const out = downsample([...before, ...after]);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(gaps(out)).toHaveLength(1);
    expect(out[0]).toEqual(before[0]);
    expect(out[out.length - 1]).toEqual(after[4999]);
  });

  it("stays within max when there are many holes", () => {
    // bursts of 3 samples separated by long holes → hundreds of gaps
    const pts: Point[] = [];
    for (let burst = 0; burst < 400; burst++)
      for (let j = 0; j < 3; j++) pts.push({ t: burst * 60 * MIN + j * 5000, a: j, b: j } as Point);
    const out = downsample(pts, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(gaps(out).length).toBeGreaterThan(0);
  });

  it("treats null values as missing when averaging", () => {
    const pts = series(20).map((p, i) => ({ ...p, a: i % 2 ? null : p.a }) as Point);
    const out = downsample(pts, 5);
    for (const p of out.slice(1, -1)) expect(p.a).not.toBeNull();
  });
});
