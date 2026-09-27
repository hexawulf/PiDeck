import DashboardPrefsPanel from "@/components/dashboard-prefs-panel";
import SettingsPanel from "@/components/settings-panel";

export default function Settings() {
  return (
    <div className="space-y-8">
      <DashboardPrefsPanel />
      <SettingsPanel />
    </div>
  );
}
