import { useQuery } from '@tanstack/react-query'

const fetchCpuFreq = async () => {
  const res = await fetch('/api/metrics/cpu-freq', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch CPU frequency data')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export function CpuFreqBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['cpu-freq'],
    queryFn: fetchCpuFreq,
    refetchInterval: 5000,
  })

  const frequencies = data || []

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">CPU Frequency</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading CPU frequency data...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-yellow-400 mb-2">CPU frequency data temporarily unavailable</p>
          <p className="text-gray-400 text-xs">{error.message}</p>
        </div>
      ) : frequencies.length === 0 ? (
        <p className="text-gray-400">No CPU frequency data available</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {frequencies.map((core: { core: string; freq: string }) => (
            <li key={core.core}><strong>{core.core.toUpperCase()}:</strong> {core.freq}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
