/**
 * Small fuzzy matcher for the palette: every query character must appear in
 * order. Higher score = better: word starts and consecutive runs count more,
 * earlier matches beat later ones. null = no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const wordStart = at === 0 || /[\s/_.:·-]/.test(t[at - 1]);
    score += 1 + (at === prev + 1 ? 3 : 0) + (wordStart ? 4 : 0) - Math.min(at - ti, 10) * 0.1;
    prev = at;
    ti = at + 1;
  }
  return score - t.length * 0.01; // shorter labels win ties
}

/** Filter + sort items by the best score over their searchable strings. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string[]): T[] {
  if (!query.trim()) return items.slice();
  return items
    .map((item, i) => {
      const scores = text(item).map((s) => fuzzyScore(query, s)).filter((s): s is number => s !== null);
      return { item, i, score: scores.length ? Math.max(...scores) : null };
    })
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score! || a.i - b.i)
    .map((r) => r.item);
}
