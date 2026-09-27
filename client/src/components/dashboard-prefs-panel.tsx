import { useRef, useState } from "react";
import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { defaultPrefs, IMPORT_MAX_BYTES, parseImport, serializePrefs, type Density, type Speed } from "@/prefs/prefs";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { WIDGETS } from "@/widgets/registry";
import { WidgetVisibilityList } from "@/widgets/WidgetVisibilityList";

const DENSITIES: { id: Density; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];
const SPEEDS: { id: Speed; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "relaxed", label: "Relaxed (×2)" },
  { id: "slow", label: "Slow (×5)" },
];

const outline = "gap-1.5 border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover";

function RadioRow<T extends string>({ name, legend, options, value, onChange }: {
  name: string; legend: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={name} className="h-4 w-4 accent-[var(--pi-accent)]" checked={value === o.id} onChange={() => onChange(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Settings › Dashboard: density, speed, widgets, and prefs export/import/reset. */
export default function DashboardPrefsPanel() {
  const prefs = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const onExport = () => {
    const text = JSON.stringify(JSON.parse(serializePrefs(prefs)), null, 2); // never includes `paused`
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "pideck-prefs.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    const result =
      file.size > IMPORT_MAX_BYTES
        ? ({ ok: false, error: `File is larger than ${IMPORT_MAX_BYTES / 1024} KB` } as const)
        : parseImport(await file.text(), WIDGETS);
    if (fileInput.current) fileInput.current.value = "";
    if (!result.ok) {
      setImportError(result.error); // current prefs stay as they are
      return;
    }
    dispatch({ type: "replace", prefs: result.prefs });
    toast({ title: "Preferences imported" });
  };

  const onResetAll = () => {
    if (!window.confirm("Reset all dashboard preferences (layout, hidden widgets, density, refresh speed)?")) return;
    dispatch({ type: "replace", prefs: defaultPrefs(WIDGETS) });
    setImportError(null);
    toast({ title: "Dashboard preferences reset" });
  };

  return (
    <Card className="mx-auto w-full max-w-3xl border-pi-border bg-pi-card">
      <CardHeader>
        <h2 className="pi-text text-2xl font-semibold leading-none tracking-tight">Dashboard</h2>
        <CardDescription className="pi-text-muted">Saved in this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <RadioRow name="density" legend="Density" options={DENSITIES} value={prefs.density}
            onChange={(density) => dispatch({ type: "setDensity", density })} />
          <RadioRow name="speed" legend="Refresh speed" options={SPEEDS} value={prefs.speed}
            onChange={(speed) => dispatch({ type: "setSpeed", speed })} />
        </div>

        <section aria-labelledby="settings-widgets-title">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id="settings-widgets-title" className="text-sm font-medium">Widgets</h3>
            <Button variant="outline" size="sm" className={outline} onClick={() => dispatch({ type: "resetLayout" })}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset layout
            </Button>
          </div>
          <WidgetVisibilityList idPrefix="settings-vis" />
        </section>

        <section aria-labelledby="settings-backup-title" className="space-y-2">
          <h3 id="settings-backup-title" className="text-sm font-medium">Backup</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className={outline} onClick={onExport}>
              <Download className="h-4 w-4" aria-hidden /> Export
            </Button>
            <Button variant="outline" size="sm" className={outline} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden /> Import…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import preferences file"
              data-testid="prefs-import"
              onChange={(e) => void onImport(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" className={`${outline} text-pi-error`} onClick={onResetAll}>
              <Trash2 className="h-4 w-4" aria-hidden /> Reset all
            </Button>
          </div>
          {importError && (
            <p role="alert" className="text-sm text-pi-error">
              Import failed — {importError}. Your current settings are unchanged.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
