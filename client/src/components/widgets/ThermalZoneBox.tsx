import { useQuery } from '@tanstack/react-query'

const fetchThermalZones = async () => {
  const res = await fetch('/api/metrics/thermal-zones')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function ThermalZoneBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['thermal-zones'],
    queryFn: fetchThermalZones,
    refetchInterval: 10000,
  })

  return (
    <div className="rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-sm">
      <h3 className="text-lg font-semibold mb-2">Thermal Sensors</h3>
      {isLoading ? (
        <p>Loading...</p>
      ) : error || !data ? (
        <p className="text-red-400">Unavailable</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.map((z: { label: string; temp: string }, i: number) => (
            <li key={i}><strong>{z.label}:</strong> {z.temp}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
