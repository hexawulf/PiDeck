import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useHostLogs, type LogEntry } from "@/hooks/use-host-logs";
import { LogListItem } from "@/components/logview/log-list-item";
import { PinnedLogs } from "@/components/logview/pinned-logs";
import { DownloadLogButton } from "@/components/logview/download-log-button";
import { useHostSummary } from "@/hosts/HostProvider";
import { LOCAL_HOST } from "@/hosts/host-path";
import { markLogMissing, markLogPresent, useLogPins } from "@/hooks/use-log-pins";
import type { Pin as LogPin } from "@/prefs/prefs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  RefreshCw,
  Search,
  AlertCircle,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
  Terminal,
  FolderOpen,
  Pin,
  PinOff,
} from "lucide-react";


type DateFilter = "all" | "24h" | "7d" | "30d";

const CATEGORY_META: Record<string, { label: string; Icon: React.ElementType; accent: string }> = {
  nginx: { label: "Nginx", Icon: Globe, accent: "border-cyan-500" },
  pm2: { label: "PM2", Icon: Terminal, accent: "border-violet-500" },
  project: { label: "Project", Icon: FolderOpen, accent: "border-amber-500" },
  home: { label: "Home", Icon: HardDrive, accent: "border-emerald-500" },
};
const CATEGORY_ORDER = ["nginx", "pm2", "project", "home"];


// --- Syntax highlighting ------------------------------------------------

