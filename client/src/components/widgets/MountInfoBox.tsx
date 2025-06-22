import { useQuery } from '@tanstack/react-query'

const fetchMounts = async () => {
  const res = await fetch('/api/metrics/mounts')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function MountInfoBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['mounts'],
    queryFn: fetchMounts,
    refetchInterval: 15000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-2xl ml-6">
      <h3 className="text-lg font-semibold mb-2">Mount Info</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <table className="text-sm w-full">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left">Mount</th>
              <th className="text-left">Type</th>
              <th className="text-left">Flags</th>
              <th className="text-left">Device</th>
            </tr>
          </thead>
          <tbody>
            {data.map((mnt: any, i: number) => (
              <tr key={i}>
                <td>{mnt.mountpoint}</td>
                <td>{mnt.fstype}</td>
                <td>{mnt.options}</td>
                <td>{mnt.device}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
