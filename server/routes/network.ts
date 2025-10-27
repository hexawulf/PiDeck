import { Router } from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'

const router = Router()
const execAsync = promisify(exec)

// Helper to run commands with timeout
const run = async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 4000 })
    return { stdout: stdout || '', stderr: stderr || '' }
  } catch (error: any) {
    return { stdout: error.stdout || '', stderr: error.stderr || '' }
  }
}

router.get('/metrics/ip-config', async (req, res) => {
  try {
    const includeDocker = req.query.includeDocker === '1'
    const interfaces: any[] = []

    // Try ip -j addr first (JSON output, available on Ubuntu >= 20.04)
    const { stdout: jsonOut } = await run('ip -j addr')
    
    if (jsonOut && jsonOut.trim().startsWith('[')) {
      // Parse JSON output
      try {
        const parsed = JSON.parse(jsonOut)
        for (const iface of parsed) {
          // Skip loopback and down interfaces
          if (iface.ifname === 'lo') continue
          if (iface.operstate !== 'UP' && iface.operstate !== 'UNKNOWN') continue
          
          // Skip docker interfaces unless explicitly requested
          if (!includeDocker && (iface.ifname.startsWith('docker') || iface.ifname.startsWith('veth'))) {
            continue
          }

          const addrs: string[] = []
          const ipv6: string[] = []
          let mac = ''

          for (const addr of iface.addr_info || []) {
            if (addr.family === 'inet') {
              addrs.push(addr.local)
            } else if (addr.family === 'inet6' && !addr.local.startsWith('fe80::')) {
              ipv6.push(addr.local)
            }
          }

          // Get MAC address
          if (iface.address) {
            mac = iface.address
          }

          if (addrs.length > 0 || ipv6.length > 0) {
            interfaces.push({
              ifname: iface.ifname,
              addr: addrs,
              ipv6: ipv6,
              mac: mac
            })
          }
        }
      } catch (parseError) {
        console.error('[network] Failed to parse ip -j output', parseError)
      }
    }

    // Fallback to ip -o addr if JSON parsing failed
    if (interfaces.length === 0) {
      const { stdout: lineOut } = await run('ip -o addr')
      const lines = lineOut.split('\n')
      const ifaceMap = new Map<string, any>()

      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 4) continue

        const ifname = parts[1]
        const family = parts[2]
        const addr = parts[3].split('/')[0]

        // Skip loopback
        if (ifname === 'lo') continue
        
        // Skip docker interfaces unless explicitly requested
        if (!includeDocker && (ifname.startsWith('docker') || ifname.startsWith('veth'))) {
          continue
        }

        if (!ifaceMap.has(ifname)) {
          ifaceMap.set(ifname, { ifname, addr: [], ipv6: [], mac: '' })
        }

        const iface = ifaceMap.get(ifname)
        if (family === 'inet') {
          iface.addr.push(addr)
        } else if (family === 'inet6' && !addr.startsWith('fe80::')) {
          iface.ipv6.push(addr)
        }
      }

      interfaces.push(...Array.from(ifaceMap.values()).filter(i => i.addr.length > 0 || i.ipv6.length > 0))
    }

    res.json({ interfaces })
  } catch (err: any) {
    console.error('[network] IP config error:', err)
    res.json({ interfaces: [] })
  }
})

// Common service names for ports
const SERVICE_NAMES: Record<number, string> = {
  22: 'ssh',
  80: 'http',
  443: 'https',
  3000: 'grafana',
  3306: 'mysql',
  5006: 'pideck',
  5432: 'postgresql',
  6379: 'redis',
  8080: 'http-alt',
  9090: 'prometheus',
  27017: 'mongodb'
}

