import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/power-status', (_req, res) => {
  exec('/usr/bin/vcgencmd get_throttled', {
    env: {
      ...process.env,
      PATH: `${process.env.PATH ?? ''}:/usr/bin`,
    },
  }, (throttleErr, throttleOut) => {
    const output = throttleOut.trim()

    let status = 'Unavailable'
    if (!throttleErr) {
      const match = output.match(/throttled=0x([0-9a-fA-F]+)/)
      if (match) {
        const binary = parseInt(match[1], 16).toString(2).padStart(20, '0')
        const undervoltageNow = binary[19] === '1'
        const throttlingNow = binary[18] === '1'
        const undervoltageOccurred = binary[16] === '1'
        const throttlingOccurred = binary[17] === '1'

        if (undervoltageNow || throttlingNow) status = 'Throttling'
        else if (undervoltageOccurred || throttlingOccurred) status = 'Throttled'
        else status = 'Normal'
      }
    }

    exec('/usr/bin/vcgencmd measure_volts', {
      env: {
        ...process.env,
        PATH: `${process.env.PATH ?? ''}:/usr/bin`,
      },
    }, (voltErr, voltOut) => {
      let voltage: number | null = null
      if (!voltErr) {
        const vmatch = voltOut.trim().match(/volt=([0-9.]+)V/)
        if (vmatch) {
          voltage = parseFloat(vmatch[1])
        }
      }

      res.json({
        voltage,
        current: null,
        status,
      })
    })
  })
})

export default router
