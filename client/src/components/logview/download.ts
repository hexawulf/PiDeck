// Saving the log lines on screen as a file (2.6.1). Client-side only: the
// lines are exactly what the viewer shows (remote ones already redacted and
// filtered by the agent), so nothing new leaves any host.

/** File-name safe: lowercase, [a-z0-9._-] only, no leading/trailing dashes, never empty. */
export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return out.slice(0, 60) || "log";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `<host>-<source>-YYYYMMDD-HHMM.log` in the viewer's local time. */
export function logFileName(host: string, source: string, at: Date = new Date()): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${slug(host)}-${slug(source)}-${stamp}.log`;
}

/** One line per entry, newline-terminated (POSIX text file). */
export function logFileText(lines: readonly string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Hand the browser a file to save. */
export function saveLines(lines: readonly string[], fileName: string): void {
  const url = URL.createObjectURL(new Blob([logFileText(lines)], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the click has been handled (immediate revoke can cancel the download in some browsers)
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
