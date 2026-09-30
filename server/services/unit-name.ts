// systemd unit names as PiDeck accepts them from its own config (journal log
// sources, watched services) or from systemctl's output. One definition for
// both: a unit name that passes here is safe as a single argv element after
// "--" (no spaces, no shell, no leading "-").
export const UNIT_RE = /^[A-Za-z0-9@._:-]{1,120}$/;

export const isUnitName = (name: string) => UNIT_RE.test(name) && !name.startsWith("-");

/** "user:<unit>" → a user-manager unit; anything else is a system unit. */
export function parseUnitRef(item: string): { unit: string; user: boolean } | null {
  const user = item.startsWith("user:");
  const unit = user ? item.slice(5) : item;
  return isUnitName(unit) ? { unit, user } : null;
}
