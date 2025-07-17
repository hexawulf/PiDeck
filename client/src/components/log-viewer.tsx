import { useState, useEffect, useRef, useMemo } from "react";
import { useSystemData, useLogContent } from "@/hooks/use-system-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // Import Input component
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Folder, 
  FileText, 
  Download, 
  Trash2, 
  RefreshCw,
  SearchIcon // Import SearchIcon
} from "lucide-react";

// Regex patterns for syntax highlighting
const TIMESTAMP_REGEX = /(\b[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(\s+[A-Z]{3,4})?\s+\d{4}\b)/g;
const IP_ADDRESS_REGEX = /(\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/g;
const LOG_LEVEL_REGEX = /(\b(ERROR|WARN|INFO|DEBUG|SUCCESS)\b)/gi;

interface LogLineHighlighterProps {
  line: string;
}

const LogLineHighlighter: React.FC<LogLineHighlighterProps> = ({ line }) => {
  if (!line.trim()) {
    return <>{'\u00A0'}</>; // Non-breaking space for empty lines
  }

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  // Combine all regexes for a multi-pattern search approach
  // This is a simplified approach; a more robust solution might parse tokens
  const combinedRegex = new RegExp(`(${TIMESTAMP_REGEX.source})|(${IP_ADDRESS_REGEX.source})|(${LOG_LEVEL_REGEX.source})`, 'g');

  while ((match = combinedRegex.exec(line)) !== null) {
    const startIndex = match.index;
    const matchedText = match[0];

    // Add text before the match
    if (startIndex > lastIndex) {
      parts.push(line.substring(lastIndex, startIndex));
    }

    // Determine match type and apply styling
    if (match[1]) { // Timestamp match (Group 1 from combinedRegex, which is TIMESTAMP_REGEX.source)
      parts.push(<span key={lastIndex} className="text-cyan-400">{matchedText}</span>);
    } else if (match[3]) { // IP Address match (Group 3 from combinedRegex, which is IP_ADDRESS_REGEX.source)
      parts.push(<span key={lastIndex} className="text-orange-400">{matchedText}</span>);
    } else if (match[5]) { // Log Level match (Group 5 from combinedRegex, which is LOG_LEVEL_REGEX.source)
      let levelClass = "text-blue-400"; // Default for INFO/DEBUG
      if (matchedText.toUpperCase() === "ERROR") levelClass = "font-bold"; // Use existing line color for error
      else if (matchedText.toUpperCase() === "WARN") levelClass = "font-bold"; // Use existing line color for warn
      else if (matchedText.toUpperCase() === "SUCCESS") levelClass = "font-bold"; // Use existing line color for success
      parts.push(<span key={lastIndex} className={levelClass}>{matchedText}</span>);
    } else {
      parts.push(matchedText); // Should not happen with current regex structure
    }

    lastIndex = combinedRegex.lastIndex;
  }

  // Add remaining text after the last match
  if (lastIndex < line.length) {
    parts.push(line.substring(lastIndex));
  }

  return <>{parts}</>;
};

export default function LogViewer() {
  const { logFiles: logFilesQuery } = useSystemData();
  const [logList, setLogList] = useState<{ filename: string; content: string; modified: Date; size: number }[]>([]);
  const [selectedLogContent, setSelectedLogContent] = useState<string>("");
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');

  useEffect(() => {
    const fetchLogContents = async () => {
      if (logFilesQuery.data) {
        const promises = logFilesQuery.data.map(async (logFile) => {
          const res = await fetch(`/api/logs/${encodeURIComponent(logFile.name)}`);
          const data = await res.json();
          return {
            filename: logFile.name,
            content: data.content,
            modified: new Date(),
            size: data.content.length
          };
        });
        const allLogs = await Promise.all(promises);
        setLogList(allLogs);
      }
    };
    fetchLogContents();
  }, [logFilesQuery.data]);

  const handleLogClick = (filename: string) => {
    const log = logList.find((l) => l.filename === filename);
    if (log) {
      setSelectedLogContent(log.content);
    }
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  };

  const sortedLogList = [...logList].sort((a, b) => {
    if (sortBy === 'name') {
      return a.filename.localeCompare(b.filename);
    }
    if (sortBy === 'date') {
      return new Date(b.modified).getTime() - new Date(a.modified).getTime(); // newest first
    }
    if (sortBy === 'size') {
      return (b.size || 0) - (a.size || 0); // largest first
    }
    return 0;
  });

  if (logFilesQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <Card className="bg-pi-card border-pi-border">
            <CardContent className="p-6">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-3">
          <Card className="bg-pi-card border-pi-border">
            <CardContent className="p-4">
              <Skeleton className="h-96 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Left Log List */}
      <div className="w-1/4 max-h-[600px] overflow-y-auto custom-scrollbar pi-card rounded-xl p-2 space-y-2">
        <div className="flex justify-between items-center mb-2 px-2">
          <span className="text-sm font-semibold text-pi-text-muted">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'size')}
            className="bg-[var(--pi-card)] text-[var(--pi-text)] border border-[var(--pi-border)] px-2 py-1 rounded-md text-sm focus:outline-none"
          >
            <option value="name">Name</option>
            <option value="date">Date</option>
            <option value="size">Size</option>
          </select>
        </div>
        {sortedLogList.map((log) => (
          <div key={log.filename} className="flex justify-between items-center hover:bg-pi-card-hover px-2 py-1 rounded">
            <span
              onClick={() => handleLogClick(log.filename)}
              className="cursor-pointer hover:underline text-sm text-pi-text"
            >
              {log.filename}
            </span>
            <button
              onClick={() => handleDownload(log.filename, log.content)}
              className="text-xs text-pi-text-muted hover:text-pi-accent"
              title="Download log"
            >
              ⬇
            </button>
          </div>
        ))}
      </div>

      {/* Right Log Preview */}
      <div className="w-3/4 pi-card rounded-xl p-4 max-h-[600px] overflow-auto">
        <pre className="whitespace-pre-wrap break-words">{selectedLogContent || "Select a log to view."}</pre>
      </div>
    </div>
  );
}
