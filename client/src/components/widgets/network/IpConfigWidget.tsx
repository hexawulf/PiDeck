import { useQuery } from '@tanstack/react-query'

const fetchIpConfig = async () => {
  const res = await fetch('/api/metrics/ip-config')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function IpConfigWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['ip-config'],
    queryFn: fetchIpConfig,
    refetchInterval: 15000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full">
      <h3 className="text-lg font-semibold mb-2">IP Configuration</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <div className="text-sm space-y-1">
          <p>IP: <span className="font-mono">{data.ip}</span></p>
          <p>Gateway: <span className="font-mono">{data.gateway}</span></p>
          <div>
            <p>DNS:</p>
            <ul className="ml-4 max-h-24 overflow-y-auto list-disc list-inside">
              {data.dns.map((d: string) => (
                <li key={d} className="font-mono">{d}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
