import { Router } from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'

const router = Router()
const execAsync = promisify(exec)

router.get('/api/system/boot-info', async (_req, res) => {
  try {
    const { stdout: bootOut } = await execAsync('findmnt /boot -n -o SOURCE')
    const { stdout: rootOut } = await execAsync('findmnt / -n -o SOURCE')

    // The `vcgencmd` tool is not available on some distros (e.g. Ubuntu 25.04).
    // Instead of failing the entire route, return fallback values so the
    // frontend widgets continue to render.
    const throttleRaw = 'Unavailable'
    const undervoltage = false

    const nvme = {
      temp: null as string | null,
      percentUsed: null as string | null,
      powerCycles: null as number | null,
      mediaErrors: null as number | null,
      warningTempExceeded: null as number | null,
    }
    try {
      const { stdout: nvmeOut } = await execAsync('sudo nvme smart-log /dev/nvme0')
      for (const line of nvmeOut.split('\n')) {
        const t = line.trim()
        if (/^temperature\b/i.test(t)) {
          const m = t.match(/temperature\s*:\s*(\S+)/i)
          if (m) nvme.temp = m[1]
        } else if (/^percentage[_ ]?used/i.test(t)) {
          const m = t.match(/percentage[_ ]?used\s*:\s*(\d+%)/i)
          if (m) nvme.percentUsed = m[1]
        } else if (/^power_cycles/i.test(t)) {
          const m = t.match(/power_cycles\s*:\s*(\d+)/i)
          if (m) nvme.powerCycles = Number(m[1])
        } else if (/^media_errors/i.test(t)) {
          const m = t.match(/media_errors\s*:\s*(\d+)/i)
          if (m) nvme.mediaErrors = Number(m[1])
        } else if (/^warning temperature time/i.test(t)) {
          const m = t.match(/warning temperature time\s*:\s*(\d+)/i)
          if (m) nvme.warningTempExceeded = Number(m[1])
        }
      }
    } catch (err) {
      // ignore NVMe errors
    }

    res.json({
      bootDevice: bootOut.trim(),
      rootDevice: rootOut.trim(),
      undervoltage,
      throttleRaw,
      nvme,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve boot info', details: err.message })
  }
})

export default router
