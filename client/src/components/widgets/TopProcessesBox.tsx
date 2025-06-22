import { useQuery } from '@tanstack/react-query'

const fetchTopProcesses = async () => {
  const res = await fetch('/api/metrics/top-processes')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function TopProcessesBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['top-processes'],
    queryFn: fetchTopProcesses,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full overflow-x-auto">
      <h3 className="text-lg font-semibold mb-2">Top Processes</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
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
            {data.map((p: any) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td>{p.name}</td>
                <td className="text-right">{p.cpu.toFixed(1)}</td>
                <td className="text-right">{p.mem.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
