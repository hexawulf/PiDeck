import { useEffect, useState } from 'react'
import { BootDeviceBox } from '@/components/widgets/BootDeviceBox'
import { UnderVoltageBox } from '@/components/widgets/UnderVoltageBox'
import { NvmeSmartBox } from '@/components/widgets/NvmeSmartBox'

interface BootInfo {
  bootDevice: string
  rootDevice: string
  undervoltage: boolean
  throttleRaw: string
  nvme: {
    temp: string | null
    percentUsed: string | null
    powerCycles: number | null
    mediaErrors: number | null
    warningTempExceeded: number | null
  }
}

export function BootInfoRow() {
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null)

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch('/api/system/boot-info')
        if (!res.ok) throw new Error('Failed to fetch boot info')
        const data: BootInfo = await res.json()
        setBootInfo(data)
      } catch (err) {
        console.error(err)
      }
    }
    fetchInfo()
  }, [])

  if (!bootInfo) {
    return <p className="text-muted">Loading boot information...</p>
  }

  return (
    <div className="flex flex-wrap gap-6 mt-6 w-full">
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <BootDeviceBox bootDevice={bootInfo.bootDevice} rootDevice={bootInfo.rootDevice} />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <UnderVoltageBox undervoltage={bootInfo.undervoltage} throttleRaw={bootInfo.throttleRaw} />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <NvmeSmartBox nvme={bootInfo.nvme} />
      </div>
    </div>
  )
}
