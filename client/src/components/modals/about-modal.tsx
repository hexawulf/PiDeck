import { Copy, Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { diagnosticsLine } from "@/lib/diagnostics";
import { PREFS_VERSION } from "@/prefs/prefs";
import { useUiPrefs } from "@/prefs/UiPrefsProvider";
import { WIDGETS } from "@/widgets/registry";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Injected by vite.config.ts from package.json; absent under vitest.
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;
const RELEASE_DATE = "September 2026";

function Diagnostics() {
  const prefs = useUiPrefs();
  const hidden = new Set(prefs.hidden);
  const line = diagnosticsLine({
    version: APP_VERSION,
    prefsVersion: PREFS_VERSION,
    visible: WIDGETS.filter((w) => !hidden.has(w.id)).length,
    total: WIDGETS.length,
    speed: prefs.speed,
    paused: prefs.paused,
    density: prefs.density,
    lastReset: prefs.lastReset,
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      toast({ title: "Diagnostics copied" });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the line and copy it by hand.", variant: "destructive" });
    }
  };
  return (
    <div>
      <h2 className="font-bold mb-1">Diagnostics</h2>
      <div className="flex items-start gap-2">
        <code data-testid="diagnostics-line" className="flex-1 select-all break-words rounded bg-pi-darker px-2 py-1 font-mono text-xs text-pi-text">
          {line}
        </code>
        <Button variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0 border-pi-border bg-transparent hover:bg-pi-card-hover" aria-label="Copy diagnostics" onClick={() => void copy()}>
          <Copy className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export default function AboutModal() {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="p-2 bg-transparent hover:bg-pi-card-hover border-pi-border"
              aria-label="About PiDeck"
            >
              <Info className="w-5 h-5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>About PiDeck</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="p-6 sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>About PiDeck</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <h2 className="font-bold mb-1">Tech Stack</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Backend: Node.js, Express.js, TypeScript</li>
              <li>Shell Integration: child_process</li>
              <li>Frontend: React 18, Vite, TypeScript</li>
              <li>Styling: TailwindCSS, Shadcn/ui</li>
              <li>State Management: TanStack Query, zod-validated widgets</li>
              <li>Charts: Recharts</li>
              <li>Routing: Wouter (deep-linkable tabs)</li>
              <li>Database: PostgreSQL + Drizzle ORM</li>
              <li>Auth: Session-based authentication</li>
            </ul>
          </div>
          <div>
            <h2 className="font-bold mb-1">Contact</h2>
            <p>Author: 0xWulf</p>
            <p>
              Email: <a href="mailto:dev@0xwulf.dev" className="underline">dev@0xwulf.dev</a>
            </p>
          </div>
          <div>
            <h2 className="font-bold mb-1">GitHub Repo</h2>
            <a
              href="https://github.com/hexawulf/PiDeck"
              className="underline break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://github.com/hexawulf/PiDeck
            </a>
          </div>
          <div>
            <p>Version: v{APP_VERSION}</p>
            <p>Release Date: {RELEASE_DATE}</p>
          </div>
          <Diagnostics />
        </div>
      </DialogContent>
    </Dialog>
  );
}
