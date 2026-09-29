import { Switch, Route, Redirect, Link } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";

import Login from "@/pages/login";
import AppShell, { isTabId } from "@/components/app-shell";
import NotFound from "@/pages/not-found";
import { UiPrefsProvider } from "@/prefs/UiPrefsProvider";
import { HostProvider, useHosts } from "@/hosts/HostProvider";
import { HOST_ID_RE, hostHref, isLocalHost, REMOTE_TABS } from "@/hosts/host-path";

function Loading() {
  return (
    <div className="min-h-screen bg-pi-dark flex items-center justify-center">
      <div className="pi-text">Loading...</div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

/** /h/<id>/… for an id the hub doesn't know (or can't list right now). */
function NoSuchHost({ hostId }: { hostId: string }) {
  return (
    <main className="min-h-screen bg-pi-dark flex items-center justify-center p-4">
      <div className="max-w-md rounded-lg border border-pi-border bg-pi-card p-6 text-center text-pi-text" data-testid="no-such-host">
        <h1 className="mb-2 text-lg font-semibold">No such host</h1>
        <p className="mb-4 text-sm text-pi-text-muted">
          This PiDeck has no host called “{hostId.slice(0, 40)}”. Hosts are configured on the hub (PIDECK_HOSTS in .env).
        </p>
        <Link href="/dashboard" className="font-semibold underline">Back to the dashboard</Link>
      </div>
    </main>
  );
}

/** A remote host's pages: only its known tabs, only hosts the hub has. */
function RemoteHost({ hostId, tab }: { hostId: string; tab: string }) {
  const hosts = useHosts();
  if (isLocalHost(hostId)) return <Redirect to={`/${isTabId(tab) ? tab : "dashboard"}`} replace />;
  if (!HOST_ID_RE.test(hostId)) return <NoSuchHost hostId={hostId} />;
  if (hosts.isPending) return <Loading />;
  if (!hosts.data?.some((h) => h.id === hostId && !h.local)) return <NoSuchHost hostId={hostId} />;
  if (!(REMOTE_TABS as readonly string[]).includes(tab)) return <Redirect to={hostHref(hostId, "dashboard")} replace />;
  return (
    <HostProvider hostId={hostId}>
      <UiPrefsProvider>
        <AppShell tab={tab as (typeof REMOTE_TABS)[number]} />
      </UiPrefsProvider>
    </HostProvider>
  );
}

// Renamed to avoid confusion with wouter's <Router>
function AppRoutes() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      <Route path="/">
        <Redirect to="/dashboard" replace />
      </Route>

      {/* Password change lives in Settings since 2.0 */}
      <Route path="/change-password">
        <Redirect to="/settings" replace />
      </Route>

      {/* Remote hosts (multi-host): /h/<host>/<tab> */}
      <Route path="/h/:hostId/:tab">
        {(params) => (
          <ProtectedRoute>
            <RemoteHost hostId={params.hostId} tab={params.tab} />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/h/:hostId">{(params) => <Redirect to={hostHref(params.hostId, "dashboard")} replace />}</Route>

      {/* The All hosts overview (H2): before /:tab, which would redirect it */}
      <Route path="/hosts">
        <ProtectedRoute>
          <UiPrefsProvider>
            <AppShell tab="hosts" />
          </UiPrefsProvider>
        </ProtectedRoute>
      </Route>

      {/* One route for every tab, so the shell stays mounted across tabs */}
      <Route path="/:tab">
        {(params) =>
          isTabId(params.tab) ? (
            <ProtectedRoute>
              <UiPrefsProvider>
                <AppShell tab={params.tab} />
              </UiPrefsProvider>
            </ProtectedRoute>
          ) : (
            <Redirect to="/dashboard" replace />
          )
        }
      </Route>

      {/* Catch-all */}
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AppRoutes />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
