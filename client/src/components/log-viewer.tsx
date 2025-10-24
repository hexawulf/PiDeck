import { useState, useEffect, useRef, useMemo } from "react";
import { useSystemData } from "@/hooks/use-system-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  RefreshCw,
  Search,
  Play,
  Pause,
  AlertCircle,
  CheckCircle2,
  HardDrive,
  Server,
} from "lucide-react";
import type { HostLog, RpiLog } from "@shared/schema";

type LogType = "rpi" | "host";
type LogItem = (HostLog | RpiLog) & { type: LogType };

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
  const { hostLogs, rpiLogs } = useSystemData();
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [tailLines, setTailLines] = useState("1000");
  const [rpiSearchQuery, setRpiSearchQuery] = useState("");
  const [rpiSortBy, setRpiSortBy] = useState<"name" | "modified">("modified");
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load last selection from localStorage
  useEffect(() => {
    const lastCategory = localStorage.getItem("logViewer:lastCategory") as LogType | null;
    const lastId = localStorage.getItem("logViewer:lastId");

    if (lastCategory && lastId) {
      if (lastCategory === "rpi" && rpiLogs.data) {
        const log = rpiLogs.data.find((l) => l.id === lastId);
        if (log) {
          handleLogSelect({ ...log, type: "rpi" });
        }
      } else if (lastCategory === "host" && hostLogs.data) {
        const log = hostLogs.data.find((l) => l.id === lastId);
        if (log) {
          handleLogSelect({ ...log, type: "host" });
        }
      }
    }
  }, [rpiLogs.data, hostLogs.data]);

  // Filter and sort Raspberry Pi logs
  const filteredRpiLogs = useMemo(() => {
    let logs = rpiLogs.data || [];

    // Apply search filter
    if (rpiSearchQuery) {
      const query = rpiSearchQuery.toLowerCase();
      logs = logs.filter(
        (log) =>
          log.label.toLowerCase().includes(query) ||
          ("relPath" in log && log.relPath.toLowerCase().includes(query))
      );
    }

    // Apply sorting
    const sorted = [...logs].sort((a, b) => {
      if (rpiSortBy === "name") {
        return a.label.localeCompare(b.label);
      } else {
        // Sort by modified date (newest first)
        return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
      }
    });

    return sorted;
  }, [rpiLogs.data, rpiSearchQuery, rpiSortBy]);

  // Cleanup EventSource on unmount or when stopping follow
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

  const handleLogSelect = async (log: LogItem) => {
    // Stop any active following
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsFollowing(false);

    setSelectedLog(log);
    setLogContent([]);
    setError(null);

    // Save selection to localStorage
    localStorage.setItem("logViewer:lastCategory", log.type);
    localStorage.setItem("logViewer:lastId", log.id);

    if (!log.pathExists) {
      setError("Log file does not exist on the system");
      return;
    }

    // Check if file is too large (only for RpiLog)
    if ("tooLarge" in log && log.tooLarge) {
      setError("File >20 MiB – open directly over SSH instead.");
      return;
    }

    // Fetch initial content
    await fetchLogContent(log.id, log.type, false);
  };

  const fetchLogContent = async (logId: string, logType: LogType, follow: boolean) => {
    setIsLoading(true);
    setError(null);

    const apiEndpoint = logType === "rpi" ? "rasplogs" : "hostlogs";

    try {
      if (follow) {
        // Start SSE streaming
        const params = new URLSearchParams({
          follow: "1",
          tail: tailLines,
        });
        if (searchFilter) {
          params.append("grep", searchFilter);
        }

        const url = `/api/${apiEndpoint}/${logId}?${params.toString()}`;
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
        setIsLoading(false);
      } else {
        // Fetch snapshot
        const params = new URLSearchParams({
          tail: tailLines,
        });
        if (searchFilter) {
          params.append("grep", searchFilter);
        }

        const response = await fetch(`/api/${apiEndpoint}/${logId}?${params.toString()}`, {
          credentials: "include",
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to fetch log");
        }

        const data = await response.json();
        const lines = data.content.split("\n").filter((l: string) => l.trim());
        setLogContent(lines);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Error fetching log:", err);
      setError(err.message || "Failed to fetch log content");
      setIsLoading(false);
    }
  };

  const handleFollowToggle = () => {
    if (isFollowing) {
      // Stop following
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsFollowing(false);
    } else {
      // Start following
      if (selectedLog) {
        setLogContent([]); // Clear existing content
        fetchLogContent(selectedLog.id, selectedLog.type, true);
      }
    }
  };

  const handleRefresh = () => {
    if (selectedLog) {
      setLogContent([]);
      fetchLogContent(selectedLog.id, selectedLog.type, false);
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
        // Restart follow with new filters
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        fetchLogContent(selectedLog.id, selectedLog.type, true);
      } else {
        fetchLogContent(selectedLog.id, selectedLog.type, false);
      }
    }
  };

  if (hostLogs.isLoading || rpiLogs.isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
        <div className="lg:col-span-3">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const availableHostLogs = hostLogs.data?.filter((log) => log.pathExists) || [];
  const unavailableHostLogs = hostLogs.data?.filter((log) => !log.pathExists) || [];

  // Separate RpiLogs by size and availability
  const availableRpiLogs = filteredRpiLogs.filter((log) => log.pathExists && !log.tooLarge);
  const tooLargeRpiLogs = filteredRpiLogs.filter((log) => log.pathExists && log.tooLarge);
  const unavailableRpiLogs = filteredRpiLogs.filter((log) => !log.pathExists);

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format modified time
  const formatMtime = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Left sidebar - Log lists */}
      <div className="lg:col-span-1 space-y-4">
        {/* Raspberry Pi Logs Card */}
        <Card className="bg-pi-card border-pi-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-pi-accent" />
              <div>
                <CardTitle className="text-lg">Raspberry Pi Logs</CardTitle>
                <p className="text-xs text-pi-text-muted mt-1">/home/zk/logs</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Search and sort controls */}
            <div className="space-y-2 mb-3">
              <Input
                placeholder="Search..."
                value={rpiSearchQuery}
                onChange={(e) => setRpiSearchQuery(e.target.value)}
                className="h-8 text-sm"
              />
              <select
                value={rpiSortBy}
                onChange={(e) => setRpiSortBy(e.target.value as "name" | "modified")}
                className="w-full h-8 px-2 text-sm rounded-md bg-pi-card-hover border border-pi-border text-pi-text"
              >
                <option value="modified">Sort: Modified</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>

            {availableRpiLogs.length === 0 && tooLargeRpiLogs.length === 0 && unavailableRpiLogs.length === 0 && (
              <p className="text-sm text-pi-text-muted">No log files found</p>
            )}

            {/* Available RPI logs */}
            {availableRpiLogs.map((log) => (
              <button
                key={log.id}
                onClick={() => handleLogSelect({ ...log, type: "rpi" })}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  selectedLog?.id === log.id && selectedLog?.type === "rpi"
                    ? "bg-pi-accent text-white"
                    : "bg-pi-card-hover hover:bg-pi-border text-pi-text"
                }`}
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{log.label}</div>
                    <div className="text-xs text-pi-text-muted mt-0.5 flex justify-between">
                      <span>{formatSize(log.size)}</span>
                      <span>{formatMtime(log.mtime)}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}

            {/* Too large RPI logs */}
            {tooLargeRpiLogs.length > 0 && (
              <>
                {availableRpiLogs.length > 0 && <div className="border-t border-pi-border my-2" />}
                <p className="text-xs text-pi-text-muted mb-2">Too Large (&gt;20 MiB)</p>
                {tooLargeRpiLogs.map((log) => (
                  <button
                    key={log.id}
                    onClick={() => handleLogSelect({ ...log, type: "rpi" })}
                    className="w-full text-left px-3 py-2 rounded-lg opacity-60 bg-pi-card-hover"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate text-pi-text-muted">
                          {log.label}
                        </div>
                        <div className="text-xs text-pi-text-muted mt-0.5">
                          {formatSize(log.size)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* System Logs Card */}
        <Card className="bg-pi-card border-pi-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-pi-accent" />
              <CardTitle className="text-lg">System Logs</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {availableHostLogs.length === 0 && unavailableHostLogs.length === 0 && (
              <p className="text-sm text-pi-text-muted">No logs configured</p>
            )}

            {/* Available host logs */}
            {availableHostLogs.map((log) => (
              <button
                key={log.id}
                onClick={() => handleLogSelect({ ...log, type: "host" })}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  selectedLog?.id === log.id && selectedLog?.type === "host"
                    ? "bg-pi-accent text-white"
                    : "bg-pi-card-hover hover:bg-pi-border text-pi-text"
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{log.label}</div>
                  </div>
                </div>
              </button>
            ))}

            {/* Unavailable host logs */}
            {unavailableHostLogs.length > 0 && (
              <>
                {availableHostLogs.length > 0 && <div className="border-t border-pi-border my-2" />}
                <p className="text-xs text-pi-text-muted mb-2">Unavailable</p>
                {unavailableHostLogs.map((log) => (
                  <button
                    key={log.id}
                    onClick={() => handleLogSelect({ ...log, type: "host" })}
                    disabled
                    className="w-full text-left px-3 py-2 rounded-lg opacity-50 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-gray-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate text-pi-text-muted">
                          {log.label}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right panel - Log viewer */}
      <div className="lg:col-span-3">
        <Card className="bg-pi-card border-pi-border">
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {selectedLog ? selectedLog.label : "Select a log to view"}
                </CardTitle>
                {selectedLog && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFollowToggle}
                      disabled={isLoading}
                    >
                      {isFollowing ? (
                        <>
                          <Pause className="h-4 w-4 mr-1" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1" />
                          Follow
                        </>
                      )}
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

              {isFollowing && (
                <Badge variant="outline" className="w-fit">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    Live following
                  </div>
                </Badge>
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
