import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSystemData } from "@/hooks/use-system-data";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import SystemOverview from "@/components/system-overview";
import LogViewer from "@/components/log-viewer";
import AppMonitor from "@/components/app-monitor";
import CronManager from "@/components/cron-manager";
import { 
  Server, 
  Sun, 
  Moon, 
  RefreshCw, 
  LogOut,
  Activity,
  FileText,
  Grid,
  Clock
} from "lucide-react";

type Tab = "dashboard" | "logs" | "apps" | "cron";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const { logout, isLogoutPending } = useAuth();
  const { systemInfo, refreshAll } = useSystemData();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    await logout();
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const tabs = [
    { id: "dashboard" as Tab, label: "Dashboard", icon: Activity },
    { id: "logs" as Tab, label: "Logs", icon: FileText },
    { id: "apps" as Tab, label: "Apps", icon: Grid },
    { id: "cron" as Tab, label: "Cron", icon: Clock },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <SystemOverview />;
      case "logs":
        return <LogViewer />;
      case "apps":
        return <AppMonitor />;
      case "cron":
        return <CronManager />;
      default:
        return <SystemOverview />;
    }
  };

  return (
    <div className="min-h-screen bg-pi-dark">
      {/* Header */}
      <header className="bg-pi-card border-b border-pi-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Title */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-pi-accent rounded-lg flex items-center justify-center">
                <Server className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold pi-text">PiDeck</h1>
                <p className="text-sm pi-text-muted">Raspberry Pi Admin</p>
              </div>
            </div>

            {/* Status Indicators */}
            <div className="hidden md:flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-pi-success rounded-full animate-pulse" />
                <span className="text-sm pi-text-muted">System Online</span>
              </div>
              {systemInfo.data?.uptime && (
                <div className="text-sm pi-text-muted">
                  Uptime: {systemInfo.data.uptime}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-3">
              {/* Theme Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
                className="p-2 bg-transparent hover:bg-pi-card-hover border-pi-border"
              >
                {theme === "dark" ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </Button>
              
              {/* Refresh */}
              <Button
                variant="outline"
                size="sm"
                onClick={refreshAll}
                className="p-2 bg-transparent hover:bg-pi-card-hover border-pi-border"
                disabled={systemInfo.isLoading}
              >
                <RefreshCw className={`w-5 h-5 ${systemInfo.isLoading ? 'animate-spin' : ''}`} />
              </Button>
              
              {/* Logout */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                disabled={isLogoutPending}
                className="p-2 bg-transparent hover:bg-pi-card-hover border-pi-border text-pi-error hover:text-pi-error"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="mb-8">
          <nav className="flex space-x-1 bg-pi-card rounded-xl p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-button flex items-center space-x-2 ${
                    activeTab === tab.id ? 'active' : ''
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
