import { Router } from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'

const router = Router()
const execAsync = promisify(exec)

router.get('/api/metrics/ip-config', async (_req, res) => {
  try {
    const { stdout: ipOut } = await execAsync("ip -4 addr show | grep -oP '(?<=inet\\s)\\d+(?:\\.\\d+){3}' | head -n 1")
    const ip = ipOut.trim()
    const { stdout: gwOut } = await execAsync("ip route | awk '/default/ {print $3}'")
    const gateway = gwOut.trim()
    let dnsOut = ''
    try {
      const { stdout } = await execAsync("resolvectl dns 2>/dev/null | awk 'NR>1 {print $2}'")
      dnsOut = stdout
    } catch {
      const { stdout } = await execAsync("grep nameserver /etc/resolv.conf | awk '{print $2}'")
      dnsOut = stdout
    }
    const dns = dnsOut.trim().split(/\s+/).filter(Boolean)
    res.json({ ip, gateway, dns })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch IP config', details: err.message })
  }
})

router.get('/api/metrics/listening-ports', async (_req, res) => {
  try {
    const { stdout } = await execAsync("ss -tulnp")
    const lines = stdout.trim().split('\n').slice(1)
    const ports = lines.map(line => {
      const portMatch = line.match(/:(\d+)/)
      const protoMatch = line.match(/^(tcp|udp)/)
      const serviceMatch = line.match(/users:\(\\(\"([^\",]+)/)
      return portMatch && protoMatch ? {
        port: parseInt(portMatch[1], 10),
        protocol: protoMatch[1],
        service: serviceMatch ? serviceMatch[2] : ''
      } : null
    }).filter(Boolean)
    res.json(ports)
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch listening ports', details: err.message })
  }
})

router.get('/api/metrics/firewall-status', async (_req, res) => {
  try {
    const { stdout } = await execAsync('ufw status verbose')
    const enabled = stdout.includes('Status: active')
    let defaultIncoming = ''
    let defaultOutgoing = ''
    const defaultMatch = stdout.match(/Default: ([^\n]+)/)
    if (defaultMatch) {
      const parts = defaultMatch[1].split(',')
      for (const p of parts) {
        if (p.includes('incoming')) defaultIncoming = p.trim().split(' ')[0]
        if (p.includes('outgoing')) defaultOutgoing = p.trim().split(' ')[0]
      }
    }
    const rules: { port: number; protocol: string; action: string }[] = []
    stdout.split('\n').forEach(line => {
      const m = line.match(/(\d+)(?:\/(tcp|udp))?\s+(ALLOW|DENY)/)
      if (m) {
        rules.push({ port: parseInt(m[1], 10), protocol: m[2] || 'tcp', action: m[3].toLowerCase() })
      }
    })
    res.json({ enabled, defaultIncoming, defaultOutgoing, rules })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch firewall status', details: err.message })
  }
})

export default router
