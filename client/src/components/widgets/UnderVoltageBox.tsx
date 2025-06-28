import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const fetchBootInfo = async () => {
  const res = await fetch('/api/system/boot-info')
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function UnderVoltageBox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['boot-info'],
    queryFn: fetchBootInfo,
    refetchInterval: 60000,
  })

  const isWarning = data?.undervoltage

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Power Supply</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        {isLoading ? (
          <p>Loading...</p>
        ) : error || !data ? (
          <p className="text-red-400">Unavailable</p>
        ) : (
          <div>
            <p className={isWarning ? 'text-red-400' : 'text-green-400'}>
              {isWarning ? 'Undervoltage Detected' : 'Normal'}
            </p>
            <p className="text-xs text-gray-400">{data.throttleRaw}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
