import { useQuery } from '@tanstack/react-query'

const fetchCpuFreq = async () => {
  const res = await fetch('/api/metrics/cpu-freq')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function CpuFreqBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['cpu-freq'],
    queryFn: fetchCpuFreq,
    refetchInterval: 5000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">CPU Frequency</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.map((core: { core: string; freq: string }) => (
            <li key={core.core}><strong>{core.core.toUpperCase()}:</strong> {core.freq}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
