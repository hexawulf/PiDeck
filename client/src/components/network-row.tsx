import { IpConfigWidget } from '@/components/widgets/network/IpConfigWidget'
import { ListeningPortsWidget } from '@/components/widgets/network/ListeningPortsWidget'
import { FirewallStatusWidget } from '@/components/widgets/network/FirewallStatusWidget'

export function NetworkRow() {
  return (
    <div className="grid grid-cols-3 gap-4 mt-6 w-full">
      <IpConfigWidget />
      <ListeningPortsWidget />
      <FirewallStatusWidget />
    </div>
  )
}
