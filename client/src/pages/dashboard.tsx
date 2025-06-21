import { useState } from "react";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSystemData } from "@/hooks/use-system-data";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";
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
  Clock,
  SettingsIcon // Added SettingsIcon
} from "lucide-react";

// Forward ref for components used in tabs
import React from 'react'; // Already here, but good to note
import SettingsPanel from '@/components/settings-panel'; // Import the new component

type TabId = "dashboard" | "logs" | "apps" | "cron" | "settings";

interface TabDefinition {
  id: TabId;
  label: string;
  icon: React.ElementType; // Lucide icons are components
  component: React.ComponentType<any>; // The component to render for this tab
}


export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const { logout, isLogoutPending } = useAuth();
  const { systemInfo, systemAlerts, refreshAll, updateSystem, isSystemUpdating } = useSystemData();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const displayedAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (systemAlerts.data) {
      systemAlerts.data.forEach(alert => {
        if (!displayedAlertIds.current.has(alert.id)) {
          toast({
            title: "System Alert",
            description: alert.message,
            variant: "destructive", // Or a custom 'warning' variant if available/needed
            duration: 10000, // Show for 10 seconds
          });
          displayedAlertIds.current.add(alert.id);
        }
      });

      // Clean up old alert IDs from the ref if they are no longer active
      const activeAlertIds = new Set(systemAlerts.data.map(a => a.id));
      displayedAlertIds.current.forEach(id => {
        if (!activeAlertIds.has(id)) {
          displayedAlertIds.current.delete(id);
        }
      });
    }
  }, [systemAlerts.data, toast]);

  const handleLogout = async () => {
    await logout();
  };

  const handleUpdateSystem = async () => {
    try {
      await updateSystem();
      toast({ title: "Success", description: "System updated successfully" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update system",
        variant: "destructive",
      });
    }
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const tabs: TabDefinition[] = [
    { id: "dashboard", label: "Dashboard", icon: Activity, component: SystemOverview },
    { id: "logs", label: "Logs", icon: FileText, component: LogViewer },
    { id: "apps", label: "Apps", icon: Grid, component: AppMonitor },
    { id: "cron", label: "Cron", icon: Clock, component: CronManager },
    { id: "settings", label: "Settings", icon: SettingsIcon, component: SettingsPanel }, // Use actual SettingsPanel
  ];

  const renderTabContent = () => {
    const currentTab = tabs.find(tab => tab.id === activeTab);
    if (currentTab) {
      const TabComponent = currentTab.component;
      if (currentTab.id === 'dashboard') {
        return (
          <SystemOverview
            onOpenApps={() => setActiveTab('apps')}
            onOpenLogs={() => setActiveTab('logs')}
            onUpdateSystem={handleUpdateSystem}
            isSystemUpdating={isSystemUpdating}
          />
        );
      }
      return <TabComponent />;
    }
    // Fallback to dashboard if tab not found, though this shouldn't happen
    return (
      <SystemOverview
        onOpenApps={() => setActiveTab('apps')}
        onOpenLogs={() => setActiveTab('logs')}
        onUpdateSystem={handleUpdateSystem}
        isSystemUpdating={isSystemUpdating}
      />
    );
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
