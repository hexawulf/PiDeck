import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface NvmeSmartBoxProps {
  nvme: {
    temp: string | null
    percentUsed: string | null
    powerCycles: number | null
    mediaErrors: number | null
    warningTempExceeded: number | null
  }
}

export function NvmeSmartBox({ nvme }: NvmeSmartBoxProps) {

  return (
    <Card className="bg-pi-card border-pi-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">NVMe Health</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        <ul className="space-y-1">
          <li>Temp: {nvme.temp}</li>
          <li>Used: {nvme.percentUsed}</li>
          <li>Power Cycles: {nvme.powerCycles}</li>
          <li>Media Errors: {nvme.mediaErrors}</li>
        </ul>
      </CardContent>
    </Card>
  )
}
