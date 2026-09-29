import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logFileName, saveLines } from "@/components/logview/download";

/** Download the lines on screen (sits left of the pin in both log viewers). */
export function DownloadLogButton({ lines, host, source }: { lines: readonly string[]; host: string; source: string }) {
  const empty = lines.length === 0;
  const what = empty ? "Nothing to download" : `Download the ${lines.length} line${lines.length === 1 ? "" : "s"} shown`;
  return (
    <Button size="sm" variant="outline" aria-label={what} title={what} disabled={empty} data-testid="log-download"
      onClick={() => saveLines(lines, logFileName(host, source))}>
      <Download className="h-4 w-4" />
    </Button>
  );
}
