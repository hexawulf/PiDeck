import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HistoricalMetric, DiskIO, NetworkBandwidth } from "@shared/schema";
import { useSystemData } from "@/hooks/use-system-data";
import { ServerCrash } from 'lucide-react';

const formatTime = (timestamp: string | number | Date) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-pi-card p-2 border border-pi-border rounded shadow-lg">
        <p className="label text-sm pi-text-muted">{`${formatTime(label)}`}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} style={{ color: entry.color }} className="text-xs">
            {`${entry.name}: ${entry.value.toFixed(2)} ${entry.unit || ''}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function DiskIOGraph() {
  const { systemInfo, historicalData } = useSystemData();
  const currentDiskIO = systemInfo.data?.diskIO;

  const chartData = historicalData.data?.map(item => ({
    time: item.timestamp,
    read: item.diskReadSpeed,
    write: item.diskWriteSpeed,
  })) || [];

  if (historicalData.isLoading) return <p className="pi-text-muted">Loading Disk I/O data...</p>;
  if (historicalData.error || !historicalData.data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pi-muted">
        <ServerCrash className="w-12 h-12 mb-2 text-pi-error" />
        <p>Error loading Disk I/O data.</p>
      </div>
    );
  }

  return (
    <Card className="bg-pi-card border-pi-border">
      <CardHeader>
        <CardTitle className="pi-text text-lg">Disk I/O</CardTitle>
        {currentDiskIO && (
          <div className="text-xs pi-text-muted">
            <span>Read: {currentDiskIO.readSpeed.toFixed(1)} KB/s</span> |
            <span> Write: {currentDiskIO.writeSpeed.toFixed(1)} KB/s</span> |
            <span> Util: {currentDiskIO.utilization.toFixed(1)}%</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="h-[250px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="colorRead" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorWrite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#82ca9d" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="time" tickFormatter={formatTime} stroke="#a0a0a0" fontSize={12} />
            <YAxis unit="KB/s" stroke="#a0a0a0" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Area type="monotone" dataKey="read" stroke="#8884d8" fillOpacity={1} fill="url(#colorRead)" unit="KB/s" name="Read Speed" />
            <Area type="monotone" dataKey="write" stroke="#82ca9d" fillOpacity={1} fill="url(#colorWrite)" unit="KB/s" name="Write Speed" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function NetworkBandwidthGraph() {
  const { systemInfo, historicalData } = useSystemData();
  const currentNetwork = systemInfo.data?.networkBandwidth;

  const chartData = historicalData.data?.map(item => ({
    time: item.timestamp,
    received: item.networkRx,
    sent: item.networkTx,
  })) || [];

  if (historicalData.isLoading) return <p className="pi-text-muted">Loading Network Bandwidth data...</p>;
  if (historicalData.error || !historicalData.data) {
     return (
      <div className="flex flex-col items-center justify-center h-full text-pi-muted">
        <ServerCrash className="w-12 h-12 mb-2 text-pi-error" />
        <p>Error loading Network data.</p>
      </div>
    );
  }

  return (
    <Card className="bg-pi-card border-pi-border">
      <CardHeader>
        <CardTitle className="pi-text text-lg">Network Bandwidth</CardTitle>
         {currentNetwork && (
          <div className="text-xs pi-text-muted">
            <span>RX: {currentNetwork.rx.toFixed(1)} KB/s</span> |
            <span> TX: {currentNetwork.tx.toFixed(1)} KB/s</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="h-[250px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
             <defs>
              <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="time" tickFormatter={formatTime} stroke="#a0a0a0" fontSize={12} />
            <YAxis unit="KB/s" stroke="#a0a0a0" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Area type="monotone" dataKey="received" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRx)" unit="KB/s" name="Received" />
            <Area type="monotone" dataKey="sent" stroke="#10b981" fillOpacity={1} fill="url(#colorTx)" unit="KB/s" name="Sent" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
