import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'

const fetchFirewallStatus = async () => {
  const res = await fetch('/api/metrics/firewall-status', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function FirewallStatus() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['firewall-status'],
    queryFn: fetchFirewallStatus,
    refetchInterval: 30000,
  })

  const rules = data?.rules || []
  const displayRules = rules.slice(0, 8) // Show up to 8 rules

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        Firewall Status
        {data && (
          <Badge
            className={
              data.enabled
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }
          >
            {data.enabled ? '🟢 Active' : '🔴 Disabled'}
          </Badge>
        )}
      </h3>
      {isLoading ? (
        <p className="text-gray-400">Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-2">
          {data.engine && (
            <p className="text-xs text-gray-400">
              Engine: <span className="font-mono">{data.engine}</span>
            </p>
          )}
          {data.note && (
            <p className="text-xs text-gray-400 italic">{data.note}</p>
          )}
          {rules.length === 0 ? (
            <p className="text-gray-400">No firewall rules configured</p>
          ) : (
            <>
              {rules.length > 8 && (
                <p className="text-xs text-gray-400">
                  Showing 8 of {rules.length} rules
                </p>
              )}
              <div className="overflow-y-auto max-h-48">
                <table className="text-sm w-full">
                  <thead className="text-gray-400 text-xs sticky top-0 bg-[#0f172a]">
                    <tr>
                      <th className="text-left py-1">Port</th>
                      <th className="text-left py-1">Proto</th>
                      <th className="text-left py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRules.map((r: any, idx: number) => (
                      <tr key={idx} className="border-t border-gray-800">
                        <td className="font-mono py-1">{r.port}</td>
                        <td className="text-xs">{r.proto}</td>
                        <td className="text-xs">
                          <span className={r.action === 'ALLOW' ? 'text-green-400' : 'text-red-400'}>
                            {r.action}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
