import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/power-status', (_req, res) => {
  exec('vcgencmd get_throttled', (err, stdout, stderr) => {
    if (err || stderr) {
      return res.status(500).json({ error: 'Power check failed' })
    }

    const match = stdout.match(/throttled=0x([0-9a-fA-F]+)/)
    if (!match) return res.status(500).json({ error: 'Unexpected output' })

    const hex = match[1]
    const bin = parseInt(hex, 16).toString(2).padStart(20, '0')

    const flags = {
      undervoltageNow: bin[19] === '1',
      throttlingNow: bin[18] === '1',
      undervoltageOccurred: bin[16] === '1',
      throttlingOccurred: bin[17] === '1',
    }

    res.json({ hex, ...flags })
  })
})

export default router
