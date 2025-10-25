import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Download,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  HardDrive,
} from "lucide-react";

interface LogEntry {
  id: string;
  name: string;
  label: string;
}

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

  const combinedRegex = new RegExp(
    `(${TIMESTAMP_REGEX.source})|(${IP_ADDRESS_REGEX.source})|(${LOG_LEVEL_REGEX.source})`,
    'g'
  );

  while ((match = combinedRegex.exec(line)) !== null) {
    const startIndex = match.index;
    const matchedText = match[0];

    if (startIndex > lastIndex) {
      parts.push(line.substring(lastIndex, startIndex));
    }

    if (match[1]) {
      parts.push(<span key={lastIndex} className="text-cyan-400">{matchedText}</span>);
    } else if (match[3]) {
      parts.push(<span key={lastIndex} className="text-orange-400">{matchedText}</span>);
    } else if (match[5]) {
      let levelClass = "text-blue-400";
      if (matchedText.toUpperCase() === "ERROR") levelClass = "text-red-500 font-bold";
      else if (matchedText.toUpperCase() === "WARN") levelClass = "text-yellow-500 font-bold";
      else if (matchedText.toUpperCase() === "SUCCESS") levelClass = "text-green-500 font-bold";
      parts.push(<span key={lastIndex} className={levelClass}>{matchedText}</span>);
    } else {
      parts.push(matchedText);
    }

    lastIndex = combinedRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.substring(lastIndex));
  }

  return <>{parts}</>;
};

