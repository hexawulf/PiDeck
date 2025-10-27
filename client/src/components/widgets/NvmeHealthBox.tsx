import { useQuery } from '@tanstack/react-query'

const fetchNvmeHealth = async () => {
  const res = await fetch('/api/metrics/nvme', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function NvmeHealthBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['nvme-health'],
    queryFn: fetchNvmeHealth,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">NVMe Status</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <ul className="space-y-1 text-sm">
          <li><strong>Temp:</strong> {data.temperature}°C</li>
          <li><strong>Power-On Hours:</strong> {data.power_on_hours}</li>
          <li><strong>Wear Leveling:</strong> {data.wear_leveling_count}</li>
          <li><strong>Media Errors:</strong> {data.media_errors}</li>
        </ul>
      )}
    </div>
  )
}
