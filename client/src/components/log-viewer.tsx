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
  const { logFiles } = useSystemData();
  const [selectedLog, setSelectedLog] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isHtmlContent, setIsHtmlContent] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const logContainerRef = useRef<HTMLDivElement>(null);
  
  const logContent = useLogContent(selectedLog, autoRefresh);

  const filteredLogLines = useMemo(() => {
    if (!logContent.data?.content) return [];
    const lines = logContent.data.content.split('\n');
    if (!searchTerm) return lines;
    return lines.filter(line => line.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [logContent.data?.content, searchTerm]);

  const handleSelectLog = (filename: string) => {
    setSelectedLog(filename);
    setSearchTerm(""); // Reset search term when selecting a new log
  };

  const handleDownloadLog = () => {
    if (!logContent.data?.content) return;
    
    const blob = new Blob([logContent.data.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedLog;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logContent.data?.content]); // Scroll when content changes

  useEffect(() => {
    if (logContent.data?.content) {
      // Basic HTML detection: check for common tags or <!DOCTYPE>
      const basicHtmlRegex = /<html.*?>|<body.*?>|<div.*?>|<p.*?>|<span.*?>|<!DOCTYPE html>/i;
      setIsHtmlContent(basicHtmlRegex.test(logContent.data.content));
    } else {
      setIsHtmlContent(false);
    }
  }, [logContent.data?.content]);

  if (logFiles.isLoading) {
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

  const files = logFiles.data || [];
  const selectedFile = files.find(f => f.name === selectedLog);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Log Files Sidebar */}
      <div className="lg:col-span-1">
        <Card className="bg-pi-card border-pi-border">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold pi-text mb-4 flex items-center space-x-2">
              <Folder className="w-5 h-5" />
              <span>Log Files</span>
            </h3>
            
            {files.length === 0 ? (
              <p className="pi-text-muted text-sm">No log files found</p>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <button
                    key={file.name}
                    onClick={() => handleSelectLog(file.name)}
                    className={`w-full text-left p-3 rounded-lg hover:bg-pi-card-hover transition-colors ${
                      selectedLog === file.name 
                        ? 'border-l-4 border-pi-accent bg-pi-darker' 
                        : ''
                    }`}
                  >
                    <div className="font-medium pi-text">{file.name}</div>
                    <div className="text-sm pi-text-muted">{file.size}</div>
                  </button>
                ))}
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t border-pi-border">
              <label className="flex items-center space-x-2">
                <Checkbox 
                  checked={autoRefresh}
                  onCheckedChange={(checked) => setAutoRefresh(checked as boolean)}
                  className="border-pi-border"
                />
                <span className="text-sm pi-text-muted">Auto-refresh</span>
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Log Viewer */}
      <div className="lg:col-span-3">
        <Card className="bg-pi-card border-pi-border">
          {/* Log Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-b border-pi-border gap-2">
            <div className="flex items-center space-x-3">
              <FileText className="w-5 h-5 text-pi-accent flex-shrink-0" />
              <div>
                <h3 className="font-semibold pi-text">
                  {selectedFile?.name || "Select a log file"}
                </h3>
                {selectedFile && (
                  <p className="text-sm pi-text-muted">{selectedFile.path}</p>
                )}
              </div>
            </div>
            {selectedLog && (
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                {!isHtmlContent && (
                  <div className="relative flex-grow sm:flex-grow-0">
                    <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-pi-text-muted" />
                    <Input
                      type="text"
                      placeholder="Search logs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 bg-pi-darker border-pi-border focus:border-pi-accent w-full"
                      disabled={isHtmlContent}
                    />
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadLog}
                  className="bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                  disabled={!logContent.data?.content}
                >
                  <Download className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-pi-darker hover:bg-pi-card-hover border-pi-border text-pi-error hover:text-pi-error"
                  disabled
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logContent.refetch()}
                  className="bg-pi-darker hover:bg-pi-card-hover border-pi-border"
                  disabled={logContent.isLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${logContent.isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}
          </div>

          {/* Log Content */}
          <CardContent className="p-4">
            {!selectedLog ? (
              <div className="h-96 flex items-center justify-center">
                <p className="pi-text-muted">Select a log file to view its contents</p>
              </div>
            ) : logContent.isLoading ? (
              <div className="h-96 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin pi-text-muted" />
              </div>
            ) : logContent.error ? (
              <div className="h-96 flex flex-col items-center justify-center p-4">
                <p className="pi-error text-lg mb-2">Failed to load log content</p>
                {logContent.error instanceof Error && (
                  <p className="pi-text-muted text-sm bg-pi-darker p-2 rounded">{logContent.error.message}</p>
                )}
              </div>
            ) : (
              <div
                ref={logContainerRef}
                className="bg-pi-darker rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm custom-scrollbar"
              >
                {isHtmlContent ? (
                  <div dangerouslySetInnerHTML={{ __html: logContent.data?.content || "" }} />
                ) : (
                  <div className="space-y-1">
                    {logContent.data?.content && filteredLogLines.length === 0 && searchTerm ? (
                      <div className="pi-text-muted">No lines match your search term "{searchTerm}".</div>
                    ) : filteredLogLines.length > 0 ? (
                      filteredLogLines.map((line, index) => (
                        <div
                          key={index}
                          className={`${
                            line.includes('ERROR') || line.includes('error')
                              ? 'text-red-400'
                              : line.includes('WARN') || line.includes('warn')
                              ? 'text-yellow-400'
                              : line.includes('SUCCESS') || line.includes('success')
                              ? 'text-green-400'
                              : 'pi-text-muted' // Default text color
                          }`}
                        >
                          <LogLineHighlighter line={line || '\u00A0'} />
                        </div>
                      ))
                    ) : (
                      <div className="pi-text-muted">Log file is empty</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
