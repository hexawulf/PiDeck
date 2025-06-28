import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface BootDeviceBoxProps {
  bootDevice: string
  rootDevice: string
}

export function BootDeviceBox({ bootDevice, rootDevice }: BootDeviceBoxProps) {

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Boot Source</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        <p className="font-mono">
          {bootDevice} → {rootDevice}
        </p>
      </CardContent>
    </Card>
  )
}
