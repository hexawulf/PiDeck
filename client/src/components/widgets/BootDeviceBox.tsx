import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const fetchBootInfo = async () => {
  const res = await fetch('/api/system/boot-info')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function BootDeviceBox() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['boot-info'],
    queryFn: fetchBootInfo,
    refetchInterval: 60000,
  })

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Boot Source</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        {isLoading ? (
          <p>Loading...</p>
        ) : error || !data ? (
          <p className="text-red-400">Unavailable</p>
        ) : (
          <p className="font-mono">
            {data.bootDevice} → {data.rootDevice}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
