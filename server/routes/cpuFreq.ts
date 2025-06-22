import { Router } from 'express'
import { readdirSync, readFileSync } from 'fs'

const router = Router()

router.get('/api/metrics/cpu-freq', (_req, res) => {
  try {
    const cpus = readdirSync('/sys/devices/system/cpu')
      .filter((name) => /^cpu[0-9]+$/.test(name))

    const freqs = cpus.map((cpu) => {
      const path = `/sys/devices/system/cpu/${cpu}/cpufreq/scaling_cur_freq`
      try {
        const raw = readFileSync(path, 'utf8').trim()
        const ghz = (parseInt(raw) / 1_000_000).toFixed(2) + ' GHz'
        return { core: cpu, freq: ghz }
      } catch {
        return { core: cpu, freq: 'Unavailable' }
      }
    })

    res.json(freqs)
  } catch (err) {
    res.status(500).json({ error: 'Could not read CPU frequencies' })
  }
})

export default router
