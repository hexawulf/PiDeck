import { useQuery } from '@tanstack/react-query'

const fetchFsUsage = async () => {
  const res = await fetch('/api/metrics/filesystems', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch filesystem data')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export function FilesystemUsageBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['filesystem-usage'],
    queryFn: fetchFsUsage,
    refetchInterval: 10000,
  })

  const filesystems = data || []

  return (
    <div className="rounded-2xl border p-4 shadow bg-pi-card text-pi-text w-full max-w-2xl">
      <h3 className="text-lg font-semibold mb-2">Filesystem Usage</h3>
      {isLoading ? (
        <p className="text-pi-text-muted">Loading filesystem data...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-pi-warning mb-2">Filesystem data temporarily unavailable</p>
          <p className="text-pi-text-muted text-xs">{error.message}</p>
        </div>
      ) : filesystems.length === 0 ? (
        <p className="text-pi-text-muted">No filesystem data available</p>
      ) : (
        <table className="text-sm w-full">
          <thead>
            <tr className="text-pi-text-muted">
              <th className="text-left">Mount</th>
              <th className="text-left">Used</th>
              <th className="text-left">Free</th>
              <th className="text-left">Size</th>
              <th className="text-left">%</th>
            </tr>
          </thead>
          <tbody>
            {filesystems.map((fs: any, i: number) => (
              <tr key={i}>
                <td className="truncate max-w-[120px]">{fs.mount}</td>
                <td>{fs.used}MB</td>
                <td>{fs.avail}MB</td>
                <td>{fs.size}MB</td>
                <td>{fs.pcent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
