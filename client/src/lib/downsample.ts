/*
 * downsample — shrink a time series for charting without hiding holes.
 * ────────────────────────────────────────────────────────────────────
 *  rows (sorted by t) ─► split where gap > 3× median spacing
 *                          │   (history is written only while a tab polls,
 *                          │    see TODOS.md "server-side sampler")
 *                          ▼
 *        segment A   {t, all keys null}   segment B   …
 *            │            gap marker          │
 *            ▼                                ▼
 *     bucket-average to its share of `max`, first/last point kept exactly
 *
 *  Output length ≤ max. Recharts draws the null row as a break when the
 *  series uses connectNulls={false}.
 */
export type Point = { t: number } & Record<string, number | null>;

const GAP_FACTOR = 3;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function valueKeys(rows: Point[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (k !== "t") keys.add(k);
  return [...keys];
}

function average(bucket: Point[], keys: string[]): Point {
  const out: Point = { t: bucket.reduce((sum, r) => sum + r.t, 0) / bucket.length } as Point;
  for (const k of keys) {
    let sum = 0;
    let n = 0;
    for (const r of bucket) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    (out as Record<string, number | null>)[k] = n ? sum / n : null;
  }
  return out;
}

/** Reduce one gap-free segment to `target` points, keeping both endpoints. */
function shrink(seg: Point[], target: number, keys: string[]): Point[] {
  if (seg.length <= target) return seg;
  if (target <= 1) return [seg[seg.length - 1]];
  if (target === 2) return [seg[0], seg[seg.length - 1]];
  const inner = seg.slice(1, -1);
  const buckets = target - 2;
  const out: Point[] = [seg[0]];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * inner.length) / buckets);
    const to = Math.floor(((b + 1) * inner.length) / buckets);
    if (to > from) out.push(average(inner.slice(from, to), keys));
  }
  out.push(seg[seg.length - 1]);
  return out;
}

export function downsample(input: Point[], max = 300): Point[] {
  if (max < 1) return [];
  const rows = [...input].sort((a, b) => a.t - b.t);
  if (rows.length === 0) return [];
  const keys = valueKeys(rows);

  // Find holes. If there are too many to give each segment ≥2 points plus a
  // marker, keep only the largest ones.
  const diffs = rows.slice(1).map((r, i) => r.t - rows[i].t);
  const threshold = median(diffs) * GAP_FACTOR;
  let gapIdx = threshold > 0 ? diffs.flatMap((d, i) => (d > threshold ? [i] : [])) : [];
  const maxGaps = Math.max(0, Math.floor((max - 2) / 3));
  if (gapIdx.length > maxGaps) {
    gapIdx = [...gapIdx].sort((a, b) => diffs[b] - diffs[a]).slice(0, maxGaps).sort((a, b) => a - b);
  }

  const segments: Point[][] = [];
  let start = 0;
  for (const i of gapIdx) {
    segments.push(rows.slice(start, i + 1));
    start = i + 1;
  }
  segments.push(rows.slice(start));

  // Budget: markers first, then at least min(len, 2) per segment, the rest
  // shared in proportion to what each segment still has.
  const budget = max - (segments.length - 1);
  const base = segments.map((s) => Math.min(s.length, 2));
  const spare = budget - base.reduce((a, b) => a + b, 0);
  const extra = segments.map((s, i) => s.length - base[i]);
  const extraTotal = extra.reduce((a, b) => a + b, 0);
  const alloc = segments.map((_, i) =>
    base[i] + (extraTotal > 0 ? Math.floor((Math.max(0, spare) * extra[i]) / extraTotal) : 0));

  const out: Point[] = [];
  segments.forEach((seg, i) => {
    if (i > 0) {
      const prev = segments[i - 1][segments[i - 1].length - 1];
      const marker = { t: (prev.t + seg[0].t) / 2 } as Point;
      for (const k of keys) (marker as Record<string, number | null>)[k] = null;
      out.push(marker);
    }
    out.push(...shrink(seg, alloc[i], keys));
  });
  return out;
}
