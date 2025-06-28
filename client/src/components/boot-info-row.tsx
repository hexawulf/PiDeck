import { BootDeviceBox } from '@/components/widgets/BootDeviceBox'
import { UnderVoltageBox } from '@/components/widgets/UnderVoltageBox'
import { NvmeSmartBox } from '@/components/widgets/NvmeSmartBox'

export function BootInfoRow() {
  return (
    <div className="flex flex-wrap gap-6 mt-6 w-full">
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <BootDeviceBox />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <UnderVoltageBox />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[32%]">
        <NvmeSmartBox />
      </div>
    </div>
  )
}
