import { useQuery } from '@tanstack/react-query'

const fetchListeningPorts = async () => {
  const res = await fetch('/api/metrics/listening-ports', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function ListeningPortsWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['listening-ports'],
    queryFn: fetchListeningPorts,
    refetchInterval: 30000,
  })

  const ports = data?.listening || []
  const displayPorts = ports.slice(0, 10) // Show top 10

  return (
    <div className="rounded-2xl border p-4 shadow bg-pi-card text-pi-text w-full">
      <h3 className="text-lg font-semibold mb-2">
        Listening Ports
        {ports.length > 10 && (
          <span className="text-xs text-pi-text-muted ml-2">
            (showing 10 of {ports.length})
          </span>
        )}
      </h3>
      {isLoading ? (
        <p className="text-pi-text-muted">Loading...</p>
      ) : error || !data ? (
        <p className="text-pi-error">Unavailable</p>
      ) : ports.length === 0 ? (
        <p className="text-pi-text-muted">No listening ports</p>
      ) : (
        <div className="max-h-72 overflow-y-auto text-sm">
          <table className="w-full">
            <thead className="text-pi-text-muted text-xs sticky top-0 bg-pi-card">
              <tr>
                <th className="text-left py-1">Port</th>
                <th className="text-left py-1">Proto</th>
                <th className="text-left py-1">IP</th>
                <th className="text-left py-1">Service</th>
              </tr>
            </thead>
            <tbody>
              {displayPorts.map((p: any, idx: number) => (
                <tr key={`${p.proto}-${p.port}-${p.ip}-${idx}`} className="border-t border-pi-border">
                  <td className="font-mono py-1">{p.port}</td>
                  <td className="text-xs">{p.proto}</td>
                  <td className="font-mono text-xs">{p.ip === '0.0.0.0' ? '*' : p.ip}</td>
                  <td className="text-xs">{p.desc || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
