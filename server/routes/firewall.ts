import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/firewall/status', (_req, res) => {
  exec('sudo ufw status verbose', (err, stdout, stderr) => {
    if (err || stderr) {
      return res.status(500).json({ error: 'Failed to run ufw', details: stderr || err.message })
    }

    const statusMatch = stdout.match(/^Status:\s*(\w+)/m)
    const status = statusMatch ? statusMatch[1].toLowerCase() : 'inactive'

    const loggingMatch = stdout.match(/^Logging:\s*(.+)$/m)
    const logging = loggingMatch ? loggingMatch[1].trim() : ''

    const defPolicy = { incoming: '', outgoing: '', routed: '' }
    const defaultMatch = stdout.match(/^Default:\s*(.+)$/m)
    if (defaultMatch) {
      const parts = defaultMatch[1].split(',').map(p => p.trim())
      for (const part of parts) {
        const m = part.match(/^(\w+) \((incoming|outgoing|routed)\)/)
        if (m) {
          const field = m[2] as 'incoming' | 'outgoing' | 'routed'
          defPolicy[field] = m[1]
        }
      }
    }

    const rules: { port: string; action: string; from: string }[] = []
    const lines = stdout.split('\n')
    const start = lines.findIndex(l => /^To\s+Action\s+From/.test(l))
    if (start !== -1) {
      for (const line of lines.slice(start + 1)) {
        if (!line.trim()) continue
        const cols = line.trim().split(/\s{2,}/)
        if (cols.length >= 3) {
          const [port, action, from] = cols
          rules.push({ port, action, from })
        }
      }
    }

    res.json({ status, logging, default: defPolicy, rules })
  })
})

export default router
