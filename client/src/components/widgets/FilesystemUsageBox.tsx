import { useQuery } from '@tanstack/react-query'

const fetchFsUsage = async () => {
  const res = await fetch('/api/metrics/filesystems')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function FilesystemUsageBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['filesystem-usage'],
    queryFn: fetchFsUsage,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-2xl">
      <h3 className="text-lg font-semibold mb-2">Filesystem Usage</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <table className="text-sm w-full">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left">Mount</th>
              <th className="text-left">Used</th>
              <th className="text-left">Free</th>
              <th className="text-left">Size</th>
              <th className="text-left">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((fs: any, i: number) => (
              <tr key={i}>
                <td>{fs.mount}</td>
                <td>{fs.used}</td>
                <td>{fs.avail}</td>
                <td>{fs.size}</td>
                <td>{fs.pcent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
