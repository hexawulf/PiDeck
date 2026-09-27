// User-supplied log filters, validated before they reach grep or RegExp.
//
//   "text"   → literal, never an option or a regex
//   "/re/"   → regex (rasplogs: grep BRE; hostLogs: JS RegExp, case-insensitive)
//
// rasplogs hands the pattern to grep after `-e` and ends options with `--`,
// so a leading "-" can't be read as a flag. hostLogs runs the filter on the
// event loop, so its regexes are also length-capped and screened for nested
// quantifiers (catastrophic backtracking).

export const MAX_PATTERN_LENGTH = 200;
export const MAX_REGEX_LENGTH = 100;

export class LogFilterError extends Error {
  readonly status = 400;
}

/** `?tail=` for rasplogs: 1..10000, default 1000 (unparseable or 0 → default). */
export function parseTail(value: unknown): number {
  return Math.max(1, Math.min(parseInt(String(value || "1000"), 10) || 1000, 10000));
}

type Pattern = { kind: "literal" | "regex"; source: string };

/** Validate a raw `?grep=` value. Returns null when there is no filter. */
export function parsePattern(raw: unknown): Pattern | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") throw new LogFilterError("grep must be a single string");
  if (/[\n\r\0]/.test(raw)) throw new LogFilterError("grep pattern must not contain newlines or NUL");
  const pattern = raw.trim();
  if (!pattern) return null;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new LogFilterError(`grep pattern too long (max ${MAX_PATTERN_LENGTH} chars)`);
  }
  if (pattern.length >= 3 && pattern.startsWith("/") && pattern.endsWith("/")) {
    return { kind: "regex", source: pattern.slice(1, -1) };
  }
  return { kind: "literal", source: pattern };
}

/**
 * grep arguments for a filter, without the file: fixed-string by default,
 * basic regex for /…/. The caller appends the file path (if any) after "--".
 */
export function grepArgs(raw: unknown): string[] | null {
  const p = parsePattern(raw);
  if (!p) return null;
  return p.kind === "literal" ? ["-F", "-e", p.source, "--"] : ["-e", p.source, "--"];
}

/**
 * True if a group that itself contains a quantifier or alternation is
 * quantified again: (a+)+, (a*)*, (a|a)+, (.*)*, (a?)*, (?:x+){2,}. Escapes and
 * character classes are skipped. Deliberately conservative: it also rejects
 * harmless forms like (foo|bar)+.
 */
export function hasNestedQuantifier(source: string): boolean {
  const groups: boolean[] = []; // per open group: contains a quantifier or "|"?
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "(") { groups.push(false); continue; }
    if (c === ")") {
      const risky = groups.pop() ?? false;
      const next = source[i + 1];
      if (risky && (next === "*" || next === "+" || next === "{")) return true;
      // a quantified or risky group makes its parent risky too
      if (groups.length && (risky || next === "*" || next === "+" || next === "{" || next === "?")) {
        groups[groups.length - 1] = true;
      }
      continue;
    }
    const quantifier = c === "*" || c === "+" || c === "{" || (c === "?" && source[i - 1] !== "(");
    if (groups.length && (quantifier || c === "|")) {
      groups[groups.length - 1] = true;
    }
  }
  return false;
}

/**
 * Line predicate for hostLogs: case-insensitive substring by default,
 * RegExp only for /…/ (≤100 chars, no nested quantifiers, must compile).
 */
export function lineFilter(raw: unknown): ((line: string) => boolean) | null {
  const p = parsePattern(raw);
  if (!p) return null;
  if (p.kind === "literal") {
    const q = p.source.toLowerCase();
    return (line) => line.toLowerCase().includes(q);
  }
  if (p.source.length > MAX_REGEX_LENGTH) {
    throw new LogFilterError(`regex too long (max ${MAX_REGEX_LENGTH} chars)`);
  }
  if (hasNestedQuantifier(p.source)) throw new LogFilterError("regex too complex");
  let rx: RegExp;
  try {
    rx = new RegExp(p.source, "i");
  } catch (err) {
    throw new LogFilterError(`invalid regex: ${(err as Error).message}`);
  }
  return (line) => rx.test(line);
}
