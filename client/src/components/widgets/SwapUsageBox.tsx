import { useQuery } from '@tanstack/react-query'

const fetchSwap = async () => {
  const res = await fetch('/api/metrics/swap')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function SwapUsageBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['swap-usage'],
    queryFn: fetchSwap,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">Swap Usage</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-1">
          <p>Total: {data.total}MB</p>
          <p>Used: <span className={data.used > 0 ? 'text-yellow-400' : ''}>{data.used}MB</span></p>
          <p>Free: {data.free}MB</p>
        </div>
      )}
    </div>
  )
}
