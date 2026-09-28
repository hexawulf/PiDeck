// "This host can't provide that metric" — a normal 200 answer, not an error.
// Widgets render it calmly ("Not available on this host") instead of an
// error card. Shared by NVMe, power, thermal, firewall and pm2.
import fs from "fs";

export type UnavailableReason = "not-installed" | "no-device" | "needs-sudoers" | "not-supported";
export type Unavailable = { available: false; reason: UnavailableReason; message: string };

export const unavailable = (reason: UnavailableReason, message: string): Unavailable => ({ available: false, reason, message });

/**
 * Privileged commands run as `sudo -n …`: never prompt (there's no TTY), fail
 * at once when no NOPASSWD rule exists (scripts/install.sh --sudoers).
 */
export const SUDO = "sudo -n";

/** Classify a failed `sudo -n <tool>` / `<tool>` run. null = a real error. */
export function classifyCommandFailure(err: { code?: unknown; message?: string } | null, stderr = ""): UnavailableReason | null {
  const text = `${stderr}\n${err?.message ?? ""}`;
  if (/a password is required|a terminal is required|no tty present|not in the sudoers|is not allowed to execute|may not run sudo/i.test(text)) {
    return "needs-sudoers";
  }
  if (err?.code === 127 || err?.code === "ENOENT" || /command not found|not found$|No such file or directory/im.test(text)) {
    return "not-installed";
  }
  return null;
}

const TOOL_DIRS = ["/usr/sbin", "/usr/bin", "/sbin", "/bin", "/usr/local/sbin", "/usr/local/bin"];
/** Is an executable on the usual system paths? (PATH under pm2/systemd can be minimal.) */
export function hasTool(name: string, exists: (p: string) => boolean = fs.existsSync): boolean {
  return TOOL_DIRS.some((d) => exists(`${d}/${name}`));
}

const NVME_DEVICE_RE = /^\/dev\/nvme\d+(n\d+)?$/;
/**
 * NVMe device for smartctl: PIDECK_NVME_DEVICE if valid, else the first of
 * /dev/nvme0..3 that exists, else null. Validated because it goes into a
 * command line (and the sudoers rule names it exactly).
 */
export function nvmeDevice(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const configured = env.PIDECK_NVME_DEVICE?.trim();
  if (configured) return NVME_DEVICE_RE.test(configured) && exists(configured) ? configured : null;
  for (let i = 0; i < 4; i++) if (exists(`/dev/nvme${i}`)) return `/dev/nvme${i}`;
  return null;
}
export const isValidNvmeDevice = (d: string) => NVME_DEVICE_RE.test(d);

export const SUDOERS_HINT = "Needs a sudoers rule — run scripts/install.sh --sudoers (see docs/INSTALL.md).";
