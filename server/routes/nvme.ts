import { Router } from 'express'
import { exec } from 'child_process'
import { classifyCommandFailure, hasTool, nvmeDevice, SUDO, SUDOERS_HINT, unavailable } from '../services/unavailable'

const router = Router()

router.get('/api/metrics/nvme', (_req, res) => {
  if (!hasTool('smartctl')) {
    return res.json(unavailable('not-installed', 'smartctl not found (apt install smartmontools).'))
  }
  const device = nvmeDevice()
  if (!device) {
    return res.json(unavailable('no-device', 'No NVMe drive found (set PIDECK_NVME_DEVICE if it has another name).'))
  }
  exec(`${SUDO} smartctl -a ${device}`, (err, stdout, stderr) => {
    // smartctl uses non-zero exit bits for drive warnings; only give up when there's no output.
    if (err && !stdout.trim()) {
      const reason = classifyCommandFailure(err, stderr)
      if (reason === 'needs-sudoers') return res.json(unavailable(reason, SUDOERS_HINT))
      if (reason) return res.json(unavailable(reason, 'smartctl could not run.'))
      return res.status(500).json({ error: 'SMART data unavailable', details: (stderr || err.message).slice(0, 200) });
    }

    const lines = stdout.split('\n')
    const metrics: {
      temperature: string | null
      power_on_hours: string | null
      wear_leveling_count: string | null
      media_errors: string | null
    } = {
      temperature: null,
      power_on_hours: null,
      wear_leveling_count: null,
      media_errors: null,
    }

    for (const line of lines) {
      if (line.includes('Temperature:')) metrics.temperature = line.split(':')[1].trim().split(' ')[0]
      if (line.includes('Power On Hours')) metrics.power_on_hours = line.split(':')[1].trim()
      if (line.includes('Wear Leveling Count')) metrics.wear_leveling_count = line.split(':')[1].trim()
      if (line.includes('Media and Data Integrity Errors')) metrics.media_errors = line.split(':')[1].trim()
    }

    res.json(metrics)
  })
})

export default router
