import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/power-status', (_req, res) => {
  exec('/usr/bin/vcgencmd get_throttled', {
    env: {
      ...process.env,
      PATH: `${process.env.PATH ?? ''}:/usr/bin`,
    },
  }, (err, stdout, stderr) => {
    const output = stdout.trim()
    const errorOutput = stderr?.trim()

    if (err || errorOutput) {
      console.error('vcgencmd error:', err?.message || errorOutput)
      return res.status(500).json({
        error: 'Command failed',
        details: errorOutput || err.message,
      })
    }

    const match = output.match(/throttled=0x([0-9a-fA-F]+)/)
    if (!match) {
      return res.status(500).json({
        error: 'Unexpected output format',
        rawOutput: output,
      })
    }

    const hex = match[1]
    const binary = parseInt(hex, 16).toString(2).padStart(20, '0')

    const flags = {
      undervoltageNow: binary[19] === '1',
      throttlingNow: binary[18] === '1',
      throttlingOccurred: binary[17] === '1',
      undervoltageOccurred: binary[16] === '1',
    }

    res.json({
      rawOutput: output,
      parsedHex: hex,
      binary,
      flags,
    })
  })
})

export default router
