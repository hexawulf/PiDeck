// User-supplied log filters, validated before they reach grep or RegExp.
//
//   "text"   → literal, never an option or a regex
//   "/re/"   → JS RegExp, case-insensitive
//
// hostLogs runs the filter on the event loop, so regexes are length-capped
// and screened for nested quantifiers (catastrophic backtracking).

export const MAX_PATTERN_LENGTH = 200;
export const MAX_REGEX_LENGTH = 100;

export class LogFilterError extends Error {
  readonly status = 400;
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

const MAX_BOUNDED_REPEAT = 100;

/**
 * True if a regex is susceptible to catastrophic/polynomial backtracking:
 * - nested quantifiers on groups: (a+)+, (a*)*, (a|a)+, (.*)*, (a?)*, (?:x+){2,}
 * - backreferences (\1..\9, \k<name>) or lookarounds ((?=...), (?!...), (?<=...), (?<!...))
 * - excessive bounded repeats ({101,}, {0,999})
 * - 3+ unbounded quantifiers (*, +, {n,}), or 2 unbounded quantifiers that are
 *   not distinct single literal characters (blocks a+a+, .*.*, \w+\w+, etc. while
 *   still allowing harmless forms like a+b* and \(a+\)+).
 */
export function hasNestedQuantifier(source: string): boolean {
  const groups: boolean[] = []; // per open group: contains a quantifier or "|"?
  const unboundedAtoms: string[] = []; // literal char (lowercased) or "*" for non-literal
  let inClass = false;
  let lastAtom: string | null = null; // single literal char (lowercased) or "*" for class/wildcard/group

  const recordUnbounded = (atom: string | null) => {
    unboundedAtoms.push(atom ?? "*");
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      const next = source[i + 1];
      if (!next) break;
      if (!inClass) {
        // Backreferences (\1..\9 or \k<...>) can cause exponential backtracking
        if ((next >= "1" && next <= "9") || (next === "k" && source[i + 2] === "<")) {
          return true;
        }
        // Shorthand character classes (\d, \D, \w, \W, \s, \S) are non-literal atoms
        lastAtom = /[dDwWsS]/.test(next) ? "*" : next.toLowerCase();
      }
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") {
        inClass = false;
        lastAtom = "*";
      }
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      // Reject lookarounds (?=...), (?!...), (?<=...), (?<!...)
      if (source[i + 1] === "?" && (source[i + 2] === "=" || source[i + 2] === "!" || source[i + 2] === "<")) {
        const after = source[i + 2] === "<" ? source[i + 3] : source[i + 2];
        if (after === "=" || after === "!") return true;
      }
      groups.push(false);
      lastAtom = null;
      continue;
    }
    if (c === ")") {
      const risky = groups.pop() ?? false;
      const next = source[i + 1];
      if (risky && (next === "*" || next === "+" || next === "{")) return true;
      // a quantified or risky group makes its parent risky too
      if (groups.length && (risky || next === "*" || next === "+" || next === "{" || next === "?")) {
        groups[groups.length - 1] = true;
      }
      lastAtom = "*";
      continue;
    }
    if (c === "{") {
      const close = source.indexOf("}", i + 1);
      if (close !== -1) {
        const body = source.slice(i + 1, close);
        const m = /^(\d+)(?:,(\d*))?$/.exec(body);
        if (m) {
          const min = Number(m[1]);
          const hasComma = body.includes(",");
          const max = m[2] ? Number(m[2]) : undefined;
          if (min > MAX_BOUNDED_REPEAT || (max !== undefined && max > MAX_BOUNDED_REPEAT)) {
            return true;
          }
          if (hasComma && max === undefined) {
            recordUnbounded(lastAtom);
          }
          if (groups.length) groups[groups.length - 1] = true;
          i = close;
          lastAtom = null;
          continue;
        }
      }
    }
    const isUnbounded = c === "*" || c === "+";
    const quantifier = isUnbounded || c === "{" || (c === "?" && source[i - 1] !== "(");
    if (isUnbounded) {
      recordUnbounded(lastAtom);
      lastAtom = null;
    } else if (quantifier) {
      lastAtom = null;
    } else if (c === ".") {
      lastAtom = "*";
    } else if (c === "|" || c === "^" || c === "$") {
      lastAtom = null;
    } else {
      lastAtom = c.toLowerCase();
    }
    if (groups.length && (quantifier || c === "|")) {
      groups[groups.length - 1] = true;
    }
  }

  if (unboundedAtoms.length >= 3) return true;
  if (unboundedAtoms.length === 2) {
    const [a, b] = unboundedAtoms;
    if (a === "*" || b === "*" || a === b) return true;
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
