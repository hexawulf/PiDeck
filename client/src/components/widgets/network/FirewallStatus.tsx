import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const fetchFirewallStatus = async () => {
  const res = await fetch('/api/firewall/status')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function FirewallStatus() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['firewall-status'],
    queryFn: fetchFirewallStatus,
    refetchInterval: 15000,
  })
  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        Firewall Status
        {data && (
          <Badge
            className={
              data.status === 'active'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }
          >
            {data.status === 'active' ? '🟢 Active' : '🔴 Inactive'}
          </Badge>
        )}
      </h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-2">
          <p>Logging: {data.logging}</p>
          <Tooltip>
            <TooltipTrigger className="underline cursor-help">Default Policy</TooltipTrigger>
            <TooltipContent>
              <p>Incoming: {data.default.incoming}</p>
              <p>Outgoing: {data.default.outgoing}</p>
              <p>Routed: {data.default.routed}</p>
            </TooltipContent>
          </Tooltip>
          <div className="overflow-y-auto max-h-32">
            <table className="text-sm w-full">
              <thead className="text-gray-400">
                <tr>
                  <th className="text-left">Port</th>
                  <th className="text-left">Action</th>
                  <th className="text-left">From</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r: any, idx: number) => (
                  <tr key={idx} className="odd:bg-pi-darker">
                    <td className="font-mono">{r.port}</td>
                    <td>{r.action}</td>
                    <td>{r.from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
