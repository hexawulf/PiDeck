import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHost, useHosts, type HostSummary } from "@/hosts/HostProvider";
import { formatLastSeen, hostHref, REMOTE_TABS } from "@/hosts/host-path";

/** `g h` and the palette open the switcher through this window event. */
export const OPEN_HOST_SWITCHER = "pideck:open-host-switcher";

const DOT: Record<HostSummary["status"], string> = {
  online: "bg-pi-success",
  offline: "bg-pi-text-muted",
  "auth-error": "bg-pi-error",
  "version-mismatch": "bg-pi-warning",
};

/** Screen-reader and tooltip text for a host's status. */
export function hostStatusText(h: HostSummary, hubVersion?: string | null): string {
  switch (h.status) {
    case "online":
      return "online";
    case "offline":
      return `offline, last seen ${formatLastSeen(h.lastSeen)}`;
    case "auth-error":
      return "can't authenticate — check its token";
    case "version-mismatch":
      return `version mismatch — update the agent (agent ${h.version ?? "?"}${hubVersion ? `, hub ${hubVersion}` : ""})`;
  }
}

export function StatusDot({ host, hubVersion }: { host: HostSummary; hubVersion?: string | null }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[host.status])}
      title={hostStatusText(host, hubVersion)}
      aria-hidden
      data-status={host.status}
    />
  );
}

/** The tab to open on another host: the same tab when it has it, else its dashboard. */
export function tabOnHost(currentTab: string, hostId: string): string {
  return hostId === "local" || (REMOTE_TABS as readonly string[]).includes(currentTab) ? currentTab : "dashboard";
}

/**
 * Header host switcher (plan › UI): a disclosure button listing every host
 * with a status dot. Rendered only when the hub has remote hosts.
 * Keyboard: Enter/Space open, ↑/↓ move, Esc closes and returns focus.
 */
export function HostSwitcher({ tab }: { tab: string }) {
  const host = useHost();
  const { data: hosts } = useHosts();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-current="true"], a')?.focus());
    };
    window.addEventListener(OPEN_HOST_SWITCHER, onOpen);
    return () => window.removeEventListener(OPEN_HOST_SWITCHER, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!hosts || hosts.length < 2) return null;
  const current = hosts.find((h) => h.id === host.id);
  const hubVersion = hosts.find((h) => h.local)?.version;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const links = Array.from(list.current?.querySelectorAll<HTMLElement>("a") ?? []);
    const i = links.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
    links[i < 0 ? 0 : next]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown} data-testid="host-switcher">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Host: ${current?.label ?? host.id}, ${current ? hostStatusText(current, hubVersion) : "unknown"}. Switch host`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 max-w-[9rem] items-center gap-2 rounded-md border border-pi-border px-2 text-sm text-pi-text hover:bg-pi-card-hover sm:max-w-[14rem]"
      >
        {current && <StatusDot host={current} hubVersion={hubVersion} />}
        <span className="truncate">{current?.label ?? host.id}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-pi-text-muted" aria-hidden />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          aria-label="Hosts"
          className="absolute left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-pi-border bg-pi-card py-1 text-sm text-pi-text shadow-lg"
        >
          {hosts.map((h) => {
            const isCurrent = h.id === host.id;
            return (
              <li key={h.id}>
                <Link
                  href={hostHref(h.id, tabOnHost(tab, h.id))}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    navigate(hostHref(h.id, tabOnHost(tab, h.id)));
                    button.current?.focus();
                  }}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-pi-card-hover focus:bg-pi-card-hover focus:outline-none"
                  data-host={h.id}
                >
                  <StatusDot host={h} hubVersion={hubVersion} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.label}{h.local && <span className="text-pi-text-muted"> · this hub</span>}</span>
                    <span className="block truncate text-xs text-pi-text-muted">{hostStatusText(h, hubVersion)}</span>
                  </span>
                  {isCurrent && <Check className="h-4 w-4 shrink-0 text-pi-accent-text" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