export default function LogViewer() {
  // Fixed allowlist of log files
  const logAllowlist = [
    { id: 'nginx_access', name: 'nginx_access', label: 'Nginx Access Log' },
    { id: 'nginx_error', name: 'nginx_error', label: 'Nginx Error Log' },
    { id: 'pm2_pideck_out', name: 'pm2_pideck_out', label: 'PM2 PiDeck Output' },
    { id: 'pm2_pideck_err', name: 'pm2_pideck_err', label: 'PM2 PiDeck Error' },
    { id: 'pideck_cron', name: 'pideck_cron', label: 'PiDeck Cron' },
    { id: 'codepatchwork', name: 'codepatchwork', label: 'CodePatchwork' },
    { id: 'synology', name: 'synology', label: 'Synology' }
  ];

  const logs = logAllowlist;
  const isLoadingLogs = false;
  const logsError = null;

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [tailLines, setTailLines] = useState("1000");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "modified">("modified");
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load last selection from localStorage
  useEffect(() => {
    const lastId = localStorage.getItem("logViewer:lastId");

    if (lastId && logs) {
      const log = logs.find((l) => l.id === lastId);
      if (log) {
        handleLogSelect(log);
      }
    }
  }, [logs]);

  // Filter and sort logs
  const filteredLogs = useMemo(() => {
    let logData = logs || [];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      logData = logData.filter(
        (log) =>
          log.name.toLowerCase().includes(query) ||
          log.label.toLowerCase().includes(query)
      );
    }

    const sorted = [...logData].sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      } else {
        return a.label.localeCompare(b.label);
      }
    });

    return sorted;
  }, [logs, searchQuery, sortBy]);

  // Cleanup EventSource
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Auto-scroll when following
  useEffect(() => {
    if (isFollowing && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logContent, isFollowing]);

  const handleLogSelect = async (log: LogEntry) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsFollowing(false);
    setSelectedLog(log);
    setLogContent([]);
    setError(null);
    localStorage.setItem("logViewer:lastId", log.id);

    await fetchLogContent(log.id, false);
  };

  const fetchLogContent = async (logId: string, follow: boolean) => {
    setIsLoading(true);
    setError(null);

    try {
      if (follow) {
        const params = new URLSearchParams({
          follow: "1",
          tail: tailLines,
        });
        if (searchFilter) {
          params.append("grep", searchFilter);
        }

        const url = `/api/hostlogs/${logId}?${params.toString()}`;
        const eventSource = new EventSource(url, { withCredentials: true });

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.line) {
            setLogContent((prev) => [...prev, data.line]);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE error:", err);
          setError("Connection lost. Click Follow to reconnect.");
          setIsFollowing(false);
          eventSource.close();
        };

        eventSourceRef.current = eventSource;
        setIsFollowing(true);
      } else {
        const params = new URLSearchParams({ tail: tailLines });
        if (searchFilter) {
          params.append("grep", searchFilter);
        }

        const response = await fetch(`/api/hostlogs/${logId}?${params.toString()}`, {
          credentials: "include",
        });

        if (!response.ok) {
          const msg = await response.text(); // keep it robust
          throw new Error(`HTTP ${response.status}: ${msg}`);
        }

        const text = await response.text();           // << text, not JSON
        const lines = text ? text.split("\n").filter((l: string) => l.trim()) : [];
        setLogContent(lines);
      }
  } catch (err) {
    console.error("Error fetching log:", err);
    setError(err instanceof Error ? err.message : "Failed to fetch log content");
  } finally {
      setIsLoading(false);
    }
  };

  const handleFollowToggle = () => {
    if (isFollowing) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsFollowing(false);
    } else if (selectedLog) {
      setLogContent([]);
      fetchLogContent(selectedLog.id, true);
    }
  };

  const handleRefresh = () => {
    if (selectedLog) {
      setLogContent([]);
      fetchLogContent(selectedLog.id, false);
    }
  };

  const handleDownload = () => {
    if (!selectedLog || logContent.length === 0) return;
    const blob = new Blob([logContent.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedLog.id}_${new Date().toISOString()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyFilters = () => {
    if (selectedLog) {
      setLogContent([]);
      if (isFollowing) {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        fetchLogContent(selectedLog.id, true);
      } else {
        fetchLogContent(selectedLog.id, false);
      }
    }
  };



  if (isLoadingLogs) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <Skeleton className="h-[calc(100vh-8rem)] w-full" />
        </div>
        <div className="lg:col-span-3">
          <Skeleton className="h-[calc(100vh-8rem)] w-full" />
        </div>
      </div>
    );
  }

  if (logsError) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">{logsError}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1">
        <Card className="bg-pi-card border-pi-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-pi-accent" />
               <div>
                 <CardTitle className="text-lg">Raspberry Pi Logs</CardTitle>
                 <p className="text-xs text-pi-text-muted mt-1">System and application logs</p>
               </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-2 mb-3">
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-sm"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "name" | "modified")}
                className="w-full h-8 px-2 text-sm rounded-md bg-pi-card-hover border border-pi-border text-pi-text"
              >
                <option value="modified">Sort: Modified</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>

            {filteredLogs.length === 0 ? (
              <p className="text-sm text-pi-text-muted">No log files found</p>
            ) : (
              filteredLogs.map((log) => (
                <button
                  key={log.id}
                  onClick={() => handleLogSelect(log)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selectedLog?.id === log.id
                      ? "bg-pi-accent text-white"
                      : "bg-pi-card-hover hover:bg-pi-border text-pi-text"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{log.name}</div>
                       <div className="text-xs text-pi-text-muted mt-0.5">
                         {log.label}
                       </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3">
        <Card className="bg-pi-card border-pi-border">
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {selectedLog ? selectedLog.name : "Select a log to view"}
                </CardTitle>
                {selectedLog && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFollowToggle}
                      disabled={isLoading}
                    >
                      {isFollowing ? "Stop" : "Follow"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRefresh}
                      disabled={isLoading || isFollowing}
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDownload}
                      disabled={logContent.length === 0}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {selectedLog && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Filter (grep)..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    placeholder="Lines"
                    value={tailLines}
                    onChange={(e) => setTailLines(e.target.value)}
                    className="w-24"
                    min="10"
                    max="5000"
                  />
                  <Button onClick={handleApplyFilters} disabled={isFollowing}>
                    <Search className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-black rounded-lg p-4 max-h-[600px] overflow-auto font-mono text-sm">
              {error && (
                <div className="text-red-500 mb-4 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {!selectedLog && !error && (
                <div className="text-gray-500 text-center py-20">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  Select a log from the list to view its contents
                </div>
              )}

              {selectedLog && !error && logContent.length === 0 && !isLoading && (
                <div className="text-gray-500 text-center py-20">
                  No log entries found
                </div>
              )}

              {isLoading && logContent.length === 0 && (
                <div className="text-gray-500 text-center py-20">
                  <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin" />
                  Loading...
                </div>
              )}

              {logContent.map((line, idx) => (
                <div key={idx} className="leading-relaxed text-gray-100">
                  <LogLineHighlighter line={line} />
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}