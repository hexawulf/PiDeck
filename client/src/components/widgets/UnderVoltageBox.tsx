import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface UnderVoltageBoxProps {
  undervoltage: boolean
  throttleRaw: string
}

export function UnderVoltageBox({ undervoltage, throttleRaw }: UnderVoltageBoxProps) {
  const isWarning = undervoltage

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Power Supply</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        <div>
          <p className={isWarning ? 'text-red-400' : 'text-green-400'}>
            {isWarning ? 'Undervoltage Detected' : 'Normal'}
          </p>
          <p className="text-xs text-gray-400">{throttleRaw}</p>
        </div>
      </CardContent>
    </Card>
  )
}
