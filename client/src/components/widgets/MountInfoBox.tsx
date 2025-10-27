import { useQuery } from '@tanstack/react-query'

const fetchMounts = async () => {
  const res = await fetch('/api/metrics/mounts', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch mount data')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export function MountInfoBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['mounts'],
    queryFn: fetchMounts,
    refetchInterval: 15000,
  })

  const mounts = data || []

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-2xl ml-6">
      <h3 className="text-lg font-semibold mb-2">Mount Info</h3>
      {isLoading ? (
        <p className="text-gray-400">Loading mount information...</p>
      ) : error ? (
        <div className="text-sm">
          <p className="text-yellow-400 mb-2">Mount data temporarily unavailable</p>
          <p className="text-gray-400 text-xs">{error.message}</p>
        </div>
      ) : mounts.length === 0 ? (
        <p className="text-gray-400">No mount information available</p>
      ) : (
        <div className="overflow-y-auto max-h-[160px] custom-scrollbar">
          <table className="text-sm w-full table-fixed">
            <thead className="text-gray-400 sticky top-0 bg-[#0f172a] z-10">
              <tr>
                <th className="text-left w-1/4">Mount</th>
                <th className="text-left w-1/5">Type</th>
                <th className="text-left w-2/5">Flags</th>
                <th className="text-left w-1/4">Device</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {mounts.map((mnt: any, i: number) => (
                <tr key={i}>
                  <td className="pr-2 truncate">{mnt.mountpoint}</td>
                  <td className="pr-2">{mnt.fstype}</td>
                  <td className="pr-2 truncate">{mnt.options}</td>
                  <td className="truncate">{mnt.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
