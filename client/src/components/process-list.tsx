import { useSystemData } from "@/hooks/use-system-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ServerCrash, List } from 'lucide-react';

export default function ProcessList() {
  const { systemInfo } = useSystemData();
  const processes = systemInfo.data?.processes;

  if (systemInfo.isLoading && !processes) { // Show loading only if processes are not yet available
    return (
      <Card className="bg-pi-card border-pi-border">
        <CardHeader>
          <CardTitle className="pi-text text-lg flex items-center">
            <List className="w-5 h-5 mr-2" /> Top Processes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="pi-text-muted">Loading process data...</p>
        </CardContent>
      </Card>
    );
  }

  if (systemInfo.error && !processes) { // Show error only if processes are not yet available
    return (
      <Card className="bg-pi-card border-pi-border">
        <CardHeader>
          <CardTitle className="pi-text text-lg flex items-center">
            <List className="w-5 h-5 mr-2" /> Top Processes
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-full text-pi-muted">
          <ServerCrash className="w-12 h-12 mb-2 text-pi-error" />
          <p>Error loading process data.</p>
        </CardContent>
      </Card>
    );
  }

  if (!processes || processes.length === 0) {
    return (
      <Card className="bg-pi-card border-pi-border">
        <CardHeader>
          <CardTitle className="pi-text text-lg flex items-center">
            <List className="w-5 h-5 mr-2" /> Top Processes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="pi-text-muted">No process data available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-pi-card border-pi-border">
      <CardHeader>
        <CardTitle className="pi-text text-lg flex items-center">
          <List className="w-5 h-5 mr-2" /> Top Processes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[240px]"> {/* Adjust height as needed */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pi-text-muted">PID</TableHead>
                <TableHead className="pi-text-muted">Name</TableHead>
                <TableHead className="pi-text-muted text-right">CPU %</TableHead>
                <TableHead className="pi-text-muted text-right">Mem %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processes.map((proc) => (
                <TableRow key={proc.pid}>
                  <TableCell className="pi-text font-mono text-xs">{proc.pid}</TableCell>
                  <TableCell className="pi-text text-xs">{proc.name}</TableCell>
                  <TableCell className="pi-text text-xs text-right">{proc.cpuUsage.toFixed(1)}%</TableCell>
                  <TableCell className="pi-text text-xs text-right">{proc.memUsage.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
