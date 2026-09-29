// Redaction for remote logs (docs/plans/multi-host-h3.md › Track B). Runs on
// the agent, before a line leaves the host, and before the filter (so a
// filter can't be used to probe a secret's value). Always on.
//
//   Authorization: <anything to end of line>    → Authorization: [REDACTED]
//   Bearer <token>                              → Bearer [REDACTED]
//   <…password|passwd|token|secret|api_key> = / : <value>   (incl. JSON "key": "value")
//                                               → key=[REDACTED]
//   scheme://user:pass@host                     → scheme://user:[REDACTED]@host
//
// Deliberately *not* matched (tests/unit/redact.test.ts): "Failed password
// for root" (no value), max_tokens=512 / token_count: 3 (the key doesn't
// end in a secret word), tokenizer=…, "secret: false|true|null" style flags.

export const REDACTED = "[REDACTED]";

type Rule = { name: string; re: RegExp; replace: (...m: string[]) => string };

// Values we never treat as secrets (flags and placeholders).
const HARMLESS = /^(true|false|null|none|nil|undefined|yes|no|on|off|\*+|x+|\[redacted\]|<redacted>|redacted|\$\{?[a-z_][a-z0-9_]*\}?|%s)$/i;

const RULES: Rule[] = [
  {
    // The whole header value (scheme + credentials), whatever the scheme.
    name: "authorization-header",
    re: /\b((?:proxy-)?authorization)(["']?\s*[:=]\s*["']?)([^\r\n"']+)/gi,
    replace: (_m, key, sep) => `${key}${sep}${REDACTED}`,
  },
  {
    name: "bearer",
    re: /\b(bearer)(\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
    replace: (_m, word, sp) => `${word}${sp}${REDACTED}`,
  },
  {
    name: "url-credentials",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`,
  },
  {
    // key (ending in a secret word) = or : value; the key may be quoted (JSON),
    // and a quoted value is redacted up to its closing quote (spaces included).
    name: "key-value",
    re: /\b([A-Za-z0-9_.-]*(?:password|passwd|passphrase|token|secret|api[_-]?key))(["']?\s*[=:]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;&}\[\]]+)/gi,
    replace: (m, key, sep, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
      const inner = quote ? value.slice(1, -1) : value;
      return inner === "" || HARMLESS.test(inner) ? m : `${key}${sep}${quote}${REDACTED}${quote}`;
    },
  },
];

export type Redacted = { text: string; count: number };

/** Redact one line. `count` = how many spans were replaced. */
export function redactLine(line: string): Redacted {
  let count = 0;
  let text = line;
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const groups = args.slice(0, -2).map(String) as string[];
      const out = rule.replace(...groups);
      if (out !== groups[0]) count++;
      return out;
    });
  }
  return { text, count };
}

export const REDACTION_RULES = RULES.map((r) => r.name);
