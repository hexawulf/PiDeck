import { FilesystemUsageBox } from '@/components/widgets/FilesystemUsageBox'
import { MountInfoBox } from '@/components/widgets/MountInfoBox'

export function FilesystemDiskRow() {
  return (
    <div className="flex flex-wrap gap-6 mt-6 w-full">
      <div className="flex-1 min-w-[300px] max-w-[48%]">
        <FilesystemUsageBox />
      </div>
      <div className="flex-1 min-w-[300px] max-w-[48%]">
        <MountInfoBox />
      </div>
    </div>
  )
}
