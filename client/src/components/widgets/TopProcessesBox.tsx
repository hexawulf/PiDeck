import { useQuery } from '@tanstack/react-query'

const fetchTopProcesses = async () => {
  const res = await fetch('/api/metrics/top-processes', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch process data')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export function TopProcessesBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['top-processes'],
    queryFn: fetchTopProcesses,
    refetchInterval: 10000,
  })

  const processes = data || []

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full overflow-x-auto">
      <h3 className="text-lg font-semibold mb-2">Top Processes</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading process data...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-yellow-400 mb-2">Process data temporarily unavailable</p>
          <p className="text-gray-400 text-xs">{error.message}</p>
        </div>
      ) : processes.length === 0 ? (
        <p className="text-gray-400">No process data available</p>
      ) : (
        <table className="text-sm w-full">
          <thead className="text-gray-400">
            <tr>
              <th className="text-left">PID</th>
              <th className="text-left">Name</th>
              <th className="text-right">CPU%</th>
              <th className="text-right">MEM%</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p: any) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td className="truncate max-w-[100px]">{p.name}</td>
                <td className="text-right">{p.cpu !== null && p.cpu !== undefined ? p.cpu.toFixed(1) : 'N/A'}</td>
                <td className="text-right">{p.mem !== null && p.mem !== undefined ? p.mem.toFixed(1) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
