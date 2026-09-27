import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";

import Login from "@/pages/login";
import AppShell, { isTabId } from "@/components/app-shell";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-pi-dark flex items-center justify-center">
        <div className="pi-text">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
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

      {/* One route for every tab, so the shell stays mounted across tabs */}
      <Route path="/:tab">
        {(params) =>
          isTabId(params.tab) ? (
            <ProtectedRoute>
              <AppShell tab={params.tab} />
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
