import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/nvme', (_req, res) => {
  exec('sudo smartctl -a /dev/nvme0', (err, stdout, stderr) => {
    if (err || stderr) {
      const details = stderr || (err ? err.message : "Unknown exec error");
      return res.status(500).json({ error: 'SMART data unavailable', details });
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
