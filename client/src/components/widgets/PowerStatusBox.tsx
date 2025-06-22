import { useQuery } from '@tanstack/react-query'

const fetchPowerStatus = async () => {
  const res = await fetch('/api/metrics/power-status')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function PowerStatusBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['power-status'],
    queryFn: fetchPowerStatus,
    refetchInterval: 10000,
  })

  let status = '✅ Normal'
  if (data?.undervoltageNow || data?.throttlingNow) {
    status = '🔴 Throttling Now'
  } else if (data?.undervoltageOccurred || data?.throttlingOccurred) {
    status = '⚠️ Throttled Previously'
  }

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">Power Status</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p>{status}</p>
          <p className="text-xs text-gray-400">Hex Code: 0x{data.hex}</p>
        </div>
      )}
    </div>
  )
}
