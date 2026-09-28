import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, FileText, Grid, KeySquare, LogOut, RefreshCw, Server, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import AboutModal from "@/components/modals/about-modal";
import { RefreshControl } from "@/components/refresh-control";
import { PaletteButton, useCommandCenter } from "@/components/command-center";
import { useAuth } from "@/hooks/use-auth";
import { useAlerts } from "@/hooks/use-alerts";
import { useRefreshAll } from "@/hooks/use-refresh-all";
import { useSystemInfo } from "@/hooks/use-system-info";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import Dashboard from "@/pages/dashboard";
import LogViewer from "@/components/log-viewer";
import AppMonitor from "@/components/app-monitor";
import CronManager from "@/components/cron-manager";
import Settings from "@/pages/settings";

export const TABS = [
  { id: "dashboard", label: "Dashboard", icon: Activity, component: Dashboard },
  { id: "logs", label: "Logs", icon: FileText, component: LogViewer },
  { id: "apps", label: "Apps", icon: Grid, component: AppMonitor },
  { id: "cron", label: "Cron", icon: Clock, component: CronManager },
  { id: "settings", label: "Settings", icon: SettingsIcon, component: Settings },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (s: string | undefined): s is TabId => TABS.some((t) => t.id === s);

/** Toast each new server alert once; forget alerts that cleared. */
function AlertToasts() {
  const { data: alerts } = useAlerts();
  const { toast } = useToast();
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!alerts) return;
    for (const alert of alerts) {
      if (shown.current.has(alert.id)) continue;
      toast({ title: "System Alert", description: alert.message, variant: "destructive", duration: 10000 });
      shown.current.add(alert.id);
    }
    const active = new Set(alerts.map((a) => a.id));
    for (const id of [...shown.current]) if (!active.has(id)) shown.current.delete(id);
  }, [alerts, toast]);

  return null;
}

const iconButton = "p-2 bg-transparent hover:bg-pi-card-hover border-pi-border";

/**
 * Header + tab links + the active tab. Mounted once under /:tab, so switching
 * tabs swaps only <main> and each tab's queries poll only while it is shown.
 */
export default function AppShell({ tab }: { tab: TabId }) {
  const { logout, isLogoutPending, user } = useAuth();
  const systemInfo = useSystemInfo();
  const refreshAll = useRefreshAll();
  const reboot = useQuery<{ rebootRequired?: boolean }>({ queryKey: ["/api/reboot-check"] });
  const commands = useCommandCenter();
  const current = TABS.find((t) => t.id === tab)!;
  const Page = current.component;

  useEffect(() => {
    document.title = tab === "dashboard" ? "PiDeck" : `${current.label} · PiDeck`;
  }, [tab, current.label]);

  return (
    <div className="min-h-screen bg-pi-dark">
      <AlertToasts />
      <header className="z-10 w-full bg-pi-dark px-4 py-3 text-pi-text shadow-md">
        <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* The tile is the visible logo link below sm, where the name is screen-reader only. */}
              <Link href="/dashboard" tabIndex={-1} aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pi-accent">
                <Server className="h-5 w-5 text-pi-on-accent" />
              </Link>
              <div>
                <h1 className="text-xl font-bold">
                  <Link href="/dashboard" className="pi-text hover:text-primary sr-only sm:not-sr-only">
                    PiDeck
                  </Link>
                </h1>
                <p className="hidden text-sm pi-text-muted sm:block">Raspberry Pi Admin</p>
              </div>
            </div>

            <div className="hidden items-center space-x-4 md:flex">
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-pi-success" />
                <span className="text-sm pi-text-muted">System Online</span>
              </div>
              {systemInfo.data?.uptime && <div className="text-sm pi-text-muted">Uptime: {systemInfo.data.uptime}</div>}
            </div>

            <div className="flex items-center space-x-2 sm:space-x-3">
              <PaletteButton onOpen={commands.openPalette} />
              <RefreshControl />
              <AboutModal />
              <ThemeToggle />
              {/* Below sm the header is full; the Settings tab has the same form. */}
              <span className="hidden sm:inline-flex">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className={iconButton} aria-label="Change password" asChild>
                      <Link href="/settings">
                        <KeySquare className="h-5 w-5" />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Change Password</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshAll()}
                className={iconButton}
                aria-label="Refresh"
                disabled={systemInfo.isFetching}
              >
                <RefreshCw className={cn("h-5 w-5", systemInfo.isFetching && "animate-spin")} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logout()}
                aria-label="Logout"
                className={iconButton}
                disabled={isLogoutPending}
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {user?.defaultPassword && (
        <div role="alert" className="mx-4 mt-4 rounded-xl border border-pi-warning px-4 py-2 text-center text-sm text-pi-text" data-testid="default-password-banner">
          The admin password is still the default (<code>admin</code>).{" "}
          <Link href="/settings" className="font-semibold underline">Change it in Settings</Link>.
        </div>
      )}
      {user?.transport?.insecureHttp && typeof window !== "undefined" && window.location.protocol === "http:" && (
        <div className="mx-4 mt-4 rounded-xl border border-pi-warning px-4 py-2 text-center text-sm text-pi-text" data-testid="insecure-http-banner">
          Plain HTTP mode: the session cookie is sent unencrypted. Use only on a trusted LAN (docs/INSTALL.md).
        </div>
      )}
      {reboot.data?.rebootRequired && (
        <div className="mx-4 mt-4 animate-pulse rounded-xl bg-red-700 px-4 py-2 text-center text-pi-on-accent shadow-lg">
          ⚠️ System reboot required to activate latest kernel updates
        </div>
      )}

      <main className="pt-16">
        <div className="mx-auto max-w-7xl px-4">
          <nav aria-label="Sections" className="mb-8 flex space-x-1 overflow-x-auto rounded-xl bg-pi-card p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <Link
                key={id}
                href={`/${id}`}
                aria-current={id === tab ? "page" : undefined}
                className={cn("tab-button flex items-center space-x-2", id === tab && "active")}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="tab-content pb-8">
            <Page />
          </div>
        </div>
      </main>
      {commands.dialogs}
    </div>
  );
}