router.get('/metrics/listening-ports', async (req, res) => {
  try {
    const full = req.query.full === '1'
    const { stdout } = await run('ss -tuln')
    
    const lines = stdout.trim().split('\n').slice(1)
    const portMap = new Map<string, any>()
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      
      const proto = parts[0].toLowerCase().replace('6', '') // tcp6 -> tcp
      const localAddr = parts[4] || ''
      
      // Extract port and IP
      const lastColon = localAddr.lastIndexOf(':')
      if (lastColon === -1) continue
      
      const ip = localAddr.substring(0, lastColon).replace(/[\[\]]/g, '') // Remove brackets for IPv6
      const portStr = localAddr.substring(lastColon + 1)
      const port = parseInt(portStr, 10)
      
      if (isNaN(port)) continue
      
      // Use proto-port-ip as unique key to avoid duplicates
      const key = `${proto}-${port}-${ip}`
      if (!portMap.has(key)) {
        const desc = SERVICE_NAMES[port] || ''
        portMap.set(key, {
          proto,
          port,
          ip: ip === '*' ? '0.0.0.0' : ip,
          desc
        })
      }
    }
    
    let listening = Array.from(portMap.values())
    
    // Sort by port ascending
    listening.sort((a, b) => a.port - b.port)
    
    // Truncate if not full mode (limit to 200)
    if (!full && listening.length > 200) {
      listening = listening.slice(0, 200)
    }
    
    res.json({ listening })
  } catch (err: any) {
    console.error('[network] Listening ports error:', err)
    res.json({ listening: [] })
  }
})

router.get('/metrics/firewall-status', async (_req, res) => {
  try {
    // Try to detect firewall tool
    const { stdout: ufwCheck } = await run('command -v ufw')
    
    if (ufwCheck.trim()) {
      // UFW is available
      const { stdout } = await run('ufw status verbose')
      const enabled = stdout.includes('Status: active')
      
      const rules: any[] = []
      const lines = stdout.split('\n')
      
      for (const line of lines) {
        // Match rules like: "22/tcp ALLOW IN Anywhere"
        const match = line.match(/^(\d+)(?:\/(tcp|udp|any))?\s+(ALLOW|DENY)\s+(IN|OUT)\s+(.+)$/i)
        if (match) {
          rules.push({
            action: match[3].toUpperCase(),
            proto: match[2] || 'any',
            port: match[1]
          })
        }
      }
      
      return res.json({
        engine: 'ufw',
        enabled,
        rules
      })
    }
    
    // Try firewall-cmd (firewalld)
    const { stdout: fwdCheck } = await run('command -v firewall-cmd')
    if (fwdCheck.trim()) {
      const { stdout: stateOut } = await run('firewall-cmd --state')
      const enabled = stateOut.trim().toLowerCase() === 'running'
      
      if (enabled) {
        const { stdout: portsOut } = await run('firewall-cmd --list-ports')
        const ports = portsOut.trim().split(/\s+/).filter(Boolean)
        
        const rules: any[] = []
        for (const portProto of ports) {
          const [port, proto] = portProto.split('/')
          rules.push({
            action: 'ALLOW',
            proto: proto || 'tcp',
            port
          })
        }
        
        return res.json({
          engine: 'firewalld',
          enabled,
          rules
        })
      } else {
        return res.json({
          engine: 'firewalld',
          enabled: false,
          rules: []
        })
      }
    }
    
    // Try nftables
    const { stdout: nftCheck } = await run('command -v nft')
    if (nftCheck.trim()) {
      const { stdout: nftOut } = await run('nft list ruleset')
      if (nftOut.trim()) {
        return res.json({
          engine: 'nftables',
          enabled: true,
          note: 'nftables detected (no ufw) — assume managed by distro',
          rules: []
        })
      }
    }
    
    // No firewall detected
    res.json({
      engine: 'unknown',
      enabled: false,
      note: 'no firewall tool detected',
      rules: []
    })
  } catch (err: any) {
    console.error('[network] Firewall status error:', err)
    res.json({
      engine: 'unknown',
      enabled: false,
      note: 'error checking firewall status',
      rules: []
    })
  }
})

export default router
