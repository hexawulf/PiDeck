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
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">
        Listening Ports
        {ports.length > 10 && (
          <span className="text-xs text-gray-400 ml-2">
            (showing 10 of {ports.length})
          </span>
        )}
      </h3>
      {isLoading ? (
        <p className="text-gray-400">Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : ports.length === 0 ? (
        <p className="text-gray-400">No listening ports</p>
      ) : (
        <div className="max-h-72 overflow-y-auto text-sm">
          <table className="w-full">
            <thead className="text-gray-400 text-xs sticky top-0 bg-[#0f172a]">
              <tr>
                <th className="text-left py-1">Port</th>
                <th className="text-left py-1">Proto</th>
                <th className="text-left py-1">IP</th>
                <th className="text-left py-1">Service</th>
              </tr>
            </thead>
            <tbody>
              {displayPorts.map((p: any, idx: number) => (
                <tr key={`${p.proto}-${p.port}-${p.ip}-${idx}`} className="border-t border-gray-800">
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
