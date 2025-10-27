import { useQuery } from '@tanstack/react-query'

const fetchPowerStatus = async () => {
  const res = await fetch('/api/metrics/power-status', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function PowerStatusBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['power-status'],
    queryFn: fetchPowerStatus,
    refetchInterval: 10000,
  })
  const statusLabel = data?.status ?? 'Unavailable'

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">Power Status</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p>{statusLabel}</p>
          <p className="text-xs text-gray-400">
            Voltage: {data.voltage !== null && data.voltage !== undefined ? data.voltage.toFixed(2) + 'V' : 'N/A'}
          </p>
        </div>
      )}
    </div>
  )
}
