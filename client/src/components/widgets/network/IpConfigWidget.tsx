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
    <div className="rounded-2xl border p-4 shadow bg-pi-card text-pi-text w-full">
      <h3 className="text-lg font-semibold mb-2">IP Configuration</h3>
      {isLoading ? (
        <p className="text-pi-text-muted">Loading...</p>
      ) : error || !data ? (
        <p className="text-pi-error">Unavailable</p>
      ) : !data.interfaces || data.interfaces.length === 0 ? (
        <p className="text-pi-text-muted">No active interfaces</p>
      ) : (
        <div className="text-sm space-y-3 max-h-64 overflow-y-auto">
          {data.interfaces.map((iface: any) => (
            <div key={iface.ifname} className="border-b border-pi-border pb-2 last:border-0">
              <p className="font-semibold text-blue-600 dark:text-blue-400">{iface.ifname}</p>
              {iface.addr && iface.addr.length > 0 && (
                <p className="text-xs text-pi-text-muted">
                  IPv4: <span className="font-mono">{iface.addr.join(', ')}</span>
                </p>
              )}
              {iface.ipv6 && iface.ipv6.length > 0 && (
                <p className="text-xs text-pi-text-muted">
                  IPv6: <span className="font-mono text-xs">{iface.ipv6.map((ip: string) => ip.substring(0, 20) + (ip.length > 20 ? '...' : '')).join(', ')}</span>
                </p>
              )}
              {iface.mac && (
                <p className="text-xs text-pi-text-muted">
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
