import { RamStatsBox } from '@/components/widgets/RamStatsBox'
import { SwapUsageBox } from '@/components/widgets/SwapUsageBox'
import { TopProcessesBox } from '@/components/widgets/TopProcessesBox'

export function MemoryProcessRow() {
  return (
    <div className="flex flex-wrap gap-6 mt-6 w-full">
      <div className="flex-1 min-w-[300px] max-w-[30%]">
        <RamStatsBox />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[30%]">
        <SwapUsageBox />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[30%]">
        <TopProcessesBox />
      </div>
    </div>
  )
}
