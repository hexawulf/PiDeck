import { useState } from "react";
import { useSystemData, useLogContent } from "@/hooks/use-system-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Folder, 
  FileText, 
  Download, 
  Trash2, 
  RefreshCw 
} from "lucide-react";

export default function LogViewer() {
  const { logFiles } = useSystemData();
  const [selectedLog, setSelectedLog] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  const logContent = useLogContent(selectedLog);

  const handleSelectLog = (filename: string) => {
    setSelectedLog(filename);
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
          <div className="flex items-center justify-between p-4 border-b border-pi-border">
            <div className="flex items-center space-x-3">
              <FileText className="w-5 h-5 text-pi-accent" />
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
              <div className="flex items-center space-x-2">
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
              <div className="h-96 flex items-center justify-center">
                <p className="pi-error">Failed to load log content</p>
              </div>
            ) : (
              <div className="bg-pi-darker rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm custom-scrollbar">
                <div className="space-y-1">
                  {logContent.data?.content ? 
                    logContent.data.content.split('\n').map((line, index) => (
                      <div 
                        key={index} 
                        className={`${
                          line.includes('ERROR') || line.includes('error') 
                            ? 'text-red-400' 
                            : line.includes('WARN') || line.includes('warn')
                            ? 'text-yellow-400'
                            : line.includes('SUCCESS') || line.includes('success')
                            ? 'text-green-400'
                            : 'pi-text-muted'
                        }`}
                      >
                        {line || '\u00A0'}
                      </div>
                    )) : (
                      <div className="pi-text-muted">Log file is empty</div>
                    )
                  }
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
