import { useQuery } from '@tanstack/react-query'

const fetchRamStats = async () => {
  const res = await fetch('/api/metrics/ram')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function RamStatsBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['ram-stats'],
    queryFn: fetchRamStats,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">RAM Stats</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-1">
          <p>Total: {data.total}MB</p>
          <p>Used: {data.used}MB</p>
          <p>Free: {data.free}MB</p>
          <p>Usage: {data.usage}%{data.usage > 90 ? ' ⚠️' : ''}</p>
        </div>
      )}
    </div>
  )
}
