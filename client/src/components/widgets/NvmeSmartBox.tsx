import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const fetchBootInfo = async () => {
  const res = await fetch('/api/system/boot-info')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function NvmeSmartBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['boot-info'],
    queryFn: fetchBootInfo,
    refetchInterval: 60000,
  })

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">NVMe Health</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        {isLoading ? (
          <p>Loading...</p>
        ) : error || !data ? (
          <p className="text-red-400">Unavailable</p>
        ) : (
          <ul className="space-y-1">
            <li>Temp: {data.nvme.temp}</li>
            <li>Used: {data.nvme.percentUsed}</li>
            <li>Power Cycles: {data.nvme.powerCycles}</li>
            <li>Media Errors: {data.nvme.mediaErrors}</li>
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
