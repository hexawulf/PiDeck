import { useQuery } from '@tanstack/react-query'

const fetchRamStats = async () => {
  const res = await fetch('/api/metrics/ram', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch RAM data')
  const data = await res.json()
  return data || { total: 0, used: 0, free: 0, usage: 0 }
}

export function RamStatsBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['ram-stats'],
    queryFn: fetchRamStats,
    refetchInterval: 10000,
  })

  const ramData = data || { total: 0, used: 0, free: 0, usage: 0 }

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">RAM Stats</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading RAM data...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-yellow-400 mb-2">RAM data temporarily unavailable</p>
          <p className="text-gray-400 text-xs">{error.message}</p>
          <div className="mt-2 text-gray-400 space-y-1">
            <p>Total: N/A</p>
            <p>Used: N/A</p>
            <p>Free: N/A</p>
            <p>Usage: N/A</p>
          </div>
        </div>
      ) : (
        <div className="text-sm space-y-1">
          <p>Total: {ramData.total}MB</p>
          <p>Used: {ramData.used}MB</p>
          <p>Free: {ramData.free}MB</p>
          <p>Usage: {ramData.usage}%{ramData.usage > 90 ? ' ⚠️' : ''}</p>
        </div>
      )}
    </div>
  )
}
