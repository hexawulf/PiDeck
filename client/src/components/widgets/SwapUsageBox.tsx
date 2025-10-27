import { useQuery } from '@tanstack/react-query'

const fetchSwap = async () => {
  const res = await fetch('/api/metrics/swap', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch swap data')
  const data = await res.json()
  return data || { total: 0, used: 0, free: 0 }
}

export function SwapUsageBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['swap-usage'],
    queryFn: fetchSwap,
    refetchInterval: 10000,
  })

  const swapData = data || { total: 0, used: 0, free: 0 }

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">Swap Usage</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading swap data...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-yellow-400 mb-2">Swap data temporarily unavailable</p>
          <p className="text-gray-400 text-xs">{error.message}</p>
          <div className="mt-2 text-gray-400 space-y-1">
            <p>Total: N/A</p>
            <p>Used: N/A</p>
            <p>Free: N/A</p>
          </div>
        </div>
      ) : (
        <div className="text-sm space-y-1">
          <p>Total: {swapData.total}MB</p>
          <p>Used: <span className={swapData.used > 0 ? 'text-yellow-400' : ''}>{swapData.used}MB</span></p>
          <p>Free: {swapData.free}MB</p>
        </div>
      )}
    </div>
  )
}
