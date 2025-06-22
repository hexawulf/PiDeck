import { useQuery } from '@tanstack/react-query'

const fetchListeningPorts = async () => {
  const res = await fetch('/api/metrics/listening-ports')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function ListeningPortsWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['listening-ports'],
    queryFn: fetchListeningPorts,
    refetchInterval: 15000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">Listening Ports</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="max-h-40 overflow-y-auto text-sm">
          <table className="w-full">
            <thead className="text-gray-400 text-xs">
              <tr>
                <th className="text-left">Port</th>
                <th className="text-left">Protocol</th>
                <th className="text-left">Service</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p: any) => (
                <tr key={`${p.protocol}-${p.port}`}
                    className="odd:bg-pi-darker">
                  <td className="font-mono">{p.port}</td>
                  <td>{p.protocol}</td>
                  <td>{p.service || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
