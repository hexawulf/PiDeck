import { useQuery } from '@tanstack/react-query'

const fetchIpConfig = async () => {
  const res = await fetch('/api/metrics/ip-config', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function IpConfigWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['ip-config'],
    queryFn: fetchIpConfig,
    refetchInterval: 30000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">IP Configuration</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : !data.interfaces || data.interfaces.length === 0 ? (
        <p className="text-gray-400">No active interfaces</p>
      ) : (
        <div className="text-sm space-y-3 max-h-64 overflow-y-auto">
          {data.interfaces.map((iface: any) => (
            <div key={iface.ifname} className="border-b border-gray-700 pb-2 last:border-0">
              <p className="font-semibold text-blue-400">{iface.ifname}</p>
              {iface.addr && iface.addr.length > 0 && (
                <p className="text-xs text-gray-300">
                  IPv4: <span className="font-mono">{iface.addr.join(', ')}</span>
                </p>
              )}
              {iface.ipv6 && iface.ipv6.length > 0 && (
                <p className="text-xs text-gray-300">
                  IPv6: <span className="font-mono text-xs">{iface.ipv6.map((ip: string) => ip.substring(0, 20) + (ip.length > 20 ? '...' : '')).join(', ')}</span>
                </p>
              )}
              {iface.mac && (
                <p className="text-xs text-gray-400">
                  MAC: <span className="font-mono">{iface.mac}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
