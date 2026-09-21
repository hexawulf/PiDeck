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
  const MAX_DISPLAY = 20
  const displayRules = rules.slice(0, MAX_DISPLAY)

  const actionColor = (action: string) => {
    const a = action.toUpperCase()
    if (a.startsWith('ALLOW')) return 'text-pi-success'
    if (a.startsWith('LIMIT')) return 'text-pi-warning'
    return 'text-pi-error'
  }

  return (
    <div className="rounded-2xl border p-4 shadow bg-pi-card text-pi-text w-full">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        Firewall Status
        {data && (
          <Badge
            className={
              data.enabled
                ? 'bg-pi-success-soft text-pi-success'
                : 'bg-pi-error-soft text-pi-error'
            }
          >
            {data.enabled ? '🟢 Active' : '🔴 Disabled'}
          </Badge>
        )}
      </h3>
      {isLoading ? (
        <p className="text-pi-text-muted">Loading...</p>
      ) : error || !data ? (
        <p className="text-pi-error">Unavailable</p>
      ) : (
        <div className="text-sm space-y-2">
          {data.engine && (
            <p className="text-xs text-pi-text-muted">
              Engine: <span className="font-mono">{data.engine}</span>
            </p>
          )}
          {data.note && (
            <p className="text-xs text-pi-text-muted italic">{data.note}</p>
          )}
          {rules.length === 0 ? (
            <p className="text-pi-text-muted">No firewall rules configured</p>
          ) : (
            <>
              {rules.length > MAX_DISPLAY && (
                <p className="text-xs text-pi-text-muted">
                  Showing {MAX_DISPLAY} of {rules.length} rules
                </p>
              )}
              <div className="overflow-y-auto max-h-64">
                <table className="text-sm w-full">
                  <thead className="text-pi-text-muted text-xs sticky top-0 bg-pi-card">
                    <tr>
                      <th className="text-left py-1">To</th>
                      <th className="text-left py-1">Action</th>
                      <th className="text-left py-1">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRules.map((r: any, idx: number) => (
                      <tr key={idx} className="border-t border-pi-border" title={r.comment || undefined}>
                        <td className="font-mono py-1 pr-2 truncate max-w-[120px]">{r.to}</td>
                        <td className="text-xs pr-2 whitespace-nowrap">
                          <span className={actionColor(r.action)}>
                            {r.action}
                          </span>
                        </td>
                        <td className="text-xs font-mono truncate max-w-[140px]">{r.from}</td>
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
