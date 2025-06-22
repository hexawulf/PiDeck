import { useQuery } from '@tanstack/react-query'

const fetchFirewallStatus = async () => {
  const res = await fetch('/api/metrics/firewall-status')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function FirewallStatusWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['firewall-status'],
    queryFn: fetchFirewallStatus,
    refetchInterval: 15000,
  })

  const statusColor = data?.enabled ? 'text-green-400' : 'text-red-400'

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">Firewall Status</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-1">
          <p>Status: <span className={statusColor}>{data.enabled ? 'Active' : 'Disabled'}</span></p>
          <p>Incoming: {data.defaultIncoming}</p>
          <p>Outgoing: {data.defaultOutgoing}</p>
          <div>
            <p>Rules:</p>
            <ul className="ml-4 max-h-24 overflow-y-auto list-disc list-inside">
              {data.rules.map((r: any, idx: number) => (
                <li key={idx} className="font-mono">
                  {r.port}/{r.protocol} {r.action}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
