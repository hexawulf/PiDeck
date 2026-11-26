// Strip ANSI escape sequences and C0/C1/Unicode line-separator control
// characters from untrusted values before interpolating them into log lines.

// eslint-disable-next-line no-control-regex -- intentionally matches ANSI escape sequences
const ANSI_ESCAPE_RE = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex -- intentionally matches C0/C1 and line/paragraph separators
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function sanitizeLogValue(value: unknown, maxLen = 200): string {
  return String(value ?? "")
    .replace(ANSI_ESCAPE_RE, "")
    .replace(CONTROL_CHARS_RE, " ")
    .slice(0, maxLen);
}