const TIMESTAMP_REGEX = /(\b[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(\s+[A-Z]{3,4})?\s+\d{4}\b)/g;
const IP_ADDRESS_REGEX = /(\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/g;
const LOG_LEVEL_REGEX = /(\b(ERROR|WARN|INFO|DEBUG|SUCCESS)\b)/gi;

const LogLineHighlighter: React.FC<{ line: string }> = ({ line }) => {
  if (!line.trim()) return <>{"\u00A0"}</>;

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  const combinedRegex = new RegExp(
    `(${TIMESTAMP_REGEX.source})|(${IP_ADDRESS_REGEX.source})|(${LOG_LEVEL_REGEX.source})`,
    "g"
  );

  let match;
  while ((match = combinedRegex.exec(line)) !== null) {
    if (match.index > lastIndex) parts.push(line.substring(lastIndex, match.index));

    if (match[1]) {
      parts.push(<span key={lastIndex} className="text-cyan-400">{match[0]}</span>); // theme-ok: terminal pane is dark in both themes
    } else if (match[3]) {
      parts.push(<span key={lastIndex} className="text-orange-400">{match[0]}</span>); // theme-ok: terminal pane is dark in both themes
    } else if (match[5]) {
      const upper = match[0].toUpperCase();
      const cls =
        upper === "ERROR" ? "text-red-500 font-bold" : // theme-ok: terminal pane is dark in both themes
        upper === "WARN" ? "text-yellow-500 font-bold" : // theme-ok: terminal pane is dark in both themes
        upper === "SUCCESS" ? "text-green-500 font-bold" : // theme-ok: terminal pane is dark in both themes
        "text-blue-400"; // theme-ok: terminal pane is dark in both themes
      parts.push(<span key={lastIndex} className={cls}>{match[0]}</span>);
    } else {
      parts.push(match[0]);
    }
    lastIndex = combinedRegex.lastIndex;
  }
  if (lastIndex < line.length) parts.push(line.substring(lastIndex));
  return <>{parts}</>;
};

// --- Main component ----------------------------------------------------

export default function LogViewer() {
  const logsQuery = useHostLogs();
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);
  const isLoadingLogs = logsQuery.isPending;
  const logsError = logsQuery.error?.message ?? null;
  const search = useSearch();
  const [, navigate] = useLocation();
  const { isPinned, pin, unpin } = useLogPins();
  const hubLabel = useHostSummary(LOCAL_HOST)?.label ?? LOCAL_HOST; // download file names
  // A log id that isn't in the list (stale pin, old link): open it anyway so the 404 shows.
  const entryFor = (id: string): LogEntry =>
    logs.find((l) => l.id === id) ?? { id, name: id, label: id, path: "", size: 0, mtime: "", source: "home" };
  const openPin = (p: LogPin) => {
    setSearchFilter(p.grep ?? "");
    void handleLogSelect(entryFor(p.logId), p.grep ?? "");
  };

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [logContent, setLogContent] = useState<string[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [tailLines, setTailLines] = useState("1000");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "modified">("modified");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem("logViewer:sidebarCollapsed") === "true"
  );
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(CATEGORY_ORDER)
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem("logViewer:sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Open ?log=<id>[&grep=…] (palette, pins), else restore the last selection.
  useEffect(() => {
    if (!logs.length) return;
    const params = new URLSearchParams(search);
    const wanted = params.get("log");
    if (wanted) {
      const grep = params.get("grep") ?? "";
      setSearchFilter(grep);
      handleLogSelect(entryFor(wanted), grep);
      navigate("/logs", { replace: true }); // consume the link so reload/back don't re-open it
      return;
    }
    const lastId = localStorage.getItem("logViewer:lastId");
    const log = lastId ? logs.find((l) => l.id === lastId) : undefined;
    if (log && !selectedLog) handleLogSelect(log);
  }, [logs, search]);

  // Cleanup EventSource
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Auto-scroll when following
  useEffect(() => {
    if (isFollowing && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logContent, isFollowing]);

  // --- Memos ---

  const groupedLogs = useMemo(() => {
    let data = logs || [];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.label || "").toLowerCase().includes(q)
      );
    }

    if (dateFilter !== "all") {
      const cutoffs: Record<string, number> = {
        "24h": 24 * 3600000,
        "7d": 7 * 24 * 3600000,
        "30d": 30 * 24 * 3600000,
      };
      const cutoff = Date.now() - cutoffs[dateFilter];
      data = data.filter((l) => new Date(l.mtime).getTime() >= cutoff);
    }

    const groups: Record<string, LogEntry[]> = {};
    for (const log of data) {
      const cat = log.source || "home";
      (groups[cat] ??= []).push(log);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) =>
        sortBy === "name"
          ? a.name.localeCompare(b.name)
          : new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
      );
    }
    return groups;
  }, [logs, searchQuery, dateFilter, sortBy]);

  const totalFiltered = useMemo(
    () => Object.values(groupedLogs).reduce((s: number, a: LogEntry[]) => s + a.length, 0),
    [groupedLogs]
  );

  // --- Handlers ---

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const handleLogSelect = async (log: LogEntry, grep = searchFilter) => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsFollowing(false);
    setSelectedLog(log);
    setLogContent([]);
    setError(null);
    localStorage.setItem("logViewer:lastId", log.id);
    await fetchLogContent(log.id, false, grep);
  };

  const fetchLogContent = async (logId: string, follow: boolean, grep = searchFilter) => {
    setIsLoading(true);
    setError(null);
    try {
      if (follow) {
        setError("Live tail functionality is not yet available with the new API");
        setIsFollowing(false);
      } else {
        const params = new URLSearchParams({ tail: tailLines });
        if (grep) params.append("grep", grep);
        const response = await fetch(`/api/hostlogs/${logId}?${params.toString()}`, {
          credentials: "include",
        });
        if (response.status === 404) markLogMissing(logId); // pins show it as stale
        else if (response.ok) markLogPresent(logId);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        const text = await response.text();
        setLogContent(text ? text.split("\n").filter((l: string) => l.trim()) : []);
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
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
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

  const handleApplyFilters = () => {
    if (!selectedLog) return;
    setLogContent([]);
    if (isFollowing) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      fetchLogContent(selectedLog.id, true);
    } else {
      fetchLogContent(selectedLog.id, false);
    }
  };

  // --- Render ---

  if (isLoadingLogs) {
    return (
      <div className="flex flex-col lg:flex-row gap-4">
        <Skeleton className="h-[calc(100vh-12rem)] w-full lg:w-72" />
        <Skeleton className="h-[calc(100vh-12rem)] flex-1" />
      </div>
    );
  }

  if (logsError) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-pi-error">{logsError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-12rem)]">
      {/* ---- Sidebar ---- */}
      <div
        className={`flex-shrink-0 transition-all duration-200 max-h-[50vh] lg:max-h-none ${
          sidebarCollapsed ? "lg:w-12 w-full" : "lg:w-72 w-full"
        }`}
      >
        <Card className="bg-pi-card border-pi-border h-full overflow-hidden flex flex-col">
          {sidebarCollapsed ? (
            /* Collapsed state */
            <div className="hidden lg:flex flex-col items-center py-3 gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 h-7 w-7"
              >
                <ChevronRight className="h-4 w-4 text-pi-text-muted" />
              </Button>
              <div className="w-6 border-t border-pi-border" />
              {CATEGORY_ORDER.map((key) => {
                const count = groupedLogs[key]?.length || 0;
                if (!count) return null;
                const { Icon } = CATEGORY_META[key];
                return (
                  <div
                    key={key}
                    className="relative"
                    title={`${CATEGORY_META[key].label} (${count})`}
                  >
                    <Icon className="h-4 w-4 text-pi-text-muted" />
                    <span className="absolute -top-1.5 -right-2 text-[9px] bg-pi-accent text-pi-on-accent rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 leading-none">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Expanded state */
            <>
              <CardHeader className="pb-2 pt-3 px-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-pi-accent-text" />
                    <CardTitle className="text-sm font-semibold">
                      Logs
                      <span className="ml-1.5 text-[10px] font-normal text-pi-text-muted">
                        ({totalFiltered}/{logs.length})
                      </span>
                    </CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSidebarCollapsed(true)}
                    className="hidden lg:inline-flex p-1 h-7 w-7"
                  >
                    <ChevronLeft className="h-4 w-4 text-pi-text-muted" />
                  </Button>
                </div>
              </CardHeader>

              <PinnedLogs activeId={selectedLog?.id} onOpen={openPin} />

              {/* List filters */}
              <div className="px-3 pb-2 space-y-2 flex-shrink-0 border-b border-pi-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-pi-text-muted pointer-events-none" />
                  <Input
                    placeholder="Search logs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs pl-7 bg-pi-card-hover border-pi-border"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "name" | "modified")}
                    className="flex-1 h-7 px-2 text-xs rounded-md bg-pi-card-hover border border-pi-border text-pi-text [color-scheme:dark]"
                  >
                    <option value="modified">Newest first</option>
                    <option value="name">A → Z</option>
                  </select>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                    className="flex-1 h-7 px-2 text-xs rounded-md bg-pi-card-hover border border-pi-border text-pi-text [color-scheme:dark]"
                  >
                    <option value="all">All time</option>
                    <option value="24h">Last 24 h</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>
                </div>
              </div>

              {/* Scrollable grouped log list */}
              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1 custom-scrollbar">
                {totalFiltered === 0 ? (
                  <p className="text-xs text-pi-text-muted py-6 text-center">
                    No logs match filters
                  </p>
                ) : (
                  CATEGORY_ORDER.map((catKey) => {
                    const catLogs = groupedLogs[catKey];
                    if (!catLogs?.length) return null;
                    const { label, Icon, accent } = CATEGORY_META[catKey];
                    const expanded = expandedCategories.has(catKey);
                    return (
                      <div key={catKey} className={`border-l-2 ${accent} rounded-r-md`}>
                        <button
                          onClick={() => toggleCategory(catKey)}
                          className="flex items-center justify-between w-full px-2.5 py-2 group rounded-r-md hover:bg-pi-card-hover/50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-pi-text-muted group-hover:text-pi-text transition-colors" />
                            <span className="text-[11px] font-semibold text-pi-text-muted uppercase tracking-wider group-hover:text-pi-text transition-colors">
                              {label}
                            </span>
                            <span className="text-[10px] bg-pi-card-hover text-pi-text rounded-full px-1.5 py-0.5 leading-none tabular-nums">
                              {catLogs.length}
                            </span>
                          </div>
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-pi-text-muted transition-transform duration-150 ${
                              expanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        {expanded && (
                          <div className="space-y-0.5 pb-1.5 pl-1">
                            {catLogs.map((log) => (
                              <LogListItem
                                key={log.id}
                                log={log}
                                selected={selectedLog?.id === log.id}
                                onClick={() => handleLogSelect(log)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Mobile: always show expanded, no collapse button needed */}
          {sidebarCollapsed && (
            <div className="lg:hidden">
              <CardContent className="px-3 pb-3 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSidebarCollapsed(false)}
                  className="w-full text-xs"
                >
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  Show log list
                </Button>
              </CardContent>
            </div>
          )}
        </Card>
      </div>

      {/* ---- Log content pane ---- */}
      <div className="flex-1 min-w-0">
        <Card className="bg-pi-card border-pi-border h-full flex flex-col overflow-hidden">
          <CardHeader className="flex-shrink-0">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg truncate">
                  {selectedLog ? selectedLog.name : "Select a log to view"}
                </CardTitle>
                {selectedLog && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <DownloadLogButton lines={logContent} host={hubLabel} source={selectedLog.id} />
                    {(() => {
                      const grep = searchFilter.trim() || undefined; // pins the log with the filter typed right now
                      const pinned = isPinned(selectedLog.id, grep);
                      const what = grep ? "log with this filter" : "log";
                      return (
                        <Button size="sm" variant="outline" aria-pressed={pinned} aria-label={pinned ? `Unpin ${what}` : `Pin ${what}`} title={pinned ? `Unpin ${what}` : `Pin ${what}`}
                          onClick={() => (pinned ? unpin({ logId: selectedLog.id, grep }) : pin({ logId: selectedLog.id, label: selectedLog.label || selectedLog.name, grep }))}>
                          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                        </Button>
                      );
                    })()}
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
          <CardContent className="flex-1 min-h-0 flex flex-col">
            <div className="bg-pi-terminal-bg rounded-lg p-4 max-h-[600px] lg:max-h-none flex-1 min-h-0 overflow-auto font-mono text-sm custom-scrollbar">
              {error && (
                <div className="text-red-500 mb-4 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {!selectedLog && !error && (
                <div className="text-pi-terminal-muted text-center py-20">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  Select a log from the list to view its contents
                </div>
              )}

              {selectedLog && !error && logContent.length === 0 && !isLoading && (
                <div className="text-pi-terminal-muted text-center py-20">
                  No log entries found
                </div>
              )}

              {isLoading && logContent.length === 0 && (
                <div className="text-pi-terminal-muted text-center py-20">
                  <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin" />
                  Loading...
                </div>
              )}

              {logContent.map((line, idx) => (
                <div key={idx} className="leading-relaxed text-pi-terminal-text">
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
